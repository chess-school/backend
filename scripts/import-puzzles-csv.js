// Импорт полной базы задач Lichess: lichess_db_puzzle.csv → PostgreSQL (таблица puzzles).
// Запуск:   node scripts/import-puzzles-csv.js [--dry] [--file=PATH] [--limit=N]
//   --dry        только парсить/считать, ничего не писать.
//   --file=PATH  путь к CSV (по умолчанию ~/chess-data/puzzles/lichess_db_puzzle.csv).
//   --limit=N    остановиться после N распарсенных строк (для прогона).
//
// Идемпотентно: PK = PuzzleId (строка), createMany({skipDuplicates}) — повторный запуск
// не дублирует и не трогает уже существующие 150k (включая книжные задачи с source*).
// Lichess-задачи source не имеют → source* = null.
//
// CSV-колонки (11): PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,
//                   GameUrl,OpeningTags,DailyDate
// Поля без запятых внутри (FEN/Moves/Themes/OpeningTags разделены пробелами) → split(',') безопасен.

const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');
const fileArg = (process.argv.find((a) => a.startsWith('--file=')) || '').slice('--file='.length);
const limitArg = (process.argv.find((a) => a.startsWith('--limit=')) || '').slice('--limit='.length);
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;
const FILE = fileArg || path.join(os.homedir(), 'chess-data', 'puzzles', 'lichess_db_puzzle.csv');
const BATCH = 5000;

// Отдельный клиент с умеренным пулом (5), чтобы не конкурировать с кластером приложения.
const prisma = makeScriptPrisma(5);

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

function parseLine(line) {
  const c = line.split(',');
  if (c.length < 8) return null;
  const id = c[0];
  const fen = c[1];
  if (!id || !fen) return null;
  const rating = toInt(c[3]);
  return {
    id,
    fen,
    moves: c[2] ? c[2].split(' ').filter(Boolean) : [],
    rating: rating == null ? 1500 : rating,
    themes: c[7] ? c[7].split(' ').filter(Boolean) : [],
    popularity: toInt(c[5]),
    nbPlays: toInt(c[6]),
    // Lichess-задачи не книжные:
    sourceKind: null,
    sourceBook: null,
    sourceBookTitle: null,
    sourceExercise: null,
    sourceExerciseNumber: null,
    sourceTitle: null,
    sourceSideToMove: null,
    sourceSolutionSan: [],
    sourcePublished: null,
  };
}

async function flush(buf) {
  if (DRY || buf.length === 0) return 0;
  const res = await prisma.puzzle.createMany({ data: buf, skipDuplicates: true });
  return res.count;
}

(async () => {
  const t0 = Date.now();
  console.log(`[import-puzzles] file=${FILE} dry=${DRY} limit=${LIMIT}`);
  const before = await prisma.puzzle.count();
  console.log(`[import-puzzles] puzzles в БД до импорта: ${before}`);

  const rl = readline.createInterface({ input: fs.createReadStream(FILE), crlfDelay: Infinity });
  let header = true;
  let parsed = 0;
  let inserted = 0;
  let skipped = 0;
  let buf = [];

  for await (const line of rl) {
    if (header) { header = false; continue; }
    if (!line) continue;
    const row = parseLine(line);
    if (!row) { skipped++; continue; }
    buf.push(row);
    parsed++;
    if (buf.length >= BATCH) {
      inserted += await flush(buf);
      buf = [];
      if (parsed % 100000 === 0) {
        const rate = Math.round(parsed / ((Date.now() - t0) / 1000));
        console.log(`[import-puzzles] распарсено ${parsed}, вставлено ${inserted}, ${rate}/s`);
      }
    }
    if (parsed >= LIMIT) break;
  }
  inserted += await flush(buf);

  const after = DRY ? before : await prisma.puzzle.count();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[import-puzzles] ГОТОВО за ${secs}s: распарсено ${parsed}, пропущено(битых) ${skipped}, вставлено(новых) ${inserted}`);
  console.log(`[import-puzzles] puzzles в БД: ${before} → ${after} (+${after - before})`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('[import-puzzles] ОШИБКА:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
