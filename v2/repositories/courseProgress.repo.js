// Прогресс ученика по курсу-конструктору (Фаза A5). Одна строка = один пройденный блок.
// Новая фича — ТОЛЬКО PostgreSQL (mongo-прошлого нет), поэтому без флага/швов mongo|pg.
const mongoose = require('mongoose');
const prisma = require('../lib/prisma');

const newId = () => new mongoose.Types.ObjectId().toString();

/** Отметить блок пройденным. Идемпотентно по [courseId,studentId,blockId]; повтор не меняет completedAt. */
async function markComplete(courseId, studentId, blockId, chapterId = null) {
  return prisma().courseProgress.upsert({
    where: { courseId_studentId_blockId: { courseId, studentId, blockId } },
    create: { id: newId(), courseId, studentId, blockId, chapterId: chapterId || null },
    update: {},
  });
}

/** Пройденные блоки ученика в курсе. @returns [{blockId, chapterId, completedAt}] */
async function listForStudent(courseId, studentId) {
  return prisma().courseProgress.findMany({
    where: { courseId, studentId },
    select: { blockId: true, chapterId: true, completedAt: true },
  });
}

/** Сводка по курсу: число пройденных блоков и последняя активность каждого ученика. */
async function countsByStudent(courseId) {
  const rows = await prisma().courseProgress.groupBy({
    by: ['studentId'],
    where: { courseId },
    _count: { blockId: true },
    _max: { completedAt: true },
  });
  return rows.map((r) => ({ studentId: r.studentId, completed: r._count.blockId, lastAt: r._max.completedAt }));
}

module.exports = { markComplete, listForStudent, countsByStudent };
