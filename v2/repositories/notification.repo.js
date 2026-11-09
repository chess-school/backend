// Слой хранения уведомлений — ШОВ миграции MongoDB → PostgreSQL (strangler).
// Переключается флагом окружения NOTIF_DB: 'mongo' (по умолчанию) | 'pg'.
// Репозиторий ВСЕГДА отдаёт данные в форме Mongo-документа NotificationV2
// ({ _id, recipient, message, description, type, read, metadata:{link,entity:{type,id}},
//   createdAt, updatedAt }), чтобы контракт API и фронта не менялся при переключении.
//
// См. docs/postgres-migration/MIGRATION-PLAN.md (домен 1, пилот).

const mongoose = require('mongoose');
const NotificationMongo = require('../models/Notification');

const usePg = () => String(process.env.NOTIF_DB || 'mongo').toLowerCase() === 'pg';

// Ленивая инициализация Prisma — чтобы при NOTIF_DB=mongo клиент не трогался вовсе.
let _prisma = null;
const prisma = () => {
  if (!_prisma) {
    const { PrismaClient } = require('@prisma/client');
    _prisma = require('../lib/prisma')();
  }
  return _prisma;
};

const newId = () => new mongoose.Types.ObjectId().toString();

// --- мапперы PG <-> форма Mongo-дока ---
const pgRowToDoc = (r) => r && ({
  _id: r.id,
  recipient: r.recipientId,
  message: r.message,
  description: r.description ?? undefined,
  type: r.type,
  read: r.read,
  metadata: {
    ...(r.metadataLink ? { link: r.metadataLink } : {}),
    ...(r.metadataEntityType || r.metadataEntityId
      ? { entity: { type: r.metadataEntityType ?? undefined, id: r.metadataEntityId ?? undefined } }
      : {}),
  },
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const inputToPgData = ({ recipient, type, message, description, link, entity }) => ({
  recipientId: String(recipient),
  type,
  message,
  description: description ?? null,
  metadataLink: link ?? null,
  metadataEntityType: entity?.type ?? null,
  metadataEntityId: entity?.id != null ? String(entity.id) : null,
});

// --- публичный интерфейс (одинаковый для обоих бэкендов) ---

async function create({ recipient, type, message, description, link, entity }) {
  if (usePg()) {
    const row = await prisma().notification.create({
      data: { id: newId(), ...inputToPgData({ recipient, type, message, description, link, entity }) },
    });
    return pgRowToDoc(row);
  }
  const metadata = {
    ...(link ? { link } : {}),
    ...(entity ? { entity } : {}),
  };
  const doc = await NotificationMongo.create({ recipient, type, message, description, metadata });
  return doc;
}

async function listForRecipient(recipientId, limit = 50) {
  if (usePg()) {
    const rows = await prisma().notification.findMany({
      where: { recipientId: String(recipientId) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(pgRowToDoc);
  }
  return NotificationMongo.find({ recipient: recipientId }).sort({ createdAt: -1 }).limit(limit);
}

async function countUnread(recipientId) {
  if (usePg()) {
    return prisma().notification.count({ where: { recipientId: String(recipientId), read: false } });
  }
  return NotificationMongo.countDocuments({ recipient: recipientId, read: false });
}

async function markRead(id, recipientId) {
  if (usePg()) {
    const res = await prisma().notification.updateMany({
      where: { id: String(id), recipientId: String(recipientId) },
      data: { read: true },
    });
    if (!res.count) return null;
    return pgRowToDoc(await prisma().notification.findUnique({ where: { id: String(id) } }));
  }
  return NotificationMongo.findOneAndUpdate(
    { _id: id, recipient: recipientId }, { read: true }, { new: true },
  );
}

async function markAllRead(recipientId) {
  if (usePg()) {
    await prisma().notification.updateMany({
      where: { recipientId: String(recipientId), read: false }, data: { read: true },
    });
    return;
  }
  await NotificationMongo.updateMany({ recipient: recipientId, read: false }, { read: true });
}

async function remove(id, recipientId) {
  if (usePg()) {
    const existing = await prisma().notification.findFirst({
      where: { id: String(id), recipientId: String(recipientId) },
    });
    if (!existing) return null;
    await prisma().notification.delete({ where: { id: String(id) } });
    return pgRowToDoc(existing);
  }
  return NotificationMongo.findOneAndDelete({ _id: id, recipient: recipientId });
}

module.exports = {
  create,
  listForRecipient,
  countUnread,
  markRead,
  markAllRead,
  remove,
  usePg,
  _pgRowToDoc: pgRowToDoc, // для тестов/ETL
};
