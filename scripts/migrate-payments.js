// ETL платежей: MongoDB Atlas (коллекция payments) → PostgreSQL.
// Запуск:   node scripts/migrate-payments.js [--dry]
// Atlas только на чтение. Идемпотентно: _id = PK, повтор пропускает перенесённые.
// См. docs/postgres-migration/MIGRATION-PLAN.md (домен 2).

require('dotenv').config();
const mongoose = require('mongoose');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');
const BATCH = 1000;

const toPgRow = (d) => ({
  id: String(d._id),
  clubId: d.club != null ? String(d.club) : null,
  userId: String(d.user),
  contractId: String(d.contract),
  amount: Number(d.amount),
  currency: String(d.currency || '').toUpperCase(),
  paymentGateway: d.paymentGateway,
  gatewayTransactionId: String(d.gatewayTransactionId),
  receiptUrl: d.receiptUrl ?? null,
  status: d.status,
  metadata: d.metadata ?? null,
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

(async () => {
  if (!process.env.MONGO_URI || !process.env.DATABASE_URL) throw new Error('MONGO_URI/DATABASE_URL не заданы');
  await mongoose.connect(process.env.MONGO_URI);
  const Payment = require('../v2/models/Payment');
  const prisma = makeScriptPrisma();

  const total = await Payment.countDocuments();
  console.log(`[etl] источник Atlas: ${total} платежей`);
  if (DRY) { await mongoose.disconnect(); await prisma.$disconnect(); return; }

  let migrated = 0, skipped = 0;
  const cursor = Payment.find().lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const rows = buf.map(toPgRow).filter((r) => r.contractId && r.gatewayTransactionId);
    const res = await prisma.payment.createMany({ data: rows, skipDuplicates: true });
    migrated += res.count; skipped += rows.length - res.count; buf = [];
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();

  const inPg = await prisma.payment.count();
  console.log(`[etl] готово. В PG теперь ${inPg} платежей (перенесено ${migrated}, дублей пропущено ${skipped}).`);
  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('[etl] ОШИБКА:', e); process.exit(1); });
