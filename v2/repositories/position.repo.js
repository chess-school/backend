// Слой хранения дебютной статистики позиций (v2 Position, коллекция positions, ~994k) —
// ШОВ миграции MongoDB → PostgreSQL (strangler, домен 5 Content). Флаг CONTENT_DB.
// id = FEN (без счётчиков ходов — как кладёт chessDB.controller). m = ходы со статистикой (Json).

const PositionMongo = require('../models/Position');

const usePg = () => String(process.env.CONTENT_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); }
  return _prisma;
};

const pgRowToDoc = (r) => r && ({ _id: r.id, t: r.t ?? undefined, m: r.m ?? [] });

/** Позиция по FEN (или null). */
async function findByFen(fen) {
  if (usePg()) return pgRowToDoc(await prisma().position.findUnique({ where: { id: String(fen) } })) || null;
  return PositionMongo.findById(fen).lean();
}

module.exports = { findByFen, usePg, _pgRowToDoc: pgRowToDoc };
