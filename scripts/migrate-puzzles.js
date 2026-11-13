// ETL базы задач: MongoDB Atlas (puzzles, ~150k) → PostgreSQL.
// Запуск:   node scripts/migrate-puzzles.js [--dry]
//   --dry   только посчитать источник, ничего не писать в PG.
// Atlas ТОЛЬКО на чтение. Идемпотентно: _id (строковый id задачи) сохраняется как PK (skipDuplicates).
// source уплощается в колонки sourceKind/sourceBook/... (у Lichess-задач source отсутствует → null).
// См. docs/postgres-migration/MIGRATION-PLAN.md (домен 5).

require('dotenv').config();
const mongoose = require('mongoose');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');
const BATCH = 1000;

const toRow = (d) => ({
  id: String(d._id),
  fen: d.fen,
  moves: d.moves ?? [],
  rating: Number.isFinite(d.rating) ? d.rating : 1500,
  themes: d.themes ?? [],
  popularity: Number.isFinite(d.popularity) ? d.popularity : null,
  nbPlays: Number.isFinite(d.nbPlays) ? d.nbPlays : null,
  sourceKind: d.source?.kind ?? null,
  sourceBook: d.source?.book != null ? String(d.source.book) : null,
  sourceBookTitle: d.source?.bookTitle ?? null,
  sourceExercise: d.source?.exercise != null ? String(d.source.exercise) : null,
  sourceExerciseNumber: Number.isFinite(d.source?.exerciseNumber) ? d.source.exerciseNumber : null,
  sourceTitle: d.source?.title ?? null,
  sourceSideToMove: d.source?.sideToMove ?? null,
  sourceSolutionSan: d.source?.solutionSan ?? [],
  sourcePublished: typeof d.source?.published === 'boolean' ? d.source.published : null,
});

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI не задан');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не задан');

  await mongoose.connect(process.env.MONGO_URI);
  const Puzzle = require('../v2/models/Puzzle');
  const prisma = makeScriptPrisma();

  const total = await Puzzle.countDocuments();
  console.log(`[etl] источник Atlas: ${total} puzzles`);
  if (DRY) { await mongoose.disconnect(); await prisma.$disconnect(); return; }

  let migrated = 0, skipped = 0;
  const cursor = Puzzle.find().lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const res = await prisma.puzzle.createMany({ data: buf.map(toRow), skipDuplicates: true });
    migrated += res.count;
    skipped += buf.length - res.count;
    buf = [];
    process.stdout.write(`\r[etl] puzzles: перенесено ${migrated}, дублей ${skipped}   `);
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();
  const inPg = await prisma.puzzle.count();
  console.log(`\n[etl] puzzles: в PG теперь ${inPg} (перенесено ${migrated}, дублей ${skipped}).`);

  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('\n[etl] ОШИБКА:', e); process.exit(1); });
