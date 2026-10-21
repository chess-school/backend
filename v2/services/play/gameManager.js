// v2/services/play/gameManager.js
//
// Движок онлайн-партий (сервер — источник истины):
//   — ход проверяется chess.js на сервере: только свой цвет, только в свою очередь, только легальный;
//   — часы ведёт сервер (clock.js); флаг падает по серверному таймеру, а не по сообщению клиента;
//   — ходы одной партии обрабатываются строго по очереди (per-game lock) — нет гонок двух ходов;
//   — конец партии: мат, пат, недостаточный материал, троекратное повторение, 50 ходов, время,
//     сдача, ничья по соглашению; отмена (abort), если первые ходы не сделаны за abortTimeoutMs;
//   — флаг при «голом» короле (или короле с одной лёгкой фигурой) у соперника — ничья, как на Lichess;
//   — рейтинговая партия пересчитывает Glicko-2 обоих игроков в категории контроля времени.
// Активные партии живут в памяти процесса; после перезапуска восстанавливаются из БД (moves + clock).
// Зависимости (время, таймеры, рассылка) внедряются — так часы и таймауты проверяются в тестах.

const { Chess } = require('chess.js');
const LiveGame = require('../../models/LiveGame');
const User = require('../../models/User');
const { GameClock } = require('./clock');
const { rateGame, isProvisional, DEFAULT_RATING } = require('../../utils/ratingCalculator');
const { badRequest, conflict, forbidden, notFound } = require('../../utils/apiError');

const ABORT_TIMEOUT_MS = 30000;
const PLAYER_FIELDS = 'uuid firstName lastName avatarUrl ratings';

const opposite = (color) => (color === 'white' ? 'black' : 'white');
const colorOfTurn = (chess) => (chess.turn() === 'w' ? 'white' : 'black');

/** Может ли сторона в принципе поставить мат (иначе флаг соперника — ничья) */
const hasMatingMaterial = (chess, color) => {
    const c = color === 'white' ? 'w' : 'b';
    let minors = 0;
    for (const row of chess.board()) {
        for (const piece of row) {
            if (!piece || piece.color !== c || piece.type === 'k') continue;
            if (piece.type === 'p' || piece.type === 'r' || piece.type === 'q') return true;
            minors++;
        }
    }
    return minors >= 2;
};

const playerDto = (user, speed) => {
    if (!user) return null;
    const perf = user.ratings?.[speed] ?? DEFAULT_RATING;
    return {
        _id: user._id,
        uuid: user.uuid,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl || null,
        rating: Math.round(perf.rating ?? DEFAULT_RATING.rating),
        provisional: isProvisional(perf),
    };
};

const createGameManager = ({
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    emitToGame = () => {},
    emitToUser = () => {},
    abortTimeoutMs = ABORT_TIMEOUT_MS,
} = {}) => {
    /** gameId -> состояние активной партии */
    const games = new Map();
    /** gameId -> цепочка промисов (последовательная обработка) */
    const locks = new Map();

    const withLock = (gameId, fn) => {
        const key = String(gameId);
        const prev = locks.get(key) || Promise.resolve();
        const run = prev.then(fn, fn);
        const tail = run.catch(() => {});
        locks.set(key, tail);
        tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
        return run;
    };

    const ply = (state) => state.chess.history().length;

    const clockSnapshot = (state, t = now()) => state.clock.snapshot(t);

    // ------------------------------------------------------------ таймеры

    // Колбэки таймеров возвращают промис обработки — тесты с фейковыми таймерами могут его дождаться
    const schedule = (state) => {
        if (state.timer) clearTimer(state.timer);
        state.timer = null;
        const t = now();
        if (ply(state) < 2) {
            // Первые ходы: часы стоят, но бесконечно ждать нельзя — отмена партии
            const wait = Math.max(0, state.waitingSince + abortTimeoutMs - t);
            state.timer = setTimer(() => withLock(state.id, () => onAbortTimer(state.id)).catch(logError), wait);
        } else {
            const wait = state.clock.msToFlag(t);
            if (Number.isFinite(wait)) state.timer = setTimer(() => withLock(state.id, () => onFlagTimer(state.id)).catch(logError), wait + 1);
        }
    };

    const logError = (e) => console.error('Play engine error:', e);

    const onAbortTimer = async (gameId) => {
        const state = games.get(String(gameId));
        if (!state || ply(state) >= 2) return;
        if (now() - state.waitingSince + 5 < abortTimeoutMs) { schedule(state); return; }
        await finish(state, { winner: null, reason: 'aborted', aborted: true });
    };

    const onFlagTimer = async (gameId) => {
        const state = games.get(String(gameId));
        if (!state) return;
        if (!state.clock.flagged(now())) { schedule(state); return; } // таймер сработал рано
        await flag(state);
    };

    /** Упал флаг стороны, чей ход */
    const flag = async (state) => {
        const loser = state.clock.turn;
        const winner = opposite(loser);
        // Соперник не может поставить мат никак — ничья (как на Lichess)
        const result = hasMatingMaterial(state.chess, winner) ? winner : 'draw';
        await finish(state, { winner: result, reason: 'timeout' });
    };

    // ------------------------------------------------------------ загрузка / восстановление

    const fromDocument = (doc) => {
        const chess = new Chess();
        for (const uci of doc.moves || []) {
            chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        }
        const tc = doc.timeControl;
        const clock = new GameClock({
            initialMs: tc.initialSeconds * 1000,
            incrementMs: tc.incrementSeconds * 1000,
            whiteMs: doc.clock?.whiteMs ?? tc.initialSeconds * 1000,
            blackMs: doc.clock?.blackMs ?? tc.initialSeconds * 1000,
            turn: colorOfTurn(chess),
            turnStartedAt: doc.clock?.turnStartedAt ? new Date(doc.clock.turnStartedAt).getTime() : null,
        });
        return {
            id: String(doc._id),
            white: String(doc.whitePlayer),
            black: String(doc.blackPlayer),
            isRated: doc.isRated,
            timeControl: { type: tc.type, initialSeconds: tc.initialSeconds, incrementSeconds: tc.incrementSeconds, custom: !!tc.custom },
            chess,
            clock,
            drawOfferBy: doc.drawOfferBy || null,
            waitingSince: new Date(doc.clock?.turnStartedAt || doc.updatedAt || doc.startedAt || now()).getTime(),
            timer: null,
        };
    };

    /** Активная партия в памяти; после перезапуска — из БД (с упавшим за это время флагом) */
    const load = async (gameId) => {
        const key = String(gameId);
        if (games.has(key)) return games.get(key);
        const doc = await LiveGame.findById(key).lean();
        if (!doc || doc.status !== 'active') return null;
        const state = fromDocument(doc);
        games.set(key, state);
        if (state.clock.flagged(now())) {
            await flag(state);
            return null;
        }
        schedule(state);
        return state;
    };

    /** Зарегистрировать только что начатую партию (документ уже status: active) */
    const activate = (doc) => {
        const state = fromDocument(doc);
        state.waitingSince = now();
        games.set(state.id, state);
        schedule(state);
        return state;
    };

    // ------------------------------------------------------------ конец партии

    const applyRatings = async (state, winner) => {
        const speed = state.timeControl.type;
        const [w, b] = await Promise.all([
            User.findById(state.white).select('ratings').lean(),
            User.findById(state.black).select('ratings').lean(),
        ]);
        const before = {
            white: { ...DEFAULT_RATING, ...(w?.ratings?.[speed] || {}) },
            black: { ...DEFAULT_RATING, ...(b?.ratings?.[speed] || {}) },
        };
        const score = winner === 'white' ? 1 : winner === 'black' ? 0 : 0.5;
        const rated = rateGame(before.white, before.black, score);
        const save = (id, r) => User.updateOne({ _id: id }, {
            $set: { [`ratings.${speed}.rating`]: r.rating, [`ratings.${speed}.rd`]: r.rd, [`ratings.${speed}.vol`]: r.vol },
            $inc: { [`ratings.${speed}.games`]: 1 },
        });
        await Promise.all([save(state.white, rated.white), save(state.black, rated.black)]);
        const snap = (color) => ({
            before: Math.round(before[color].rating),
            after: rated[color].rating,
            diff: rated.diff[color],
            provisional: isProvisional(before[color]),
        });
        return { ratingChanges: { white: rated.diff.white, black: rated.diff.black }, ratings: { white: snap('white'), black: snap('black') } };
    };

    const finish = async (state, { winner, reason, aborted = false }) => {
        if (state.timer) clearTimer(state.timer);
        state.timer = null;
        const t = now();
        state.clock.stop(t);
        games.delete(state.id);

        const rating = !aborted && state.isRated ? await applyRatings(state, winner) : null;
        const update = {
            status: aborted ? 'aborted' : 'finished',
            winner: aborted ? null : winner,
            endReason: reason,
            finishedAt: new Date(t),
            clock: state.clock.toDocument(),
            drawOfferBy: null,
            fen: state.chess.fen(),
            pgn: state.chess.pgn(),
            ...(rating ? { ratingChanges: rating.ratingChanges, ratings: rating.ratings } : {}),
        };
        await LiveGame.updateOne({ _id: state.id, status: 'active' }, { $set: update });
        const payload = {
            gameId: state.id,
            status: update.status,
            winner: update.winner,
            endReason: reason,
            ratingChanges: rating?.ratingChanges ?? null,
            ratings: rating?.ratings ?? null,
            clock: clockSnapshot(state, t),
            pgn: update.pgn,
        };
        emitToGame(state.id, 'game_over', payload);
        return payload;
    };

    /** Итог по позиции после хода (null — игра продолжается) */
    const positionResult = (chess, mover) => {
        if (chess.isCheckmate()) return { winner: mover, reason: 'checkmate' };
        if (chess.isStalemate()) return { winner: 'draw', reason: 'stalemate' };
        if (chess.isInsufficientMaterial()) return { winner: 'draw', reason: 'insufficient_material' };
        if (chess.isThreefoldRepetition()) return { winner: 'draw', reason: 'threefold_repetition' };
        if (chess.isDraw()) return { winner: 'draw', reason: 'fifty_moves' };
        return null;
    };

    // ------------------------------------------------------------ действия игроков

    const requirePlayer = async (gameId, userId) => {
        const state = await load(gameId);
        if (!state) {
            const exists = await LiveGame.exists({ _id: gameId });
            if (!exists) throw notFound('Game not found.', 'GAME_NOT_FOUND');
            throw conflict('The game is not in progress.', 'GAME_NOT_ACTIVE');
        }
        const uid = String(userId);
        const color = uid === state.white ? 'white' : uid === state.black ? 'black' : null;
        if (!color) throw forbidden('You are not a player in this game.', 'NOT_A_PLAYER');
        return { state, color };
    };

    const persistMove = async (state, plyBefore, uci, san) => {
        const res = await LiveGame.updateOne(
            { _id: state.id, status: 'active', moves: { $size: plyBefore } },
            {
                $push: { moves: uci, sanMoves: san },
                $set: { fen: state.chess.fen(), clock: state.clock.toDocument(), drawOfferBy: state.drawOfferBy },
            },
        );
        if (res.matchedCount === 0) throw conflict('The game state changed. Reload the game.', 'GAME_STATE_CONFLICT');
    };

    /** Ход игрока (uci: e2e4, e7e8q). expectedPly — защита от устаревшего клиента */
    const move = (gameId, userId, uci, expectedPly) => withLock(gameId, async () => {
        if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw badRequest('Move must be in UCI format, e.g. e2e4.', 'INVALID_MOVE_FORMAT');
        const { state, color } = await requirePlayer(gameId, userId);
        if (colorOfTurn(state.chess) !== color) throw conflict('It is not your turn.', 'NOT_YOUR_TURN');
        const plyBefore = ply(state);
        if (expectedPly !== undefined && expectedPly !== null && Number(expectedPly) !== plyBefore) {
            throw conflict('The position changed. Reload the game.', 'STALE_POSITION');
        }

        const t = now();
        // Флаг упал раньше, чем пришёл ход — партия проиграна по времени, ход не засчитывается
        if (state.clock.flagged(t)) {
            await flag(state);
            throw conflict('Time is up.', 'TIME_UP');
        }

        let played;
        try {
            played = state.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
        } catch {
            played = null;
        }
        if (!played) throw badRequest('Illegal move.', 'ILLEGAL_MOVE');
        const normalized = `${played.from}${played.to}${played.promotion ?? ''}`;

        // Часы запускаются после первого хода чёрных (ply 1 -> 2)
        state.clock.press(t, { startClock: plyBefore >= 1 });
        // Ход отклоняет предложение ничьей соперника; своё предложение остаётся в силе
        if (state.drawOfferBy && state.drawOfferBy !== color) state.drawOfferBy = null;
        if (plyBefore < 2) state.waitingSince = t;

        try {
            await persistMove(state, plyBefore, normalized, played.san);
        } catch (e) {
            state.chess.undo();
            games.delete(state.id); // перечитать из БД при следующем обращении
            throw e;
        }

        const payload = { gameId: state.id, uci: normalized, san: played.san, fen: state.chess.fen(), ply: plyBefore + 1, clock: clockSnapshot(state, t), drawOfferBy: state.drawOfferBy };
        emitToGame(state.id, 'move', payload);

        const result = positionResult(state.chess, color);
        if (result) await finish(state, result);
        else schedule(state);
        return payload;
    });

    const resign = (gameId, userId) => withLock(gameId, async () => {
        const { state, color } = await requirePlayer(gameId, userId);
        // До первых ходов обоих сдача — это отмена (без рейтинга), как на Lichess
        if (ply(state) < 2) return finish(state, { winner: null, reason: 'aborted', aborted: true });
        return finish(state, { winner: opposite(color), reason: 'resignation' });
    });

    const abort = (gameId, userId) => withLock(gameId, async () => {
        const { state } = await requirePlayer(gameId, userId);
        if (ply(state) >= 2) throw conflict('The game can be aborted only before both players move.', 'ABORT_NOT_ALLOWED');
        return finish(state, { winner: null, reason: 'aborted', aborted: true });
    });

    const offerDraw = (gameId, userId) => withLock(gameId, async () => {
        const { state, color } = await requirePlayer(gameId, userId);
        if (ply(state) < 2) throw conflict('Draw offers are available after the first moves.', 'DRAW_NOT_ALLOWED');
        // Встречное предложение = согласие
        if (state.drawOfferBy === opposite(color)) return finish(state, { winner: 'draw', reason: 'draw_agreement' });
        if (state.drawOfferBy === color) return { gameId: state.id, drawOfferBy: color };
        state.drawOfferBy = color;
        await LiveGame.updateOne({ _id: state.id, status: 'active' }, { $set: { drawOfferBy: color } });
        emitToGame(state.id, 'draw_offer', { gameId: state.id, by: color });
        return { gameId: state.id, drawOfferBy: color };
    });

    const answerDraw = (gameId, userId, accept) => withLock(gameId, async () => {
        const { state, color } = await requirePlayer(gameId, userId);
        if (state.drawOfferBy !== opposite(color)) throw conflict('There is no draw offer from your opponent.', 'NO_DRAW_OFFER');
        if (accept) return finish(state, { winner: 'draw', reason: 'draw_agreement' });
        state.drawOfferBy = null;
        await LiveGame.updateOne({ _id: state.id, status: 'active' }, { $set: { drawOfferBy: null } });
        emitToGame(state.id, 'draw_declined', { gameId: state.id, by: color });
        return { gameId: state.id, drawOfferBy: null };
    });

    // ------------------------------------------------------------ состояние для клиента

    /** Полное состояние партии (любой статус) — для входа в партию и зрителей */
    const snapshot = async (gameId) => {
        const doc = await LiveGame.findById(gameId).populate('whitePlayer', PLAYER_FIELDS).populate('blackPlayer', PLAYER_FIELDS).populate('createdBy', 'uuid firstName lastName').lean();
        if (!doc) throw notFound('Game not found.', 'GAME_NOT_FOUND');
        const speed = doc.timeControl.type;
        const state = doc.status === 'active' ? await load(gameId) : null;
        const t = now();
        let clock;
        if (state) clock = clockSnapshot(state, t);
        else {
            const ms = doc.clock?.whiteMs ?? doc.timeControl.initialSeconds * 1000;
            clock = { whiteMs: ms, blackMs: doc.clock?.blackMs ?? ms, turn: (doc.moves?.length ?? 0) % 2 ? 'black' : 'white', running: false, serverNow: t };
        }
        // Партия могла закончиться при загрузке (упавший флаг) — перечитать итог
        const fresh = doc.status === 'active' && !state ? await LiveGame.findById(gameId).lean() : doc;
        const players = (d) => ({ white: playerDto(doc.whitePlayer, speed), black: playerDto(doc.blackPlayer, speed), ...d });
        return players({
            _id: String(doc._id),
            status: fresh.status,
            source: doc.source,
            isPrivate: doc.isPrivate,
            isRated: doc.isRated,
            timeControl: doc.timeControl,
            creatorColor: doc.creatorColor,
            createdBy: doc.createdBy,
            fen: state ? state.chess.fen() : fresh.fen,
            moves: state ? state.chess.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`) : fresh.moves,
            sanMoves: state ? state.chess.history() : fresh.sanMoves,
            clock,
            drawOfferBy: state ? state.drawOfferBy : fresh.drawOfferBy,
            winner: fresh.winner,
            endReason: fresh.endReason,
            ratingChanges: fresh.ratingChanges,
            ratings: fresh.ratings,
            rematchOf: doc.rematchOf,
            pgn: fresh.pgn || (state ? state.chess.pgn() : ''),
            abortTimeoutMs,
        });
    };

    /** Остановить все таймеры (тесты, остановка сервера) */
    const shutdown = () => {
        for (const state of games.values()) if (state.timer) clearTimer(state.timer);
        games.clear();
    };

    return { activate, load, move, resign, abort, offerDraw, acceptDraw: (g, u) => answerDraw(g, u, true), declineDraw: (g, u) => answerDraw(g, u, false), snapshot, shutdown, emitToUser, _games: games };
};

module.exports = { createGameManager, hasMatingMaterial, ABORT_TIMEOUT_MS };
