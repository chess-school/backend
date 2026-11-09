// Слой хранения домашних заданий (v2 Assignment, коллекция assignments) — ШОВ миграции
// MongoDB → PostgreSQL (strangler, домен 6 Learning). Флаг LEARNING_DB: 'mongo' (по умолчанию) | 'pg'.
// Наружу — форма Mongo-дока: context:{type,refId} (в pg уплощён в contextType/contextRefId),
// author/schedule/puzzleBook/club — id-строки, plan — массив. Кросс-джойны делает приложение.

const mongoose = require('mongoose');
const AssignmentMongo = require('../models/Assignment');

const usePg = () => String(process.env.LEARNING_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); }
  return _prisma;
};
const newId = () => new mongoose.Types.ObjectId().toString();
const s = (v) => (v === undefined || v === null ? v : String(v));

const pgRowToDoc = (r) => r && ({
  _id: r.id,
  club: r.clubId ?? undefined,
  title: r.title,
  description: r.description ?? undefined,
  author: r.authorId,
  context: { type: r.contextType, refId: r.contextRefId },
  lesson: r.lessonId ?? undefined,
  schedule: r.scheduleId ?? undefined,
  dueDate: r.dueDate ?? undefined,
  kind: r.kind,
  puzzleBook: r.puzzleBookId ?? undefined,
  puzzleTarget: r.puzzleTarget,
  plan: Array.isArray(r.plan) ? r.plan : [],
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const docToPg = (d) => {
  const o = {};
  if (d.club !== undefined) o.clubId = s(d.club);
  if (d.title !== undefined) o.title = d.title;
  if (d.description !== undefined) o.description = d.description ?? null;
  if (d.author !== undefined) o.authorId = s(d.author);
  if (d.context !== undefined) { o.contextType = d.context.type; o.contextRefId = s(d.context.refId); }
  if (d.lesson !== undefined) o.lessonId = d.lesson ? s(d.lesson) : null;
  if (d.schedule !== undefined) o.scheduleId = d.schedule ? s(d.schedule) : null;
  if (d.dueDate !== undefined) o.dueDate = d.dueDate || null;
  if (d.kind !== undefined) o.kind = d.kind;
  if (d.puzzleBook !== undefined) o.puzzleBookId = d.puzzleBook ? s(d.puzzleBook) : null;
  if (d.puzzleTarget !== undefined) o.puzzleTarget = d.puzzleTarget;
  if (d.plan !== undefined) o.plan = d.plan || [];
  return o;
};

// Условие аудитории студента: ему лично, через группы или через активные записи на курс.
// {studentId, groupIds, courseIds} — семантика; фильтр строит каждый бэкенд сам.
const mongoAudience = ({ studentId, groupIds = [], courseIds = [] }) => ({
  $or: [
    { 'context.type': 'student', 'context.refId': new mongoose.Types.ObjectId(String(studentId)) },
    { 'context.type': 'group', 'context.refId': { $in: groupIds } },
    { 'context.type': 'course', 'context.refId': { $in: courseIds } },
  ],
});
const pgAudience = ({ studentId, groupIds = [], courseIds = [] }) => ({
  OR: [
    { contextType: 'student', contextRefId: s(studentId) },
    { contextType: 'group', contextRefId: { in: groupIds.map(s) } },
    { contextType: 'course', contextRefId: { in: courseIds.map(s) } },
  ],
});

async function create(data) {
  if (usePg()) {
    try {
      const row = await prisma().assignment.create({ data: { id: newId(), ...docToPg(data) } });
      return pgRowToDoc(row);
    } catch (e) {
      if (e.code === 'P2002') { const err = new Error('duplicate'); err.code = 11000; throw err; }
      throw e;
    }
  }
  return (await AssignmentMongo.create(data)).toObject();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().assignment.findUnique({ where: { id: s(id) } }));
  return AssignmentMongo.findById(id).lean();
}

// ДЗ тренера (listCoachAssignments): по author (+club, +schedule), свежие сверху.
async function findByAuthor({ author, club = null, schedule = null }, { limit = 200 } = {}) {
  if (usePg()) {
    const where = { authorId: s(author) };
    if (club) where.clubId = s(club);
    if (schedule) where.scheduleId = s(schedule);
    const rows = await prisma().assignment.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(pgRowToDoc);
  }
  const query = { author };
  if (club) query.club = club;
  if (schedule) query.schedule = schedule;
  return AssignmentMongo.find(query).sort({ createdAt: -1 }).limit(limit).lean();
}

// id ДЗ по автору (+club) — для выборки сдач и статистики.
async function distinctIdsByAuthor({ author, club = null }) {
  if (usePg()) {
    const where = { authorId: s(author) };
    if (club) where.clubId = s(club);
    const rows = await prisma().assignment.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
  }
  const query = { author };
  if (club) query.club = club;
  return (await AssignmentMongo.find(query).distinct('_id')).map(String);
}

// ДЗ, адресованные студенту (listMyAssignments), свежие по сроку.
async function findForAudience(audience, { limit = 200 } = {}) {
  if (usePg()) {
    const rows = await prisma().assignment.findMany({
      where: pgAudience(audience), orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take: limit,
    });
    return rows.map(pgRowToDoc);
  }
  return AssignmentMongo.find(mongoAudience(audience)).sort({ dueDate: 1, createdAt: -1 }).limit(limit).lean();
}

// Адресовано ли это ДЗ данному студенту (submitAssignment).
async function existsForAudience(assignmentId, audience) {
  if (usePg()) {
    const row = await prisma().assignment.findFirst({ where: { id: s(assignmentId), ...pgAudience(audience) }, select: { id: true } });
    return !!row;
  }
  return !!(await AssignmentMongo.exists({ _id: assignmentId, ...mongoAudience(audience) }));
}

// Автор ли coach этого ДЗ (getSubmissionAttachment).
async function existsAuthored(assignmentId, coachId) {
  if (usePg()) return !!(await prisma().assignment.findFirst({ where: { id: s(assignmentId), authorId: s(coachId) }, select: { id: true } }));
  return !!(await AssignmentMongo.exists({ _id: assignmentId, author: coachId }));
}

async function updateById(id, fields) {
  if (usePg()) return pgRowToDoc(await prisma().assignment.update({ where: { id: s(id) }, data: docToPg(fields) }));
  return AssignmentMongo.findByIdAndUpdate(id, { $set: fields }, { new: true, runValidators: true }).lean();
}

async function deleteById(id) {
  if (usePg()) { await prisma().assignment.delete({ where: { id: s(id) } }); return; }
  await AssignmentMongo.deleteOne({ _id: id });
}

// Снять ссылку на занятие у ДЗ удалённых занятий (schedule → null/unset).
async function clearScheduleByIds(scheduleIds) {
  const list = (scheduleIds || []).map(s);
  if (!list.length) return;
  if (usePg()) { await prisma().assignment.updateMany({ where: { scheduleId: { in: list } }, data: { scheduleId: null } }); return; }
  await AssignmentMongo.updateMany({ schedule: { $in: scheduleIds } }, { $unset: { schedule: 1 } });
}

module.exports = {
  create, findById, findByAuthor, distinctIdsByAuthor, findForAudience,
  existsForAudience, existsAuthored, updateById, deleteById, clearScheduleByIds,
  usePg, _pgRowToDoc: pgRowToDoc,
};
