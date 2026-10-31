// ETL уведомлений: MongoDB Atlas (коллекция notificationv2s) → PostgreSQL.
// Запуск:   node scripts/migrate-notifications.js [--dry]
//   --dry   только посчитать источник, ничего не писать в PG.
// Atlas используется ТОЛЬКО на чтение. Идемпотентно: _id сохраняется как PK,
// повторный запуск пропускает уже перенесённые (skipDuplicates).
//
// Часть миграции домена Notification. См. docs/postgres-migration/MIGRATION-PLAN.md

require('dotenv').config();
const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry');
const BATCH = 1000;

const toPgRow = (d) => ({
  id: String(d._id),
  recipientId: String(d.recipient),
  message: d.message ?? '',
  description: d.description ?? null,
  type: d.type,
  read: !!d.read,
  metadataLink: d.metadata?.link ?? null,
  metadataEntityType: d.metadata?.entity?.type ?? null,
  metadataEntityId: d.metadata?.entity?.id != null ? String(d.metadata.entity.id) : null,
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI не задан');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не задан');

  await mongoose.connect(process.env.MONGO_URI);
  const Notification = require('../v2/models/Notification');
  const prisma = new PrismaClient();

  const total = await Notification.countDocuments();
  console.log(`[etl] источник Atlas: ${total} уведомлений`);
  if (DRY) {
    const byType = await Notification.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
    console.log('[etl] по типам:', byType.map((t) => `${t._id}=${t.n}`).join(', '));
    await mongoose.disconnect(); await prisma.$disconnect();
    return;
  }

  let migrated = 0, skipped = 0;
  const cursor = Notification.find().lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const rows = buf.map(toPgRow).filter((r) => r.type); // пропускаем битые без type
    const res = await prisma.notification.createMany({ data: rows, skipDuplicates: true });
    migrated += res.count;
    skipped += rows.length - res.count;
    buf = [];
    process.stdout.write(`\r[etl] перенесено ${migrated}, пропущено(дубли) ${skipped}   `);
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();

  const inPg = await prisma.notification.count();
  console.log(`\n[etl] готово. В PG теперь ${inPg} записей (перенесено ${migrated}, дублей пропущено ${skipped}).`);
  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('\n[etl] ОШИБКА:', e); process.exit(1); });
