// Шов хранения игровых профилей (v2 модель 'PlayerV2', коллекция playerv2) — strangler Mongo→PG.
// Флаг TENANT_DB. Рейтинги быстрых партий (отдельно от User.ratings Glicko-2). Создаётся при
// регистрации. Форма Mongo-дока: { _id, user, ratings:{bullet,blitz,rapid,classic}, stats:{totalWins} }.
const mongoose = require('mongoose');
const PlayerMongo = require('../models/Player');

const usePg = () => String(process.env.TENANT_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); } return _prisma; };
const newId = () => new mongoose.Types.ObjectId().toString();

const DEFAULT_RATINGS = () => ({
  bullet: { rating: 1200, gamesPlayed: 0 }, blitz: { rating: 1200, gamesPlayed: 0 },
  rapid: { rating: 1200, gamesPlayed: 0 }, classic: { rating: 1200, gamesPlayed: 0 },
});

const pgRowToDoc = (r) => r && {
  _id: r.id, user: r.userId, ratings: r.ratings ?? DEFAULT_RATINGS(),
  stats: { totalWins: r.statsTotalWins }, createdAt: r.createdAt, updatedAt: r.updatedAt,
};

async function findByUser(userId) {
  if (usePg()) return pgRowToDoc(await prisma().playerV2.findUnique({ where: { userId: String(userId) } })) || null;
  return PlayerMongo.findOne({ user: userId }).lean();
}

// Создать профиль игрока при регистрации (идемпотентно по userId).
async function createForUser(userId) {
  if (usePg()) {
    const row = await prisma().playerV2.upsert({
      where: { userId: String(userId) },
      update: {},
      create: { id: newId(), userId: String(userId), ratings: DEFAULT_RATINGS(), statsTotalWins: 0 },
    });
    return pgRowToDoc(row);
  }
  const doc = new PlayerMongo({ user: userId });
  await doc.save();
  return doc.toObject();
}

module.exports = { findByUser, createForUser, usePg, _pgRowToDoc: pgRowToDoc };
