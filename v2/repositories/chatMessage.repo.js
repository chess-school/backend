// Слой хранения чат-сообщений (v2 ChatMessage, коллекция chat_messages) — ШОВ Mongo→PG (MISC_DB).
// Данных сейчас 0; mongo-ветка 1:1. Курсорная пагинация и счётчик непрочитанных.
const mongoose = require('mongoose');
const ChatMessageMongo = require('../models/ChatMessage');

const usePg = () => String(process.env.MISC_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); } return _prisma; };
const s = (v) => (v == null ? null : String(v));
const newId = () => new mongoose.Types.ObjectId().toString();
const { ObjectId } = mongoose.Types;

const pgRowToDoc = (r) => r && { _id: r.id, room: r.roomId, sender: r.senderId, text: r.text, readAt: r.readAt, clientId: r.clientId, createdAt: r.createdAt, updatedAt: r.updatedAt };

// Непрочитанные (собеседника, readAt=null) по комнатам → Map<roomId, count>.
async function unreadByRoom(userId, roomIds) {
  if (!roomIds.length) return new Map();
  if (usePg()) {
    const rows = await prisma().chatMessage.groupBy({ by: ['roomId'], where: { roomId: { in: roomIds.map(s) }, readAt: null, senderId: { not: s(userId) } }, _count: { _all: true } });
    return new Map(rows.map((r) => [String(r.roomId), r._count._all]));
  }
  const rows = await ChatMessageMongo.aggregate([
    { $match: { room: { $in: roomIds.map((id) => new ObjectId(String(id))) }, readAt: null, sender: { $ne: new ObjectId(String(userId)) } } },
    { $group: { _id: '$room', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

async function findPivot(before, roomId) {
  if (usePg()) return prisma().chatMessage.findFirst({ where: { id: s(before), roomId: s(roomId) }, select: { id: true, createdAt: true } });
  const p = await ChatMessageMongo.findOne({ _id: before, room: roomId }).select('createdAt').lean();
  return p && { id: p._id, createdAt: p.createdAt };
}

// Страница сообщений (новые→старые), size+1 для hasMore. pivot — {id,createdAt} или null.
async function findPage(roomId, pivot, size) {
  if (usePg()) {
    const where = { roomId: s(roomId) };
    if (pivot) where.OR = [{ createdAt: { lt: pivot.createdAt } }, { createdAt: pivot.createdAt, id: { lt: s(pivot.id) } }];
    const rows = await prisma().chatMessage.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: size + 1 });
    return rows.map(pgRowToDoc);
  }
  const filter = { room: roomId };
  if (pivot) filter.$or = [{ createdAt: { $lt: pivot.createdAt } }, { createdAt: pivot.createdAt, _id: { $lt: pivot.id } }];
  return ChatMessageMongo.find(filter).sort({ createdAt: -1, _id: -1 }).limit(size + 1).lean();
}

async function findByClientId(roomId, senderId, clientId) {
  if (usePg()) return pgRowToDoc(await prisma().chatMessage.findFirst({ where: { roomId: s(roomId), senderId: s(senderId), clientId: String(clientId) } }));
  return ChatMessageMongo.findOne({ room: roomId, sender: senderId, clientId: String(clientId) }).lean();
}

async function create({ room, sender, text, clientId }) {
  if (usePg()) return pgRowToDoc(await prisma().chatMessage.create({ data: { id: newId(), roomId: s(room), senderId: s(sender), text, clientId: clientId ? String(clientId).slice(0, 64) : null } }));
  return (await ChatMessageMongo.create({ room, sender, text, ...(clientId ? { clientId: String(clientId).slice(0, 64) } : {}) })).toObject();
}

async function markRead(roomId, userId, readAt) {
  if (usePg()) { const r = await prisma().chatMessage.updateMany({ where: { roomId: s(roomId), senderId: { not: s(userId) }, readAt: null }, data: { readAt } }); return r.count; }
  const { modifiedCount } = await ChatMessageMongo.updateMany({ room: roomId, sender: { $ne: userId }, readAt: null }, { $set: { readAt } });
  return modifiedCount;
}

module.exports = { unreadByRoom, findPivot, findPage, findByClientId, create, markRead, MAX_TEXT: ChatMessageMongo.MAX_TEXT, usePg, _pgRowToDoc: pgRowToDoc };
