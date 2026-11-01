// Слой хранения групповых/личных бесед (v2 'ConversationV2', коллекция conversations) — ШОВ Mongo→PG (MISC_DB).
// Данных сейчас 0. groupContext→user/group джойнится app-level в контроллере (не populate).
const ConversationMongo = require('../models/Conversation');

const usePg = () => String(process.env.MISC_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); } return _prisma; };
const s = (v) => (v == null ? null : String(v));

const pgRowToDoc = (r) => r && {
  _id: r.id, type: r.type, members: r.memberIds || [], groupContext: r.groupContextId || undefined,
  lastMessage: r.lastMessageText ? { text: r.lastMessageText, sender: r.lastMessageSenderId, timestamp: r.lastMessageTimestamp } : undefined,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
};

async function findForUser(userId) {
  if (usePg()) {
    const rows = await prisma().conversationV2.findMany({ where: { memberIds: { has: s(userId) } }, orderBy: { lastMessageTimestamp: 'desc' } });
    return rows.map(pgRowToDoc);
  }
  // mongo: сортировка по lastMessage.timestamp (как было), без populate — groupContext остаётся id.
  return ConversationMongo.find({ members: userId }).sort({ 'lastMessage.timestamp': -1 }).lean();
}

async function findMember(conversationId, userId) {
  if (usePg()) return pgRowToDoc(await prisma().conversationV2.findFirst({ where: { id: s(conversationId), memberIds: { has: s(userId) } } }));
  return ConversationMongo.findOne({ _id: conversationId, members: userId }).lean();
}

module.exports = { findForUser, findMember, usePg, _pgRowToDoc: pgRowToDoc };
