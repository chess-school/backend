// Слой хранения сдач ДЗ (v2 Submission, коллекция submissions) — ШОВ миграции
// MongoDB → PostgreSQL (strangler, домен 6 Learning). Флаг LEARNING_DB: 'mongo' | 'pg'.
// Наружу — форма Mongo-дока с вложенными review:{comment,reviewedBy,reviewedAt} и
// attachment:{contentType,size,filename}. attachment.data (Bytes) НЕ отдаём в обычных чтениях
// (как select:false) — только через getAttachment(id). Кросс-джойны (student/assignment) — приложение.

const mongoose = require('mongoose');
const SubmissionMongo = require('../models/Submission');

const usePg = () => String(process.env.LEARNING_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); }
  return _prisma;
};
const newId = () => new mongoose.Types.ObjectId().toString();
const s = (v) => (v === undefined || v === null ? v : String(v));

// Колонки без тяжёлого attachmentData (аналог select без +attachment.data).
const PG_SELECT = {
  id: true, clubId: true, assignmentId: true, studentId: true, contentText: true, contentFileUrl: true,
  attachmentContentType: true, attachmentSize: true, attachmentFilename: true,
  submittedAt: true, status: true, reviewComment: true, reviewReviewedBy: true, reviewReviewedAt: true,
  createdAt: true, updatedAt: true,
};

const pgRowToDoc = (r) => r && ({
  _id: r.id,
  club: r.clubId ?? undefined,
  assignment: r.assignmentId,
  student: r.studentId,
  contentText: r.contentText ?? undefined,
  contentFileUrl: r.contentFileUrl ?? undefined,
  attachment: (r.attachmentContentType || r.attachmentFilename)
    ? { contentType: r.attachmentContentType ?? undefined, size: r.attachmentSize ?? undefined, filename: r.attachmentFilename ?? undefined }
    : undefined,
  submittedAt: r.submittedAt,
  status: r.status,
  review: (r.reviewComment || r.reviewReviewedAt || r.reviewReviewedBy)
    ? { comment: r.reviewComment ?? undefined, reviewedBy: r.reviewReviewedBy ?? undefined, reviewedAt: r.reviewReviewedAt ?? undefined }
    : undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// Есть ли хоть одна сдача по ДЗ (deleteAssignment).
async function existsForAssignment(assignmentId) {
  if (usePg()) return !!(await prisma().submission.findFirst({ where: { assignmentId: s(assignmentId) }, select: { id: true } }));
  return !!(await SubmissionMongo.exists({ assignment: assignmentId }));
}

// Сдачи по списку ДЗ в статусе (listSubmissionsForReview). Без attachment.data.
async function findForReview(assignmentIds, status, { limit = 200 } = {}) {
  const ids = (assignmentIds || []).map(s);
  if (usePg()) {
    const rows = await prisma().submission.findMany({
      where: { assignmentId: { in: ids }, status: status || 'submitted' },
      orderBy: { submittedAt: 'desc' }, take: limit, select: PG_SELECT,
    });
    return rows.map(pgRowToDoc);
  }
  return SubmissionMongo.find({ assignment: { $in: assignmentIds }, status: status || 'submitted' })
    .select('assignment student contentText attachment.contentType attachment.size attachment.filename status review submittedAt createdAt updatedAt')
    .sort({ submittedAt: -1 }).limit(limit).lean();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().submission.findUnique({ where: { id: s(id) }, select: PG_SELECT }));
  return SubmissionMongo.findById(id)
    .select('assignment student contentText attachment.contentType attachment.size attachment.filename status review submittedAt createdAt updatedAt')
    .lean();
}

// Проставить ревью (status + review). Возвращает обновлённый док (без attachment.data).
async function setReview(id, { status, review }) {
  if (usePg()) {
    const row = await prisma().submission.update({
      where: { id: s(id) },
      data: {
        status,
        reviewComment: review.comment ?? null,
        reviewReviewedBy: review.reviewedBy ? s(review.reviewedBy) : null,
        reviewReviewedAt: review.reviewedAt ?? null,
      },
      select: PG_SELECT,
    });
    return pgRowToDoc(row);
  }
  return SubmissionMongo.findByIdAndUpdate(id, { $set: { status, review } }, { new: true })
    .select('assignment student contentText attachment.contentType attachment.size attachment.filename status review submittedAt createdAt updatedAt')
    .lean();
}

async function findOneByAssignmentStudent(assignmentId, studentId) {
  if (usePg()) return pgRowToDoc(await prisma().submission.findUnique({ where: { assignmentId_studentId: { assignmentId: s(assignmentId), studentId: s(studentId) } }, select: PG_SELECT }));
  return SubmissionMongo.findOne({ assignment: assignmentId, student: studentId })
    .select('assignment student contentText attachment.contentType attachment.size attachment.filename status review submittedAt createdAt updatedAt')
    .lean();
}

// Сдать/пересдать (upsert), пока сдача не принята. update = { contentText, status, submittedAt, attachment? }.
// 11000/P2002 — гонка с проверкой (работу приняли). Возвращает обновлённый док (без attachment.data).
async function upsertSubmission({ assignmentId, studentId, club }, update) {
  if (usePg()) {
    const data = {
      contentText: update.contentText ?? null,
      status: update.status,
      submittedAt: update.submittedAt,
    };
    if (update.attachment) {
      data.attachmentData = update.attachment.data;
      data.attachmentContentType = update.attachment.contentType ?? null;
      data.attachmentSize = update.attachment.size ?? null;
      data.attachmentFilename = update.attachment.filename ?? null;
    }
    // Гарантия «пока не approved»: обновляем только не принятую; если принята — не трогаем (как $ne approved).
    const existing = await prisma().submission.findUnique({ where: { assignmentId_studentId: { assignmentId: s(assignmentId), studentId: s(studentId) } } });
    if (existing && existing.status === 'approved') { const err = new Error('approved'); err.code = 11000; throw err; }
    const row = await prisma().submission.upsert({
      where: { assignmentId_studentId: { assignmentId: s(assignmentId), studentId: s(studentId) } },
      update: data,
      create: { id: newId(), assignmentId: s(assignmentId), studentId: s(studentId), ...(club ? { clubId: s(club) } : {}), ...data },
      select: PG_SELECT,
    });
    return pgRowToDoc(row);
  }
  return SubmissionMongo.findOneAndUpdate(
    { assignment: assignmentId, student: studentId, status: { $ne: 'approved' } },
    { $set: update, $setOnInsert: { assignment: assignmentId, student: studentId, ...(club ? { club } : {}) } },
    { new: true, upsert: true, runValidators: true, projection: 'assignment student contentText attachment.contentType attachment.size attachment.filename status review submittedAt createdAt updatedAt' },
  );
}

// Сдачи студента по списку ДЗ (listMyAssignments).
async function findByStudentAndAssignments(studentId, assignmentIds) {
  const ids = (assignmentIds || []).map(s);
  if (usePg()) {
    const rows = await prisma().submission.findMany({ where: { studentId: s(studentId), assignmentId: { in: ids } }, select: PG_SELECT });
    return rows.map(pgRowToDoc);
  }
  return SubmissionMongo.find({ student: studentId, assignment: { $in: assignmentIds } })
    .select('assignment student contentText attachment.contentType attachment.size attachment.filename status review submittedAt createdAt updatedAt')
    .lean();
}

// Сдача с бинарным вложением (getSubmissionAttachment). Возвращает { assignment, student, attachment:{data,...} }.
async function getWithAttachment(id) {
  if (usePg()) {
    const r = await prisma().submission.findUnique({ where: { id: s(id) } });
    if (!r) return null;
    return {
      _id: r.id, assignment: r.assignmentId, student: r.studentId,
      attachment: r.attachmentData ? { data: r.attachmentData, contentType: r.attachmentContentType, size: r.attachmentSize, filename: r.attachmentFilename } : undefined,
    };
  }
  return SubmissionMongo.findById(id).select('+attachment.data').lean();
}

// Счётчики сдач по статусам (успеваемость студента). filter = { student, assignmentIds? }.
async function statusCounts({ student, assignmentIds = null }) {
  if (usePg()) {
    const where = { studentId: s(student) };
    if (assignmentIds) where.assignmentId = { in: assignmentIds.map(s) };
    const rows = await prisma().submission.groupBy({ by: ['status'], where, _count: { _all: true } });
    return rows.map((r) => ({ _id: r.status, count: r._count._all }));
  }
  const match = { student };
  if (assignmentIds) match.assignment = { $in: assignmentIds };
  return SubmissionMongo.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
}

module.exports = {
  existsForAssignment, findForReview, findById, setReview, findOneByAssignmentStudent,
  upsertSubmission, findByStudentAndAssignments, getWithAttachment, statusCounts,
  usePg, _pgRowToDoc: pgRowToDoc,
};
