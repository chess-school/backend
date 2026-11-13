// ETL пользователей: MongoDB Atlas (коллекция testusers = v2-модель 'TestUser') → PostgreSQL.
// Запуск:   node scripts/migrate-users.js [--dry]
//   --dry   только посчитать источник, ничего не писать в PG.
// Atlas используется ТОЛЬКО на чтение. Идемпотентно: _id сохраняется как PK,
// повторный запуск пропускает уже перенесённые (skipDuplicates).
// Пароль копируется КАК ЕСТЬ (в Mongo он уже bcrypt-хеш — повторно не хешируем).
// ratings.{speed}.{rating,rd,vol,games} уплощаются в 16 колонок.
//
// Часть миграции домена Identity. См. docs/postgres-migration/MIGRATION-PLAN.md

require('dotenv').config();
const mongoose = require('mongoose');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');
const BATCH = 1000;
const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical'];
const DEF = { rating: 1500, rd: 350, vol: 0.06, games: 0 };

const num = (v, d) => (Number.isFinite(v) ? v : d);

const ratingCols = (d) => SPEEDS.reduce((acc, s) => {
  const r = (d.ratings && d.ratings[s]) || {};
  acc[`${s}Rating`] = num(r.rating, DEF.rating);
  acc[`${s}Rd`] = num(r.rd, DEF.rd);
  acc[`${s}Vol`] = num(r.vol, DEF.vol);
  acc[`${s}Games`] = num(r.games, DEF.games);
  return acc;
}, {});

const toPgRow = (d) => ({
  id: String(d._id),
  uuid: d.uuid || String(d._id), // uuid обязателен и уникален — fallback на _id, если вдруг пусто
  firebaseUID: d.firebaseUID || null, // '' / undefined -> null (sparse unique)
  firstName: d.firstName ?? '',
  lastName: d.lastName ?? '',
  avatarUrl: d.avatarUrl ?? null,
  email: String(d.email || '').toLowerCase(),
  phone: d.phone || null,
  emailVerified: !!d.emailVerified,
  verificationToken: d.verificationToken || null,
  password: d.password, // уже bcrypt-хеш
  roles: Array.isArray(d.roles) && d.roles.length ? d.roles : ['USER'],
  sessionTokenVersion: num(d.sessionTokenVersion, 0),
  ...ratingCols(d),
  puzzleRating: num(d.puzzleRating, 1500),
  puzzleRatingGames: num(d.puzzleRatingGames, 0),
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI не задан');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не задан');

  await mongoose.connect(process.env.MONGO_URI);
  const User = require('../v2/models/User');
  const prisma = makeScriptPrisma();

  const total = await User.countDocuments();
  console.log(`[etl] источник Atlas (testusers): ${total} пользователей`);
  if (DRY) {
    const byRole = await User.aggregate([
      { $unwind: { path: '$roles', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$roles', n: { $sum: 1 } } }, { $sort: { n: -1 } },
    ]);
    console.log('[etl] по ролям:', byRole.map((t) => `${t._id || '(нет)'}=${t.n}`).join(', '));
    await mongoose.disconnect(); await prisma.$disconnect();
    return;
  }

  let migrated = 0, skipped = 0, bad = 0;
  const cursor = User.find().lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const rows = buf.map(toPgRow).filter((r) => {
      if (!r.email || !r.password) { bad += 1; return false; } // битые без email/пароля
      return true;
    });
    const res = await prisma.user.createMany({ data: rows, skipDuplicates: true });
    migrated += res.count;
    skipped += rows.length - res.count;
    buf = [];
    process.stdout.write(`\r[etl] перенесено ${migrated}, дублей ${skipped}, битых ${bad}   `);
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();

  const inPg = await prisma.user.count();
  console.log(`\n[etl] готово. В PG теперь ${inPg} пользователей (перенесено ${migrated}, дублей ${skipped}, битых пропущено ${bad}).`);
  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('\n[etl] ОШИБКА:', e); process.exit(1); });
