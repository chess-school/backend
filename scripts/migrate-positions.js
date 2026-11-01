// ETL дебютной статистики: MongoDB Atlas (positions, ~994k) → PostgreSQL.
// Запуск:   node scripts/migrate-positions.js [--dry]
//   --dry   только посчитать источник, ничего не писать в PG.
// Atlas ТОЛЬКО на чтение. Идемпотентно: _id (FEN-строка) = PK (skipDuplicates). m (ходы со
// статистикой) → Json. Большой объём — батчи по 2000. См. MIGRATION-PLAN.md (домен 5).

require('dotenv').config();
const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry');
const BATCH = 2000;

const toRow = (d) => ({
  id: String(d._id),
  t: Number.isFinite(d.t) ? d.t : null,
  m: Array.isArray(d.m) ? d.m : [],
});

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI не задан');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не задан');

  await mongoose.connect(process.env.MONGO_URI);
  const Position = require('../v2/models/Position');
  const prisma = new PrismaClient();

  const total = await Position.countDocuments();
  console.log(`[etl] источник Atlas: ${total} positions`);
  if (DRY) { await mongoose.disconnect(); await prisma.$disconnect(); return; }

  let migrated = 0, skipped = 0;
  const cursor = Position.find().lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const res = await prisma.position.createMany({ data: buf.map(toRow), skipDuplicates: true });
    migrated += res.count;
    skipped += buf.length - res.count;
    buf = [];
    process.stdout.write(`\r[etl] positions: перенесено ${migrated}, дублей ${skipped}   `);
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();
  const inPg = await prisma.position.count();
  console.log(`\n[etl] positions: в PG теперь ${inPg} (перенесено ${migrated}, дублей ${skipped}).`);

  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('\n[etl] ОШИБКА:', e); process.exit(1); });
