// Слой хранения попыток решения (v2 PuzzleAttempt, коллекция puzzleattempts) — ШОВ миграции
// MongoDB → PostgreSQL (strangler, домен 6 Learning). Флаг LEARNING_DB: 'mongo' | 'pg'.
// Наружу — форма Mongo-дока. statsByBook повторяет 2-ступенчатую агрегацию getBookStats
// (свернуть попытки до «лучшего» по упражнению, затем агрегировать по ученику).

const mongoose = require('mongoose');
const PuzzleAttemptMongo = require('../models/PuzzleAttempt');

const usePg = () => String(process.env.LEARNING_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); }
  return _prisma;
};
const newId = () => new mongoose.Types.ObjectId().toString();
const s = (v) => (v === undefined || v === null ? v : String(v));

async function create(data) {
  if (usePg()) {
    await prisma().puzzleAttempt.create({ data: {
      id: newId(),
      studentId: s(data.student),
      puzzleBookId: s(data.puzzleBook),
      exerciseId: String(data.exerciseId),
      solved: data.solved !== false,
      timeTakenSeconds: data.timeTakenSeconds || 0,
      attemptsCount: data.attemptsCount || 0,
      usedHint: data.usedHint === true,
    } });
    return;
  }
  await PuzzleAttemptMongo.create(data);
}

// Статистика по ученикам для задачника (getBookStats). Возвращает строки:
// { _id: studentId, solvedCount, exercisesAttempted, attempts, totalMistakes, totalTimeSeconds, hintsUsed, lastActivity }.
async function statsByBook(bookId) {
  if (usePg()) {
    const rows = await prisma().puzzleAttempt.findMany({ where: { puzzleBookId: s(bookId) } });
    // Ступень 1: свернуть до «лучшего» по (student, exercise).
    const perEx = new Map(); // key student|exercise
    for (const a of rows) {
      const key = `${a.studentId}|${a.exerciseId}`;
      const e = perEx.get(key) || { student: a.studentId, solved: 0, attempts: 0, mistakes: 0, time: 0, hint: 0, last: null };
      e.solved = Math.max(e.solved, a.solved ? 1 : 0);
      e.attempts += 1;
      e.mistakes += a.attemptsCount || 0;
      e.time += a.timeTakenSeconds || 0;
      e.hint = Math.max(e.hint, a.usedHint ? 1 : 0);
      if (!e.last || a.updatedAt > e.last) e.last = a.updatedAt;
      perEx.set(key, e);
    }
    // Ступень 2: агрегировать по ученику.
    const perStudent = new Map();
    for (const e of perEx.values()) {
      const g = perStudent.get(e.student) || { _id: e.student, solvedCount: 0, exercisesAttempted: 0, attempts: 0, totalMistakes: 0, totalTimeSeconds: 0, hintsUsed: 0, lastActivity: null };
      g.solvedCount += e.solved;
      g.exercisesAttempted += 1;
      g.attempts += e.attempts;
      g.totalMistakes += e.mistakes;
      g.totalTimeSeconds += e.time;
      g.hintsUsed += e.hint;
      if (!g.lastActivity || e.last > g.lastActivity) g.lastActivity = e.last;
      perStudent.set(e.student, g);
    }
    return [...perStudent.values()].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  }
  const bookOid = new mongoose.Types.ObjectId(String(bookId));
  return PuzzleAttemptMongo.aggregate([
    { $match: { puzzleBook: bookOid } },
    { $group: {
      _id: { student: '$student', exercise: '$exerciseId' },
      solved: { $max: { $cond: ['$solved', 1, 0] } },
      attempts: { $sum: 1 },
      mistakes: { $sum: '$attemptsCount' },
      time: { $sum: '$timeTakenSeconds' },
      hint: { $max: { $cond: ['$usedHint', 1, 0] } },
      last: { $max: '$updatedAt' },
    } },
    { $group: {
      _id: '$_id.student',
      solvedCount: { $sum: '$solved' },
      exercisesAttempted: { $sum: 1 },
      attempts: { $sum: '$attempts' },
      totalMistakes: { $sum: '$mistakes' },
      totalTimeSeconds: { $sum: '$time' },
      hintsUsed: { $sum: '$hint' },
      lastActivity: { $max: '$last' },
    } },
    { $sort: { lastActivity: -1 } },
  ]);
}

module.exports = { create, statsByBook, usePg };
