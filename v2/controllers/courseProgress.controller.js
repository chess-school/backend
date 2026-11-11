// Прогресс ученика по курсу-конструктору (Фаза A5): свой прогресс (чтение/отметка) + сводка тренеру.
// Доступ к курсу — та же логика, что в getCourseById (buildAccess + findOneWithAccess через швы).
const mongoose = require('mongoose');
const courseProgressRepo = require('../repositories/courseProgress.repo');
const courseRepo = require('../repositories/course.repo');
const trainingContractRepo = require('../repositories/trainingContract.repo');
const userRepo = require('../repositories/user.repo');
const { normalizeCourseContent } = require('../domain/courseContent');
const { buildAccess } = require('./course.controller');

const validId = (id) => mongoose.Types.ObjectId.isValid(id);

/** Все id блоков курса (нормализованный контент) — источник правды для total/валидации. */
const blockIdsOf = (modules) => {
  const content = normalizeCourseContent(modules);
  const chapters = content && Array.isArray(content.chapters) ? content.chapters : [];
  return chapters.flatMap((ch) => (Array.isArray(ch.blocks) ? ch.blocks.map((b) => b.id).filter(Boolean) : []));
};

/** Доступен ли курс запрашивающему (ученику/тренеру). @returns {error?:number, course?:object} */
async function accessibleCourse(req, courseId) {
  if (!validId(courseId)) return { error: 400 };
  const exists = await courseRepo.existsById(courseId);
  if (!exists) return { error: 404 };
  const access = await buildAccess(req);
  const course = await courseRepo.findOneWithAccess(courseId, access);
  if (!course) return { error: 403 };
  return { course };
}

/** GET /courses/:courseId/progress — свой прогресс (пройденные blockId). */
const getMyProgress = async (req, res) => {
  const { courseId } = req.params;
  const { error, course } = await accessibleCourse(req, courseId);
  if (error) return res.status(error).json({ code: 'COURSE_ACCESS', msg: 'No access to this course.' });
  const list = await courseProgressRepo.listForStudent(courseId, req.user.id);
  // Отдаём только блоки, существующие в курсе сейчас (удалённые после прохождения отсеиваем —
  // иначе плеер считал бы долю >100%).
  const valid = new Set(blockIdsOf(course.modules));
  const details = list.filter((b) => valid.has(b.blockId));
  res.json({ data: { completed: details.map((b) => b.blockId), details } });
};

/** POST /courses/:courseId/progress {blockId, chapterId?} — отметить блок пройденным. */
const markProgress = async (req, res) => {
  const { courseId } = req.params;
  const blockId = typeof req.body.blockId === 'string' ? req.body.blockId.trim() : '';
  const chapterId = typeof req.body.chapterId === 'string' ? req.body.chapterId.trim() : null;
  if (!blockId || blockId.length > 100) return res.status(400).json({ code: 'INVALID_BLOCK', msg: 'blockId is required.' });
  const { error, course } = await accessibleCourse(req, courseId);
  if (error) return res.status(error).json({ code: 'COURSE_ACCESS', msg: 'No access to this course.' });
  // Отмечаем только реально существующий в курсе блок — иначе прогресс копил бы «фантомные»
  // строки (подделанный/устаревший blockId), завышая completed в сводке тренера.
  if (!blockIdsOf(course.modules).includes(blockId)) {
    return res.status(404).json({ code: 'BLOCK_NOT_FOUND', msg: 'No such block in this course.' });
  }
  await courseProgressRepo.markComplete(courseId, req.user.id, blockId, chapterId);
  res.json({ data: { ok: true } });
};

/** GET /courses/:courseId/progress/summary — сводка по ученикам (COACH/ADMIN, с доступом к курсу). */
const getProgressSummary = async (req, res) => {
  const { courseId } = req.params;
  const { error, course } = await accessibleCourse(req, courseId);
  if (error) return res.status(error).json({ code: 'COURSE_ACCESS', msg: 'No access to this course.' });

  const blockIds = blockIdsOf(course.modules);
  const total = blockIds.length;
  const contracts = await trainingContractRepo.findMany({ course: courseId });
  const counts = await courseProgressRepo.countsByStudent(courseId, blockIds);
  const countMap = new Map(counts.map((c) => [String(c.studentId), c]));

  // Ученики = из контрактов ∪ те, у кого уже есть прогресс.
  const ids = new Set(contracts.map((c) => String(c.student)).filter(Boolean));
  counts.forEach((c) => ids.add(String(c.studentId)));
  const cards = await userRepo.userCardMap([...ids], ['uuid', 'firstName', 'lastName', 'email', 'avatarUrl']);

  const students = [...ids]
    .map((id) => {
      const card = cards.get(id);
      const c = countMap.get(id);
      const completed = c ? c.completed : 0;
      const name = card ? [card.firstName, card.lastName].filter(Boolean).join(' ') || card.email || id : id;
      return {
        studentId: id,
        uuid: card ? card.uuid : undefined,
        name,
        avatarUrl: card ? card.avatarUrl : undefined,
        completed,
        total,
        percent: total ? Math.round((completed / total) * 100) : 0,
        lastAt: c ? c.lastAt : null,
      };
    })
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));

  res.json({ data: { total, students } });
};

module.exports = { getMyProgress, markProgress, getProgressSummary };
