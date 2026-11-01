// Слой хранения сообщений бесед (v2 'MessageV2', коллекция messages) — ШОВ Mongo→PG (MISC_DB).
// Данных сейчас 0. sender джойнится app-level в контроллере.
const MessageMongo = require('../models/Message');

const usePg = () => String(process.env.MISC_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); } return _prisma; };
const s = (v) => (v == null ? null : String(v));

const pgRowToDoc = (r) => r && { _id: r.id, conversation: r.conversationId, sender: r.senderId, text: r.text, createdAt: r.createdAt, updatedAt: r.updatedAt };

// Страница сообщений беседы (новые→старые, skip/limit).
async function findPage(conversationId, skip, limit) {
  if (usePg()) {
    const rows = await prisma().messageV2.findMany({ where: { conversationId: s(conversationId) }, orderBy: { createdAt: 'desc' }, skip, take: limit });
    return rows.map(pgRowToDoc);
  }
  return MessageMongo.find({ conversation: conversationId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

async function countByConversation(conversationId) {
  if (usePg()) return prisma().messageV2.count({ where: { conversationId: s(conversationId) } });
  return MessageMongo.countDocuments({ conversation: conversationId });
}

module.exports = { findPage, countByConversation, usePg, _pgRowToDoc: pgRowToDoc };
