// v2/services/play/challenge.service.js
//
// Вызовы и старт партий:
//   — открытый вызов (виден в лобби) или закрытый — по ссылке /play/<id> (отправить другу);
//   — принять вызов: цвета назначаются (random — случайно), партия становится active атомарно
//     (двое одновременно принявших не получат одну партию);
//   — диапазон рейтинга соперника (±N) проверяется у рейтинговых открытых вызовов;
//   — реванш: новый закрытый вызов с теми же настройками и сменой цветов; если соперник уже
//     предложил реванш — он принимается сразу;
//   — партия из очереди автоподбора создаётся сразу активной (createPairedGame).

const LiveGame = require('../../models/LiveGame');
const User = require('../../models/User');
const { buildTimeControl, LIMITS } = require('../../utils/timeControl');
const { DEFAULT_RATING, isProvisional } = require('../../utils/ratingCalculator');
const { conflict, forbidden, notFound, unprocessable, ApiError } = require('../../utils/apiError');
const { getGameManager } = require('./index');
const { emitToGame, emitToUser } = require('./playRealtime');

const OPEN_CHALLENGE_TTL_MS = 60 * 60 * 1000;          // открытый вызов виден в лобби час
const PRIVATE_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;  // ссылка на вызов действует сутки
const MAX_OPEN_CHALLENGES = 3;
const PUBLIC_USER = 'uuid firstName lastName avatarUrl ratings';

const ratingIn = (user, speed) => ({ ...DEFAULT_RATING, ...(user?.ratings?.[speed] || {}) });

const timeControlOrThrow = (minutes, increment) => {
    const tc = buildTimeControl({ minutes, increment });
    if (!tc) {
        throw unprocessable(`Time control must be ${LIMITS.minMinutes}–${LIMITS.maxMinutes} minutes and 0–${LIMITS.maxIncrement} seconds increment.`,
            'INVALID_TIME_CONTROL', [{ field: 'minutes', message: 'Out of range.' }]);
    }
    return tc;
};

const initialClock = (tc) => ({ whiteMs: tc.initialSeconds * 1000, blackMs: tc.initialSeconds * 1000, turnStartedAt: null });

const challengeDto = (doc, me) => {
    const creator = doc.createdBy && doc.createdBy._id ? doc.createdBy : null;
    const perf = creator ? ratingIn(creator, doc.timeControl.type) : null;
    return {
        _id: String(doc._id),
        status: doc.status,
        isPrivate: doc.isPrivate,
        isRated: doc.isRated,
        timeControl: doc.timeControl,
        creatorColor: doc.creatorColor,
        ratingRange: doc.ratingRange,
        source: doc.source,
        createdAt: doc.createdAt,
        mine: !!me && creator && String(creator._id) === String(me),
        creator: creator ? {
            _id: creator._id, uuid: creator.uuid, firstName: creator.firstName, lastName: creator.lastName,
            avatarUrl: creator.avatarUrl || null, rating: Math.round(perf.rating), provisional: isProvisional(perf),
        } : null,
    };
};

/** Создать вызов: { minutes, increment, rated, color: white|black|random, isPrivate, ratingRange? } */
const createChallenge = async (user, { minutes, increment, rated = true, color = 'random', isPrivate = true, ratingRange = null, source = 'challenge', rematchOf = null }) => {
    const tc = timeControlOrThrow(minutes, increment);
    if (!isPrivate) {
        const open = await LiveGame.countDocuments({ createdBy: user.id, status: 'created', isPrivate: false, createdAt: { $gt: new Date(Date.now() - OPEN_CHALLENGE_TTL_MS) } });
        if (open >= MAX_OPEN_CHALLENGES) throw conflict(`You can have at most ${MAX_OPEN_CHALLENGES} open challenges.`, 'TOO_MANY_CHALLENGES');
    }
    const doc = await LiveGame.create({
        createdBy: user.id,
        creatorColor: color,
        source,
        isPrivate: !!isPrivate,
        isRated: !!rated,
        timeControl: tc,
        clock: initialClock(tc),
        ratingRange: !isPrivate && ratingRange ? Number(ratingRange) : null,
        rematchOf,
    });
    const populated = await LiveGame.findById(doc._id).populate('createdBy', PUBLIC_USER).lean();
    return challengeDto(populated, user.id);
};

/** Открытые вызовы лобби (свои — тоже, с mine: true) */
const listOpenChallenges = async (user) => {
    const docs = await LiveGame.find({ status: 'created', isPrivate: false, createdAt: { $gt: new Date(Date.now() - OPEN_CHALLENGE_TTL_MS) } })
        .sort({ createdAt: -1 }).limit(100).populate('createdBy', PUBLIC_USER).lean();
    return docs.map((d) => challengeDto(d, user?.id));
};

const assignColors = (creatorColor, creatorId, acceptorId) => {
    const creatorIsWhite = creatorColor === 'white' || (creatorColor === 'random' && Math.random() < 0.5);
    return creatorIsWhite ? { white: creatorId, black: acceptorId } : { white: acceptorId, black: creatorId };
};

const startActive = async (filter, set) => {
    const doc = await LiveGame.findOneAndUpdate(filter, { $set: { ...set, status: 'active', startedAt: new Date() } }, { new: true }).lean();
    if (!doc) return null;
    getGameManager().activate(doc);
    for (const uid of [doc.whitePlayer, doc.blackPlayer]) emitToUser(String(uid), 'game_started', { gameId: String(doc._id) });
    return doc;
};

/** Принять вызов -> { gameId } */
const acceptChallenge = async (user, challengeId) => {
    const doc = await LiveGame.findById(challengeId).populate('createdBy', PUBLIC_USER).lean();
    if (!doc) throw notFound('Challenge not found.', 'CHALLENGE_NOT_FOUND');
    if (doc.status !== 'created') throw conflict('This challenge has already been accepted or cancelled.', 'CHALLENGE_TAKEN');
    if (String(doc.createdBy._id) === String(user.id)) throw conflict('You cannot accept your own challenge.', 'OWN_CHALLENGE');
    const ttl = doc.isPrivate ? PRIVATE_CHALLENGE_TTL_MS : OPEN_CHALLENGE_TTL_MS;
    if (Date.now() - new Date(doc.createdAt).getTime() > ttl) throw new ApiError(410, 'CHALLENGE_EXPIRED', 'This challenge has expired.');

    if (doc.isRated && doc.ratingRange) {
        const me = await User.findById(user.id).select('ratings').lean();
        const speed = doc.timeControl.type;
        const diff = Math.abs(ratingIn(me, speed).rating - ratingIn(doc.createdBy, speed).rating);
        if (diff > doc.ratingRange) throw forbidden('Your rating is outside the range of this challenge.', 'RATING_OUT_OF_RANGE');
    }

    const colors = assignColors(doc.creatorColor, doc.createdBy._id, user.id);
    const started = await startActive(
        { _id: doc._id, status: 'created' },
        { whitePlayer: colors.white, blackPlayer: colors.black, clock: initialClock(doc.timeControl) },
    );
    if (!started) throw conflict('This challenge has already been accepted or cancelled.', 'CHALLENGE_TAKEN');
    return { gameId: String(started._id) };
};

/** Отозвать свой вызов */
const cancelChallenge = async (user, challengeId) => {
    const res = await LiveGame.updateOne({ _id: challengeId, createdBy: user.id, status: 'created' }, { $set: { status: 'aborted', endReason: 'aborted', finishedAt: new Date() } });
    if (res.matchedCount === 0) throw notFound('Challenge not found.', 'CHALLENGE_NOT_FOUND');
    return { cancelled: true };
};

/** Партия из очереди автоподбора: сразу активна, цвета случайные */
const createPairedGame = async (userA, userB, tc, rated) => {
    const colors = assignColors('random', userA, userB);
    const created = await LiveGame.create({
        createdBy: userA, creatorColor: 'random', source: 'pairing', isPrivate: true, isRated: !!rated,
        timeControl: tc, clock: initialClock(tc),
    });
    const doc = await startActive({ _id: created._id, status: 'created' }, { whitePlayer: colors.white, blackPlayer: colors.black });
    return String(doc._id);
};

/** Реванш: предложить или (если соперник уже предложил) принять -> { gameId, accepted } */
const rematch = async (user, gameId) => {
    const old = await LiveGame.findById(gameId).lean();
    if (!old) throw notFound('Game not found.', 'GAME_NOT_FOUND');
    const me = String(user.id);
    const myColor = String(old.whitePlayer) === me ? 'white' : String(old.blackPlayer) === me ? 'black' : null;
    if (!myColor) throw forbidden('You are not a player in this game.', 'NOT_A_PLAYER');
    if (!['finished', 'aborted'].includes(old.status) || !old.whitePlayer || !old.blackPlayer) throw conflict('Rematch is available after the game ends.', 'GAME_NOT_FINISHED');
    const opponent = String(myColor === 'white' ? old.blackPlayer : old.whitePlayer);

    const offered = await LiveGame.findOne({ rematchOf: old._id, status: 'created', createdBy: opponent }).lean();
    if (offered) return { ...(await acceptChallenge(user, offered._id)), accepted: true };
    const mine = await LiveGame.findOne({ rematchOf: old._id, status: 'created', createdBy: me }).lean();
    if (mine) return { gameId: String(mine._id), accepted: false };

    const dto = await createChallenge(user, {
        minutes: old.timeControl.initialSeconds / 60,
        increment: old.timeControl.incrementSeconds,
        rated: old.isRated,
        color: myColor === 'white' ? 'black' : 'white', // цвета меняются
        isPrivate: true,
        source: 'rematch',
        rematchOf: old._id,
    });
    const payload = { gameId: String(old._id), newGameId: dto._id, by: myColor };
    emitToGame(String(old._id), 'rematch_offer', payload);
    emitToUser(opponent, 'rematch_offer', payload);
    return { gameId: dto._id, accepted: false };
};

/** Мои рейтинги, активные партии и открытые вызовы */
const overview = async (user) => {
    const [me, active, challenges] = await Promise.all([
        User.findById(user.id).select('ratings').lean(),
        LiveGame.find({ status: 'active', $or: [{ whitePlayer: user.id }, { blackPlayer: user.id }] }).select('_id timeControl').lean(),
        LiveGame.find({ status: 'created', createdBy: user.id, createdAt: { $gt: new Date(Date.now() - PRIVATE_CHALLENGE_TTL_MS) } })
            .sort({ createdAt: -1 }).limit(10).populate('createdBy', PUBLIC_USER).lean(),
    ]);
    const ratings = {};
    for (const speed of ['bullet', 'blitz', 'rapid', 'classical']) {
        const r = ratingIn(me, speed);
        ratings[speed] = { rating: Math.round(r.rating), rd: r.rd, games: r.games ?? 0, provisional: isProvisional(r) };
    }
    return {
        ratings,
        activeGames: active.map((g) => ({ _id: String(g._id), timeControl: g.timeControl })),
        challenges: challenges.map((c) => challengeDto(c, user.id)),
    };
};

/** Мои последние партии */
const myGames = async (user, { limit = 20 } = {}) => {
    const docs = await LiveGame.find({ status: { $in: ['finished', 'aborted'] }, $or: [{ whitePlayer: user.id }, { blackPlayer: user.id }] })
        .sort({ finishedAt: -1 }).limit(Math.min(50, limit))
        .populate('whitePlayer', 'uuid firstName lastName').populate('blackPlayer', 'uuid firstName lastName').lean();
    return docs.map((d) => ({
        _id: String(d._id), status: d.status, winner: d.winner, endReason: d.endReason, isRated: d.isRated, timeControl: d.timeControl,
        white: d.whitePlayer, black: d.blackPlayer, ratingChanges: d.ratingChanges, finishedAt: d.finishedAt, moves: d.moves?.length ?? 0,
    }));
};

module.exports = { createChallenge, listOpenChallenges, acceptChallenge, cancelChallenge, createPairedGame, rematch, overview, myGames, ratingIn };
