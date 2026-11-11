// Импорт партий из PGN-корпуса → PostgreSQL (таблица games).
// Запуск:  node scripts/import-games-pgn.js [--dry] [--minElo=N] [--dir=PATH] [--limit=N]
//   --dry         парсить/считать, не писать.
//   --minElo=N    порог Elo (по умолчанию 2300). Партия проходит, если ОБА Elo >= N,
//                 либо оба Elo отсутствуют (именные GM-подборки pgnmentor без рейтингов).
//                 Если известен только один и он < N — отбрасываем.
//   --dir=PATH    корень с *.pgn (по умолчанию ~/chess-data/games), сканируется рекурсивно.
//   --limit=N     остановиться после N обработанных партий.
//
// Game-модель: id, white, black, result, eco, an(movetext). id = sha1(теги+ходы) →
// дедуп пересечений источников (TWIC ↔ chessnerd) через createMany({skipDuplicates}).

const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry');
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const MIN_ELO = parseInt(arg('minElo', '2300'), 10);
const DIR = arg('dir', path.join(os.homedir(), 'chess-data', 'games'));
const LIMIT = arg('limit', '') ? parseInt(arg('limit', ''), 10) : Infinity;
const BATCH = 2000;

const url = (process.env.DATABASE_URL || '').replace(/([&?])connection_limit=\d+/, '$1connection_limit=5');
const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && p.toLowerCase().endsWith('.pgn')) out.push(p);
  }
  return out;
}

const TAG_RE = /^\[(\w+)\s+"(.*)"\]\s*$/;

function buildGame(lines) {
  const tags = {};
  const moveLines = [];
  for (const l of lines) {
    const m = l.match(TAG_RE);
    if (m) tags[m[1]] = m[2];
    else if (l.trim()) moveLines.push(l.trim());
  }
  const an = moveLines.join(' ').trim();
  if (!an) return null; // партия без ходов — пропуск

  const we = parseInt(tags.WhiteElo, 10);
  const be = parseInt(tags.BlackElo, 10);
  const weOk = Number.isFinite(we);
  const beOk = Number.isFinite(be);
  // Фильтр: оба известны и >= порога, ЛИБО оба отсутствуют (курируемые подборки).
  if (weOk || beOk) {
    if (!(weOk && beOk && we >= MIN_ELO && be >= MIN_ELO)) return null;
  }

  const key = [tags.Event, tags.Site, tags.Date, tags.Round, tags.White, tags.Black, an].join('|');
  const id = crypto.createHash('sha1').update(key).digest('hex');
  return {
    id,
    white: tags.White || null,
    black: tags.Black || null,
    result: tags.Result || null,
    eco: tags.ECO || null,
    an,
  };
}

async function flush(buf) {
  if (DRY || buf.length === 0) return 0;
  // Дедуп внутри батча по id (createMany не любит дубль-PK в одном вызове).
  const seen = new Set();
  const data = buf.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
  const res = await prisma.game.createMany({ data, skipDuplicates: true });
  return res.count;
}

(async () => {
  const t0 = Date.now();
  const files = walk(DIR);
  console.log(`[import-games] dir=${DIR} файлов=${files.length} minElo=${MIN_ELO} dry=${DRY}`);
  const before = await prisma.game.count();
  console.log(`[import-games] games в БД до импорта: ${before}`);

  let kept = 0;
  let dropped = 0;
  let inserted = 0;
  let buf = [];

  for (const file of files) {
    console.log(`[import-games] → ${path.relative(DIR, file)}`);
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    let cur = [];
    const handle = async (lines) => {
      const g = buildGame(lines);
      if (!g) { dropped++; return; }
      buf.push(g); kept++;
      if (buf.length >= BATCH) {
        inserted += await flush(buf); buf = [];
        if (kept % 100000 === 0) {
          const rate = Math.round((kept + dropped) / ((Date.now() - t0) / 1000));
          console.log(`[import-games]   отобрано ${kept}, отброшено ${dropped}, вставлено ${inserted}, ${rate} партий/s`);
        }
      }
    };
    for await (const line of rl) {
      if (line.startsWith('[Event ') && cur.length) { await handle(cur); cur = []; }
      cur.push(line);
      if (kept >= LIMIT) break;
    }
    if (cur.length) await handle(cur);
    rl.close();
    if (kept >= LIMIT) break;
  }
  inserted += await flush(buf);

  const after = DRY ? before : await prisma.game.count();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[import-games] ГОТОВО за ${secs}s: отобрано ${kept}, отброшено(Elo/пустые) ${dropped}, вставлено(новых) ${inserted}`);
  console.log(`[import-games] games в БД: ${before} → ${after} (+${after - before})`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('[import-games] ОШИБКА:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
