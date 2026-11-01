// Слой хранения онлайн-партий (v2 LiveGame) — ШОВ Mongo→PG (домен Play/Realtime).
// Флаг PLAY_DB: 'mongo' (по умолчанию) | 'pg'. ГОРЯЧИЙ путь (сокеты/часы/рейтинги): mongo-ветка
// повторяет прежние вызовы Mongoose 1:1 (гейт не меняется), pg-ветка уплощает вложенное
// (timeControl/clock/ratingChanges/ratings) в колонки и восстанавливает форму Mongo-дока наружу.
// Джойн игроков (white/black/createdBy → user) делается в сервисах app-level через userRepo.

const LiveGameMongo = require('../models/LiveGame');

const usePg = () => String(process.env.PLAY_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); }
  return _prisma;
};

const s = (v) => (v == null ? null : String(v));

// PG-строка → форма Mongo-дока LiveGame (вложенные timeControl/clock/ratingChanges/ratings).
const pgRowToDoc = (r) => r && {
  _id: r.id,
  whitePlayer: r.whitePlayerId, blackPlayer: r.blackPlayerId, createdBy: r.createdById,
  creatorColor: r.creatorColor, source: r.source, isPrivate: r.isPrivate, isRated: r.isRated,
  timeControl: { type: r.timeControlKind, initialSeconds: r.timeControlInitialSeconds, incrementSeconds: r.timeControlIncrementSeconds, custom: r.timeControlCustom },
  fen: r.fen, moves: r.moves || [], sanMoves: r.sanMoves || [], pgn: r.pgn,
  status: r.status, winner: r.winner, endReason: r.endReason,
  clock: { whiteMs: r.clockWhiteMs, blackMs: r.clockBlackMs, turnStartedAt: r.clockTurnStartedAt },
  drawOfferBy: r.drawOfferBy,
  ratingChanges: { white: r.ratingChangesWhite, black: r.ratingChangesBlack },
  ratings: { white: r.ratingsWhite || undefined, black: r.ratingsBlack || undefined },
  ratingRange: r.ratingRange, rematchOf: r.rematchOfId,
  startedAt: r.startedAt, finishedAt: r.finishedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
};

// Вложенный объект из create-данных → колонки PG.
const createData = (d) => {
  const tc = d.timeControl || {};
  const ck = d.clock || {};
  return {
    id: d._id ? s(d._id) : new (require('mongoose').Types.ObjectId)().toString(),
    whitePlayerId: s(d.whitePlayer), blackPlayerId: s(d.blackPlayer), createdById: s(d.createdBy),
    creatorColor: d.creatorColor || 'random', source: d.source || 'challenge',
    isPrivate: d.isPrivate !== undefined ? !!d.isPrivate : true,
    isRated: d.isRated !== undefined ? !!d.isRated : true,
    timeControlKind: tc.type, timeControlInitialSeconds: tc.initialSeconds, timeControlIncrementSeconds: tc.incrementSeconds,
    timeControlCustom: !!tc.custom,
    fen: d.fen || LiveGameMongo.START_FEN,
    moves: d.moves || [], sanMoves: d.sanMoves || [], pgn: d.pgn || '',
    status: d.status || 'created', winner: d.winner ?? null, endReason: d.endReason ?? null,
    clockWhiteMs: ck.whiteMs ?? null, clockBlackMs: ck.blackMs ?? null, clockTurnStartedAt: ck.turnStartedAt ?? null,
    drawOfferBy: d.drawOfferBy ?? null,
    ratingRange: d.ratingRange ?? null, rematchOfId: s(d.rematchOf),
    startedAt: d.startedAt ?? null, finishedAt: d.finishedAt ?? null,
  };
};

// $set (с вложенными timeControl/clock/ratingChanges/ratings) → плоский объект колонок PG.
const flattenSet = (set) => {
  const d = {};
  const map = { whitePlayer: 'whitePlayerId', blackPlayer: 'blackPlayerId', createdBy: 'createdById', rematchOf: 'rematchOfId' };
  for (const [k, v] of Object.entries(set || {})) {
    if (k === 'timeControl') { if (v) { d.timeControlKind = v.type; d.timeControlInitialSeconds = v.initialSeconds; d.timeControlIncrementSeconds = v.incrementSeconds; d.timeControlCustom = !!v.custom; } }
    else if (k === 'clock') { d.clockWhiteMs = v?.whiteMs ?? null; d.clockBlackMs = v?.blackMs ?? null; d.clockTurnStartedAt = v?.turnStartedAt ?? null; }
    else if (k === 'ratingChanges') { d.ratingChangesWhite = v?.white ?? null; d.ratingChangesBlack = v?.black ?? null; }
    else if (k === 'ratings') { d.ratingsWhite = v?.white ?? null; d.ratingsBlack = v?.black ?? null; }
    else if (map[k]) d[map[k]] = s(v);
    else d[k] = v;
  }
  return d;
};

const since = (ms) => new Date(Date.now() - ms);

async function countOpenChallenges(userId, ttlMs) {
  if (usePg()) return prisma().liveGame.count({ where: { createdById: s(userId), status: 'created', isPrivate: false, createdAt: { gt: since(ttlMs) } } });
  return LiveGameMongo.countDocuments({ createdBy: userId, status: 'created', isPrivate: false, createdAt: { $gt: since(ttlMs) } });
}

async function create(data) {
  if (usePg()) return pgRowToDoc(await prisma().liveGame.create({ data: createData(data) }));
  return (await LiveGameMongo.create(data)).toObject();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().liveGame.findUnique({ where: { id: s(id) } }));
  return LiveGameMongo.findById(id).lean();
}

async function exists(id) {
  if (usePg()) return !!(await prisma().liveGame.findUnique({ where: { id: s(id) }, select: { id: true } }));
  return !!(await LiveGameMongo.exists({ _id: id }));
}

async function findOpenChallenges(ttlMs, limit = 100) {
  if (usePg()) {
    const rows = await prisma().liveGame.findMany({ where: { status: 'created', isPrivate: false, createdAt: { gt: since(ttlMs) } }, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(pgRowToDoc);
  }
  return LiveGameMongo.find({ status: 'created', isPrivate: false, createdAt: { $gt: since(ttlMs) } }).sort({ createdAt: -1 }).limit(limit).lean();
}

// findOneAndUpdate(filter {_id,status:'created'}, $set {...set,status:'active',startedAt}) → doc|null.
async function startActive(id, set) {
  if (usePg()) {
    const r = await prisma().liveGame.updateMany({ where: { id: s(id), status: 'created' }, data: { ...flattenSet(set), status: 'active', startedAt: new Date() } });
    if (!r.count) return null;
    return pgRowToDoc(await prisma().liveGame.findUnique({ where: { id: s(id) } }));
  }
  return LiveGameMongo.findOneAndUpdate({ _id: id, status: 'created' }, { $set: { ...set, status: 'active', startedAt: new Date() } }, { new: true }).lean();
}

// Отозвать свой created-вызов → true, если нашёлся.
async function cancelOwnChallenge(id, userId) {
  if (usePg()) {
    const r = await prisma().liveGame.updateMany({ where: { id: s(id), createdById: s(userId), status: 'created' }, data: { status: 'aborted', endReason: 'aborted', finishedAt: new Date() } });
    return r.count > 0;
  }
  const res = await LiveGameMongo.updateOne({ _id: id, createdBy: userId, status: 'created' }, { $set: { status: 'aborted', endReason: 'aborted', finishedAt: new Date() } });
  return res.matchedCount > 0;
}

async function findRematchOffer(oldId, createdBy) {
  if (usePg()) return pgRowToDoc(await prisma().liveGame.findFirst({ where: { rematchOfId: s(oldId), status: 'created', createdById: s(createdBy) } }));
  return LiveGameMongo.findOne({ rematchOf: oldId, status: 'created', createdBy }).lean();
}

async function findActiveForUser(userId) {
  if (usePg()) {
    const rows = await prisma().liveGame.findMany({ where: { status: 'active', OR: [{ whitePlayerId: s(userId) }, { blackPlayerId: s(userId) }] }, select: { id: true, timeControlKind: true, timeControlInitialSeconds: true, timeControlIncrementSeconds: true, timeControlCustom: true } });
    return rows.map((r) => ({ _id: r.id, timeControl: { type: r.timeControlKind, initialSeconds: r.timeControlInitialSeconds, incrementSeconds: r.timeControlIncrementSeconds, custom: r.timeControlCustom } }));
  }
  return LiveGameMongo.find({ status: 'active', $or: [{ whitePlayer: userId }, { blackPlayer: userId }] }).select('_id timeControl').lean();
}

async function findCreatedForUser(userId, ttlMs, limit = 10) {
  if (usePg()) {
    const rows = await prisma().liveGame.findMany({ where: { status: 'created', createdById: s(userId), createdAt: { gt: since(ttlMs) } }, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(pgRowToDoc);
  }
  return LiveGameMongo.find({ status: 'created', createdBy: userId, createdAt: { $gt: since(ttlMs) } }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function findHistoryForUser(userId, limit = 20) {
  if (usePg()) {
    const rows = await prisma().liveGame.findMany({ where: { status: { in: ['finished', 'aborted'] }, OR: [{ whitePlayerId: s(userId) }, { blackPlayerId: s(userId) }] }, orderBy: { finishedAt: 'desc' }, take: limit });
    return rows.map(pgRowToDoc);
  }
  return LiveGameMongo.find({ status: { $in: ['finished', 'aborted'] }, $or: [{ whitePlayer: userId }, { blackPlayer: userId }] }).sort({ finishedAt: -1 }).limit(limit).lean();
}

// updateOne({_id,status:'active'}, {$set}) → matchedCount (gameManager finish/snapshot/side-effects).
async function updateActive(id, set) {
  if (usePg()) { const r = await prisma().liveGame.updateMany({ where: { id: s(id), status: 'active' }, data: flattenSet(set) }); return { matchedCount: r.count }; }
  const res = await LiveGameMongo.updateOne({ _id: id, status: 'active' }, { $set: set });
  return { matchedCount: res.matchedCount };
}

// $push moves/sanMoves + $set — с оптимистичным guard moves.$size == plyBefore → matchedCount.
async function pushMove(id, plyBefore, uci, san, set) {
  if (usePg()) {
    const f = flattenSet(set);
    // array_length(NULL для пустого)=NULL → coalesce к 0. Пишем атомарно одним UPDATE с guard по длине.
    const rows = await prisma().$executeRaw`
      UPDATE "livegames"
      SET "moves" = array_append("moves", ${uci}), "sanMoves" = array_append("sanMoves", ${san}),
          "fen" = ${f.fen}, "clockWhiteMs" = ${f.clockWhiteMs}, "clockBlackMs" = ${f.clockBlackMs},
          "clockTurnStartedAt" = ${f.clockTurnStartedAt}, "drawOfferBy" = ${f.drawOfferBy ?? null}, "updatedAt" = now()
      WHERE "id" = ${s(id)} AND "status" = 'active' AND COALESCE(array_length("moves", 1), 0) = ${plyBefore}`;
    return { matchedCount: rows };
  }
  const res = await LiveGameMongo.updateOne(
    { _id: id, status: 'active', moves: { $size: plyBefore } },
    { $push: { moves: uci, sanMoves: san }, $set: set },
  );
  return { matchedCount: res.matchedCount };
}

module.exports = {
  countOpenChallenges, create, findById, exists, findOpenChallenges, startActive, cancelOwnChallenge,
  findRematchOffer, findActiveForUser, findCreatedForUser, findHistoryForUser, updateActive, pushMove,
  usePg, _pgRowToDoc: pgRowToDoc,
};
