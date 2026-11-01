// Слой хранения задачников (v2 PuzzleBook) — ШОВ миграции MongoDB → PostgreSQL
// (strangler, домен 5 Content). Флаг CONTENT_DB.
//
// PuzzleBook в Mongo активно использует позиционные апдейты подмассива exercises
// ($push / exercises.$ / $elemMatch) и aggregate. В PG exercises лежит одним Json-массивом,
// поэтому правки элемента = read-modify-write. Наружу — форма Mongo-дока (lean), + выделенные
// методы-мутаторы (вместо live-doc .save()). Кросс-ссылки (club/createdBy/allowed*) — app-join.

const mongoose = require('mongoose');
const PuzzleBookMongo = require('../models/PuzzleBook');

const usePg = () => String(process.env.CONTENT_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); }
  return _prisma;
};
const newId = () => new mongoose.Types.ObjectId().toString();

const pgRowToDoc = (r) => r && ({
  _id: r.id,
  club: r.clubId ?? undefined,
  title: r.title,
  description: r.description ?? '',
  createdBy: r.createdById,
  solveSettings: r.solveSettings ?? undefined,
  status: r.status,
  visibility: r.visibility,
  allowedUsers: r.allowedUserIds || [],
  allowedGroups: r.allowedGroupIds || [],
  isArchived: r.isArchived,
  source: { taskId: r.sourceTaskId ?? undefined, importedChapters: r.sourceImportedChapters || [] },
  exercises: r.exercises || [],
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Задачник по id (или null). select — строка mongo-проекции (в pg игнорируется, отдаём полный). */
async function findById(id, { select } = {}) {
  if (usePg()) return pgRowToDoc(await prisma().puzzleBook.findUnique({ where: { id: String(id) } })) || null;
  const q = PuzzleBookMongo.findById(id);
  if (select) q.select(select);
  return q.lean();
}

/** Задачник по source.taskId (или null). Всегда без exercises (как в контроллере). */
async function findByTaskId(taskId) {
  if (usePg()) return pgRowToDoc(await prisma().puzzleBook.findUnique({ where: { sourceTaskId: String(taskId) } })) || null;
  return PuzzleBookMongo.findOne({ 'source.taskId': taskId }, { exercises: 0 }).lean();
}

/** Создать задачник. Бросает дубль (code 11000 / P2002) при гонке по sourceTaskId. */
async function create(data) {
  if (usePg()) {
    try {
      const row = await prisma().puzzleBook.create({ data: {
        id: newId(),
        clubId: data.club != null ? String(data.club) : null,
        title: data.title,
        description: data.description || '',
        createdById: String(data.createdBy),
        status: data.status || 'draft',
        visibility: data.visibility || 'draft',
        allowedUserIds: (data.allowedUsers || []).map(String),
        allowedGroupIds: (data.allowedGroups || []).map(String),
        isArchived: !!data.isArchived,
        sourceTaskId: data.source?.taskId ?? null,
        sourceImportedChapters: data.source?.importedChapters || [],
        exercises: data.exercises || [],
        solveSettings: data.solveSettings ?? undefined,
      } });
      return pgRowToDoc(row);
    } catch (e) { if (e.code === 'P2002') { const err = new Error('dup'); err.code = 11000; throw err; } throw e; }
  }
  const doc = await PuzzleBookMongo.create(data);
  return doc.toObject();
}

/** Атомарно добавить главу (если её ещё нет в importedChapters): exercises += each, chapters += filename. */
async function addChapter(bookId, filename, exercises) {
  if (usePg()) {
    const row = await prisma().puzzleBook.findUnique({ where: { id: String(bookId) } });
    if (!row || (row.sourceImportedChapters || []).includes(filename)) return null;
    // В Mongo subdoc получает _id автоматически — в Json генерим сами (по нему ищут упражнение).
    const withIds = exercises.map((e) => ({ _id: e._id || newId(), ...e }));
    const updated = await prisma().puzzleBook.update({
      where: { id: String(bookId) },
      data: {
        exercises: [...(row.exercises || []), ...withIds],
        sourceImportedChapters: [...(row.sourceImportedChapters || []), filename],
      },
    });
    return pgRowToDoc(updated);
  }
  const updated = await PuzzleBookMongo.findOneAndUpdate(
    { _id: bookId, 'source.importedChapters': { $ne: filename } },
    { $push: { exercises: { $each: exercises }, 'source.importedChapters': filename } },
    { new: true, projection: { exercises: 0 } },
  ).lean();
  return updated;
}

// Поля, которые разрешено менять в updateBook.
const BOOK_SETTABLE = ['title', 'description', 'status', 'visibility', 'allowedUsers', 'allowedGroups', 'isArchived', 'solveSettings'];

/** Частичное обновление полей задачника (patch — подмножество BOOK_SETTABLE). Возвращает lean-док. */
async function updateFields(id, patch) {
  if (usePg()) {
    const data = {};
    for (const k of BOOK_SETTABLE) {
      if (patch[k] === undefined) continue;
      if (k === 'allowedUsers') data.allowedUserIds = (patch[k] || []).map(String);
      else if (k === 'allowedGroups') data.allowedGroupIds = (patch[k] || []).map(String);
      else data[k] = patch[k];
    }
    const row = await prisma().puzzleBook.update({ where: { id: String(id) }, data });
    return pgRowToDoc(row);
  }
  const set = {};
  for (const k of BOOK_SETTABLE) if (patch[k] !== undefined) set[k] = patch[k];
  return PuzzleBookMongo.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
}

/** Одно упражнение книги (для серверной валидации fen/solution) или null. */
async function getExercise(bookId, exerciseId) {
  if (usePg()) {
    const row = await prisma().puzzleBook.findUnique({ where: { id: String(bookId) } });
    const ex = row && (row.exercises || []).find((e) => String(e._id) === String(exerciseId));
    return ex || null;
  }
  const doc = await PuzzleBookMongo.findOne(
    { _id: bookId, 'exercises._id': exerciseId },
    { exercises: { $elemMatch: { _id: exerciseId } } },
  ).lean();
  return doc ? doc.exercises[0] : null;
}

/** Правка полей одного упражнения (fields — { title?, fen?, comment?, hint?, solution? }).
 *  Возвращает { book:{_id,title,status}, exercise } или null, если книги/упражнения нет. */
async function updateExerciseFields(bookId, exerciseId, fields) {
  if (usePg()) {
    const row = await prisma().puzzleBook.findUnique({ where: { id: String(bookId) } });
    if (!row) return null;
    const exercises = row.exercises || [];
    const idx = exercises.findIndex((e) => String(e._id) === String(exerciseId));
    if (idx === -1) return null;
    exercises[idx] = { ...exercises[idx], ...fields };
    const updated = await prisma().puzzleBook.update({ where: { id: String(bookId) }, data: { exercises } });
    return { book: { _id: updated.id, title: updated.title, status: updated.status }, exercise: exercises[idx] };
  }
  const set = {};
  for (const [k, v] of Object.entries(fields)) set[`exercises.$.${k}`] = v;
  const book = await PuzzleBookMongo.findOneAndUpdate(
    { _id: bookId, 'exercises._id': exerciseId },
    { $set: set },
    { new: true, projection: { title: 1, status: 1, exercises: { $elemMatch: { _id: exerciseId } } } },
  ).lean();
  if (!book) return null;
  return { book: { _id: book._id, title: book.title, status: book.status }, exercise: book.exercises[0] };
}

/** Установить рейтинг упражнения (+1 к ratingAttempts). Module 4. */
async function setExerciseRating(bookId, exerciseId, newRating) {
  if (usePg()) {
    const row = await prisma().puzzleBook.findUnique({ where: { id: String(bookId) } });
    if (!row) return;
    const exercises = row.exercises || [];
    const idx = exercises.findIndex((e) => String(e._id) === String(exerciseId));
    if (idx === -1) return;
    exercises[idx] = { ...exercises[idx], rating: newRating, ratingAttempts: (exercises[idx].ratingAttempts || 0) + 1 };
    await prisma().puzzleBook.update({ where: { id: String(bookId) }, data: { exercises } });
    return;
  }
  await PuzzleBookMongo.updateOne(
    { _id: bookId, 'exercises._id': exerciseId },
    { $set: { 'exercises.$.rating': newRating }, $inc: { 'exercises.$.ratingAttempts': 1 } },
  );
}

/**
 * Список задачников для getBooks. access — семантика доступа:
 *   { isStaff:true } (видит все) | { isStaff:false, userId, groupIds }.
 * club — ограничение по клубу (строка) или null. Возвращает проекцию без тел упражнений.
 */
async function listBooks(access, club) {
  const toCard = (b) => ({
    _id: b._id, title: b.title, description: b.description, status: b.status, visibility: b.visibility,
    isArchived: b.isArchived,
    allowedUsersCount: (b.allowedUsers || []).length,
    allowedGroupsCount: (b.allowedGroups || []).length,
    createdAt: b.createdAt, updatedAt: b.updatedAt,
    exercisesCount: (b.exercises || []).length,
  });

  if (usePg()) {
    const where = {};
    if (club) where.clubId = String(club);
    if (!access.isStaff) {
      const uid = String(access.userId);
      const gids = (access.groupIds || []).map(String);
      where.AND = [{ OR: [
        { status: 'published', visibility: { notIn: ['private', 'group'] }, isArchived: false },
        { visibility: 'public', isArchived: false },
        { visibility: 'private', allowedUserIds: { has: uid }, isArchived: false },
        { visibility: 'group', allowedGroupIds: { hasSome: gids.length ? gids : ['__none__'] }, isArchived: false },
      ] }];
    }
    const rows = await prisma().puzzleBook.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map(pgRowToDoc).map(toCard);
  }

  // mongo: тот же смысл через aggregate (как было в контроллере).
  const match = {};
  if (!access.isStaff) {
    const userId = new mongoose.Types.ObjectId(String(access.userId));
    const groupIds = (access.groupIds || []).map((g) => new mongoose.Types.ObjectId(String(g)));
    const notArchived = { isArchived: { $ne: true } };
    match.$or = [
      { status: 'published', visibility: { $nin: ['private', 'group'] }, ...notArchived },
      { visibility: 'public', ...notArchived },
      { visibility: 'private', allowedUsers: userId, ...notArchived },
      { visibility: 'group', allowedGroups: { $in: groupIds }, ...notArchived },
    ];
  }
  if (club) match.club = new mongoose.Types.ObjectId(String(club));
  const books = await PuzzleBookMongo.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $project: {
      title: 1, description: 1, status: 1, visibility: 1, isArchived: 1,
      allowedUsersCount: { $size: { $ifNull: ['$allowedUsers', []] } },
      allowedGroupsCount: { $size: { $ifNull: ['$allowedGroups', []] } },
      createdAt: 1, updatedAt: 1,
      exercisesCount: { $size: '$exercises' },
    } },
  ]);
  return books;
}

module.exports = {
  findById, findByTaskId, create, addChapter, updateFields, getExercise,
  updateExerciseFields, setExerciseRating, listBooks,
  usePg, _pgRowToDoc: pgRowToDoc,
};
