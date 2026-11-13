// ETL домена Coaching: MongoDB Atlas (coaches + trainingcontracts) → PostgreSQL.
// Запуск:   node scripts/migrate-coaching.js [--dry]
//   --dry   только посчитать источник, ничего не писать в PG.
// Atlas используется ТОЛЬКО на чтение. Идемпотентно: _id сохраняется как PK,
// повторный запуск пропускает уже перенесённые (skipDuplicates).
// Локализованные поля/fideProfile/payoutInfo/packageSnapshot — JSON; platformRating,
// priceAtPurchase, progress — уплощены в колонки.
//
// Часть миграции домена Coaching. См. docs/postgres-migration/MIGRATION-PLAN.md

require('dotenv').config();
const mongoose = require('mongoose');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');
const BATCH = 1000;
const num = (v, d) => (Number.isFinite(v) ? v : d);
const STATUSES = ['pending_payment', 'pending_approval', 'active', 'completed', 'cancelled', 'refunded'];

const toCoachRow = (d) => ({
  id: String(d._id),
  clubId: d.club ? String(d.club) : null,
  userId: String(d.user),
  headline: d.headline ?? null,
  bio: d.bio ?? null,
  specializations: d.specializations ?? null,
  fideProfile: d.fideProfile ?? null,
  isVerified: !!d.isVerified,
  platformRatingAverage: num(d.platformRating?.average, 0),
  platformRatingCount: num(d.platformRating?.count, 0),
  payoutInfo: d.payoutInfo ?? null,
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toContractRow = (d) => ({
  id: String(d._id),
  clubId: d.club ? String(d.club) : null,
  studentId: String(d.student),
  courseId: String(d.course),
  coachId: String(d.coach),
  groupId: d.group ? String(d.group) : null,
  priceAmount: num(d.priceAtPurchase?.amount, 0),
  priceCurrency: d.priceAtPurchase?.currency ?? '',
  packageSnapshot: d.packageSnapshot ?? null,
  status: STATUSES.includes(d.status) ? d.status : 'pending_payment',
  progressCompletedLessons: (d.progress?.completedLessons || []).map(String),
  progressLessonsCompletedCount: num(d.progress?.lessonsCompletedCount, 0),
  progressPercentage: num(d.progress?.percentage, 0),
  startDate: d.startDate ?? null,
  endDate: d.endDate ?? null,
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

async function migrateCollection(Model, toRow, prismaDelegate, label) {
  const total = await Model.countDocuments();
  console.log(`[etl] источник Atlas: ${total} ${label}`);
  if (DRY) return;
  let migrated = 0, skipped = 0;
  const cursor = Model.find().lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const rows = buf.map(toRow);
    const res = await prismaDelegate.createMany({ data: rows, skipDuplicates: true });
    migrated += res.count;
    skipped += rows.length - res.count;
    buf = [];
    process.stdout.write(`\r[etl] ${label}: перенесено ${migrated}, дублей ${skipped}   `);
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();
  const inPg = await prismaDelegate.count();
  console.log(`\n[etl] ${label}: в PG теперь ${inPg} (перенесено ${migrated}, дублей ${skipped}).`);
}

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI не задан');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не задан');

  await mongoose.connect(process.env.MONGO_URI);
  const Coach = require('../v2/models/Coach');
  const TrainingContract = require('../v2/models/TrainingContract');
  const prisma = makeScriptPrisma();

  await migrateCollection(Coach, toCoachRow, prisma.coach, 'coaches');
  await migrateCollection(TrainingContract, toContractRow, prisma.trainingContract, 'trainingcontracts');

  console.log('\n[etl] готово.');
  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('\n[etl] ОШИБКА:', e); process.exit(1); });
