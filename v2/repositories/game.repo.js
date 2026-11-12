// Слой хранения архива партий (v2 Game, коллекция games ~16900) — ШОВ Mongo→PG (домен Play).
// Флаг PLAY_DB. Справочный поиск по имени игрока и по тексту ходов (an). mongo-ветка 1:1.
const GameMongo = require('../models/Game');

const usePg = () => String(process.env.PLAY_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); } return _prisma; };

const pgRowToDoc = (r) => r && { _id: r.id, white: r.white, black: r.black, result: r.result, eco: r.eco, an: r.an };

// Поиск партий по игроку (регэксп-подстрока, i) — лимит 100, свежие сверху.
async function findByPlayer(regex, limit = 100) {
  if (usePg()) {
    // PG: регистронезависимая подстрока по white/black. regex.source — экранированная строка (без спецсимволов).
    const rows = await prisma().game.findMany({
      where: { OR: [{ white: { contains: regex.source, mode: 'insensitive' } }, { black: { contains: regex.source, mode: 'insensitive' } }] },
      take: limit, orderBy: { id: 'desc' },
    });
    return rows.map(pgRowToDoc);
  }
  return GameMongo.find({ $or: [{ white: regex }, { black: regex }] }).limit(limit).sort({ _id: -1 });
}

// Поиск по тексту ходов (an regex), select white/black/result/an.
async function findByMoves(regex, limit = 100) {
  if (usePg()) {
    const rows = await prisma().game.findMany({ where: { an: { contains: regex.source, mode: 'insensitive' } }, take: limit, select: { id: true, white: true, black: true, result: true, an: true } });
    return rows.map((r) => ({ _id: r.id, white: r.white, black: r.black, result: r.result, an: r.an }));
  }
  return GameMongo.find({ an: { $regex: regex } }).limit(limit).select('white black result an');
}

/** Выборка партий без фильтра — для стартовой позиции (корень всех партий). */
async function sample(limit = 30) {
  if (usePg()) {
    const rows = await prisma().game.findMany({ take: limit, orderBy: { id: 'desc' }, select: { id: true, white: true, black: true, result: true, an: true } });
    return rows.map((r) => ({ _id: r.id, white: r.white, black: r.black, result: r.result, an: r.an }));
  }
  return GameMongo.find().limit(limit).sort({ _id: -1 }).select('white black result an');
}

module.exports = { findByPlayer, findByMoves, sample, usePg, _pgRowToDoc: pgRowToDoc };
