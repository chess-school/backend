// Слой хранения базы задач (v2 Puzzle, коллекция puzzles, ~150k) — ШОВ миграции
// MongoDB → PostgreSQL (strangler, домен 5 Content). Флаг CONTENT_DB.
// source уплощён в колонки sourceKind/sourceBook/... — pgRowToDoc собирает обратно вложенный source
// (у Lichess-задач source=undefined). Наружу — форма Mongo-дока Puzzle.

const mongoose = require('mongoose');
const PuzzleMongo = require('../models/Puzzle');

const usePg = () => String(process.env.CONTENT_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); }
  return _prisma;
};

// PG-строка → Mongo-форма (вложенный source только у книжных задач).
const pgRowToDoc = (r) => {
  if (!r) return r;
  const doc = {
    _id: r.id, fen: r.fen, moves: r.moves || [], rating: r.rating,
    themes: r.themes || [], popularity: r.popularity ?? undefined, nbPlays: r.nbPlays ?? undefined,
  };
  if (r.sourceKind) {
    doc.source = {
      kind: r.sourceKind, book: r.sourceBook ?? undefined, bookTitle: r.sourceBookTitle ?? undefined,
      exercise: r.sourceExercise ?? undefined, exerciseNumber: r.sourceExerciseNumber ?? undefined,
      title: r.sourceTitle ?? undefined, sideToMove: r.sourceSideToMove ?? undefined,
      solutionSan: r.sourceSolutionSan || [], published: r.sourcePublished ?? undefined,
    };
  }
  return doc;
};

// Mongo-форма задачи (с вложенным source) → плоская PG-запись.
const docToPgData = (p) => ({
  id: String(p._id), fen: p.fen, moves: p.moves || [], rating: p.rating,
  themes: p.themes || [], popularity: p.popularity ?? null, nbPlays: p.nbPlays ?? null,
  sourceKind: p.source?.kind ?? null,
  sourceBook: p.source?.book != null ? String(p.source.book) : null,
  sourceBookTitle: p.source?.bookTitle ?? null,
  sourceExercise: p.source?.exercise != null ? String(p.source.exercise) : null,
  sourceExerciseNumber: p.source?.exerciseNumber ?? null,
  sourceTitle: p.source?.title ?? null,
  sourceSideToMove: p.source?.sideToMove ?? null,
  sourceSolutionSan: p.source?.solutionSan || [],
  sourcePublished: p.source?.published ?? null,
});

// --- Mongo-фильтр случайной задачи (как в puzzle.controller) ---
const mongoFilter = ({ kind, bookId, exclude, theme, minRating, maxRating }) => {
  const VISIBLE = { $or: [{ 'source.kind': { $exists: false } }, { 'source.published': true }] };
  const filter = { $and: [VISIBLE] };
  if (kind === 'lichess') filter.$and.push({ 'source.kind': { $exists: false } });
  if (kind === 'book') filter.$and.push({ 'source.kind': 'book' });
  if (bookId) filter.$and.push({ 'source.book': new mongoose.Types.ObjectId(bookId) });
  if (theme) filter.$and.push({ themes: theme });
  if ((minRating !== undefined || maxRating !== undefined) && kind !== 'book') {
    const rating = {};
    if (minRating !== undefined) rating.$gte = minRating;
    if (maxRating !== undefined) rating.$lte = maxRating;
    filter.$and.push(kind === 'all' ? { $or: [{ 'source.kind': 'book' }, { rating }] } : { rating });
  }
  if (exclude) filter._id = { $ne: exclude };
  return filter;
};

// --- PG-where случайной задачи (тот же смысл на плоских колонках) ---
const pgWhere = ({ kind, bookId, exclude, theme, minRating, maxRating }) => {
  const AND = [{ OR: [{ sourceKind: null }, { sourcePublished: true }] }];
  if (kind === 'lichess') AND.push({ sourceKind: null });
  if (kind === 'book') AND.push({ sourceKind: 'book' });
  if (bookId) AND.push({ sourceBook: String(bookId) });
  if (theme) AND.push({ themes: { has: theme } });
  if ((minRating !== undefined || maxRating !== undefined) && kind !== 'book') {
    const rating = {};
    if (minRating !== undefined) rating.gte = Number(minRating);
    if (maxRating !== undefined) rating.lte = Number(maxRating);
    AND.push(kind === 'all' ? { OR: [{ sourceKind: 'book' }, { rating }] } : { rating });
  }
  if (exclude) AND.push({ id: { not: String(exclude) } });
  return { AND };
};

/** Случайная задача по фильтрам. @returns {{count:number, puzzle:object|null}} */
async function getRandom(params) {
  if (usePg()) {
    const where = pgWhere(params);

    // Книжные задачи — малый набор, индекс по sourceBook делает и COUNT, и OFFSET дёшевыми,
    // а точный total нужен UI книги (и ожидается тестами). Оставляем прежнюю точную схему.
    if (params.bookId || params.kind === 'book') {
      const count = await prisma().puzzle.count({ where });
      if (count === 0) return { count: 0, puzzle: null };
      const rows = await prisma().puzzle.findMany({ where, skip: Math.floor(Math.random() * count), take: 1 });
      return { count, puzzle: pgRowToDoc(rows[0]) };
    }

    // Большие таблицы Lichess (~6М): и OFFSET N, и фильтрованный COUNT (особенно по themes[]/
    // kind=all) — это O(N), т.е. 1–3с на каждый запрос Rating Climb/survival. Вместо этого берём
    // задачу индексным seek по @@index([rating]): случайная точка рейтинга + ближайшая задача
    // (монетка вверх/вниз; take:1 останавливает скан на первой подходящей строке — миллисекунды).
    // Пустота набора = !row: seek вверх ОТ target и вниз покрывают всю рейтинговую ось набора.
    // Точный total здесь не считаем — фронт его игнорирует (getRandomPuzzle возвращает лишь задачу).
    const lo = params.minRating !== undefined ? Number(params.minRating) : 400;
    const hi = params.maxRating !== undefined ? Number(params.maxRating) : 3200;
    const target = Math.floor(Math.min(lo, hi) + Math.random() * Math.max(1, Math.abs(hi - lo)));
    const base = where.AND;
    // Каждый seek ограничиваем statement_timeout: для валидного набора задача находится за
    // миллисекунды (GIN по themes + btree по rating), а патологический скан по ПУСТОМУ набору
    // (валидная тема без задач в узком рейтинг-окне и т.п.) обрывается и честно трактуется как
    // «не найдено» вместо многосекундного прохода всей таблицы. 404 на пустой фильтр корректен.
    const seek = async (dir) => {
      try {
        return await prisma().$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 1500");
          return tx.puzzle.findMany({
            where: { AND: [...base, dir === 'up' ? { rating: { gte: target } } : { rating: { lte: target } }] },
            orderBy: { rating: dir === 'up' ? 'asc' : 'desc' },
            take: 1,
          });
        });
      } catch (e) {
        return []; // таймаут/отмена скана → трактуем как отсутствие совпадения в этом направлении
      }
    };
    const first = Math.random() < 0.5 ? 'up' : 'down';
    const row = (await seek(first))[0] || (await seek(first === 'up' ? 'down' : 'up'))[0];
    return { count: row ? 1 : 0, puzzle: row ? pgRowToDoc(row) : null };
  }
  const filter = mongoFilter(params);
  const count = await PuzzleMongo.countDocuments(filter);
  if (count === 0) return { count: 0, puzzle: null };
  const puzzle = await PuzzleMongo.findOne(filter).skip(Math.floor(Math.random() * count)).lean();
  return { count, puzzle };
}

/**
 * N случайных РАЗНЫХ задач Lichess по теме/рейтингу — для пикера конструктора курсов (Фаза B).
 * Повторно дёргает быстрый getRandom (индексный seek + GIN) с дедупом по id; на 6М дубли редки.
 */
async function pickMany({ theme, minRating, maxRating }, count = 8) {
  const want = Math.max(1, Math.min(30, Number(count) || 8));
  const seen = new Set();
  const out = [];
  const maxAttempts = want * 6;
  for (let attempts = 0; out.length < want && attempts < maxAttempts; attempts++) {
    const { puzzle } = await getRandom({ kind: 'lichess', theme, minRating, maxRating });
    if (!puzzle) break; // набор пуст по фильтрам
    const id = String(puzzle._id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(puzzle);
  }
  return out;
}

/** Создать/заменить одну задачу (idempotent upsert по _id). */
async function upsertPuzzle(puzzle) {
  if (usePg()) {
    const data = docToPgData(puzzle);
    const { id, ...rest } = data;
    await prisma().puzzle.upsert({ where: { id }, create: data, update: rest });
    return;
  }
  await PuzzleMongo.replaceOne({ _id: puzzle._id }, puzzle, { upsert: true });
}

/** Пакетно создать/заменить задачи книги (синхронизация). */
async function replaceManyBookPuzzles(puzzles) {
  if (!puzzles.length) return;
  if (usePg()) {
    for (const p of puzzles) await upsertPuzzle(p); // книг немного, упражнений сотни — цикл ок
    return;
  }
  const ops = puzzles.map((p) => ({ replaceOne: { filter: { _id: p._id }, replacement: p, upsert: true } }));
  await PuzzleMongo.bulkWrite(ops, { ordered: false });
}

/** Удалить задачи книги, которых больше нет среди keepIds. */
async function deleteBookPuzzlesExcept(bookId, keepIds) {
  if (usePg()) {
    await prisma().puzzle.deleteMany({ where: { sourceBook: String(bookId), id: { notIn: keepIds.map(String) } } });
    return;
  }
  await PuzzleMongo.deleteMany({ 'source.book': bookId, _id: { $nin: keepIds } });
}

/** Удалить задачу по _id. */
async function deleteById(id) {
  if (usePg()) { await prisma().puzzle.deleteMany({ where: { id: String(id) } }); return; }
  await PuzzleMongo.deleteOne({ _id: id });
}

/** Отразить публикацию/название книги на её задачах. */
async function updateBookPuzzlesMeta(bookId, { published, bookTitle }) {
  if (usePg()) {
    await prisma().puzzle.updateMany({ where: { sourceBook: String(bookId) }, data: { sourcePublished: published, sourceBookTitle: bookTitle } });
    return;
  }
  await PuzzleMongo.updateMany(
    { 'source.book': bookId },
    { $set: { 'source.published': published, 'source.bookTitle': bookTitle } },
  );
}

module.exports = {
  getRandom, pickMany, upsertPuzzle, replaceManyBookPuzzles, deleteBookPuzzlesExcept, deleteById, updateBookPuzzlesMeta,
  usePg, _pgRowToDoc: pgRowToDoc, _docToPgData: docToPgData,
};
