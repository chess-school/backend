// Слой хранения чат-комнат (v2 ChatRoom, коллекция chat_rooms) — ШОВ Mongo→PG (MISC_DB).
// Данных сейчас 0; mongo-ветка 1:1 (гейт/chat-тесты не меняются), pg-ветка — форма Mongo-дока.
const ChatRoomMongo = require('../models/ChatRoom');

const usePg = () => String(process.env.MISC_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); } return _prisma; };
const s = (v) => (v == null ? null : String(v));
const newId = () => new (require('mongoose').Types.ObjectId)().toString();

const pgRowToDoc = (r) => r && {
  _id: r.id, members: r.memberIds || [], key: r.key,
  context: { kind: r.contextKind, ...(r.contextRefId ? { refId: r.contextRefId } : {}), ...(r.contextTitle ? { title: r.contextTitle } : {}) },
  lastMessage: r.lastMessageText ? { text: r.lastMessageText, sender: r.lastMessageSenderId, createdAt: r.lastMessageCreatedAt } : undefined,
  lastMessageAt: r.lastMessageAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
};

async function findMyRoom(roomId, userId) {
  if (usePg()) return pgRowToDoc(await prisma().chatRoom.findFirst({ where: { id: s(roomId), memberIds: { has: s(userId) } } }));
  return ChatRoomMongo.findOne({ _id: roomId, members: userId }).lean();
}
async function listForUser(userId) {
  if (usePg()) { const rows = await prisma().chatRoom.findMany({ where: { memberIds: { has: s(userId) } }, orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }] }); return rows.map(pgRowToDoc); }
  return ChatRoomMongo.find({ members: userId }).sort({ lastMessageAt: -1, updatedAt: -1 }).lean();
}
async function findByKey(key) {
  if (usePg()) return pgRowToDoc(await prisma().chatRoom.findUnique({ where: { key } }));
  return ChatRoomMongo.findOne({ key }).lean();
}
async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().chatRoom.findUnique({ where: { id: s(id) } }));
  return ChatRoomMongo.findById(id).lean();
}
// Создать комнату; дубль по key → бросает err.code=11000 (как Mongo), caller ловит.
async function create({ members, key, context }) {
  if (usePg()) {
    try {
      return pgRowToDoc(await prisma().chatRoom.create({ data: { id: newId(), memberIds: members.map(s), key, contextKind: context.kind || 'direct', contextRefId: context.refId || null, contextTitle: context.title || null } }));
    } catch (e) { if (e.code === 'P2002') { const err = new Error('dup'); err.code = 11000; throw err; } throw e; }
  }
  return (await ChatRoomMongo.create({ members, key, context })).toObject();
}
async function updateLastMessage(roomId, lastMessage, lastMessageAt) {
  if (usePg()) { await prisma().chatRoom.update({ where: { id: s(roomId) }, data: { lastMessageText: lastMessage.text, lastMessageSenderId: s(lastMessage.sender), lastMessageCreatedAt: lastMessage.createdAt, lastMessageAt } }); return; }
  await ChatRoomMongo.updateOne({ _id: roomId }, { $set: { lastMessage, lastMessageAt } });
}
async function roomIdsForUser(userId) {
  if (usePg()) return (await prisma().chatRoom.findMany({ where: { memberIds: { has: s(userId) } }, select: { id: true } })).map((r) => r.id);
  return ChatRoomMongo.find({ members: userId }).distinct('_id');
}

module.exports = {
  findMyRoom, listForUser, findByKey, findById, create, updateLastMessage, roomIdsForUser,
  CONTEXT_KINDS: ChatRoomMongo.CONTEXT_KINDS, keyFor: ChatRoomMongo.keyFor,
  usePg, _pgRowToDoc: pgRowToDoc,
};
