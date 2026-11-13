// ETL домена Content (клубный контент): MongoDB Atlas (courses + puzzlebooks + sitesettings) → PostgreSQL.
// Запуск:   node scripts/migrate-content.js [--dry]
//   --dry   только посчитать источник, ничего не писать в PG.
// Atlas ТОЛЬКО на чтение. Идемпотентно: _id сохраняется как PK (skipDuplicates).
// Вложенные modules/exercises/solveSettings/auth/footer/socials/menu → JSON (ObjectId'ы внутри
// уплощаются в hex-строки через JSON-прогон). Массивы ссылок authors/allowedUsers/allowedGroups
// → *_Ids (строки). См. docs/postgres-migration/MIGRATION-PLAN.md (домен 5).

require('dotenv').config();
const mongoose = require('mongoose');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');
const BATCH = 500;
const num = (v, d) => (Number.isFinite(v) ? v : d);
// Глубокая конвертация в простой JSON (ObjectId → hex-строка через toJSON).
const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const ids = (a) => (a || []).map(String);

const toCourseRow = (d) => ({
  id: String(d._id),
  clubId: d.club ? String(d.club) : null,
  title: d.title,
  description: d.description,
  thumbnailUrl: d.thumbnailUrl ?? null,
  authorIds: ids(d.authors),
  isSchoolCourse: !!d.isSchoolCourse,
  modules: plain(d.modules),
  priceAmount: num(d.price?.amount, 0),
  priceCurrency: d.price?.currency ?? 'USD',
  status: d.status ?? 'draft',
  visibility: d.visibility ?? 'draft',
  allowedUserIds: ids(d.allowedUsers),
  allowedGroupIds: ids(d.allowedGroups),
  isArchived: !!d.isArchived,
  level: d.level ?? null,
  tags: d.tags ?? [],
  language: d.language ?? 'en',
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toBookRow = (d) => ({
  id: String(d._id),
  clubId: d.club ? String(d.club) : null,
  title: d.title,
  description: d.description ?? '',
  createdById: String(d.createdBy),
  solveSettings: plain(d.solveSettings),
  status: d.status ?? 'draft',
  visibility: d.visibility ?? 'draft',
  allowedUserIds: ids(d.allowedUsers),
  allowedGroupIds: ids(d.allowedGroups),
  isArchived: !!d.isArchived,
  sourceTaskId: d.source?.taskId ?? null,
  sourceImportedChapters: d.source?.importedChapters ?? [],
  exercises: plain(d.exercises) ?? [],
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toSettingsRow = (d) => ({
  id: String(d._id),
  clubId: String(d.club),
  siteName: d.siteName ?? null,
  logoUrl: d.logoUrl ?? null,
  tagline: d.tagline ?? null,
  auth: plain(d.auth),
  footer: plain(d.footer),
  socials: plain(d.socials),
  menu: plain(d.menu),
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
  const Course = require('../v2/models/Course');
  const PuzzleBook = require('../v2/models/PuzzleBook');
  const SiteSettings = require('../v2/models/SiteSettings');
  const prisma = makeScriptPrisma();

  await migrateCollection(Course, toCourseRow, prisma.course, 'courses');
  await migrateCollection(PuzzleBook, toBookRow, prisma.puzzleBook, 'puzzlebooks');
  await migrateCollection(SiteSettings, toSettingsRow, prisma.siteSettings, 'sitesettings');

  console.log('\n[etl] готово.');
  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('\n[etl] ОШИБКА:', e); process.exit(1); });
