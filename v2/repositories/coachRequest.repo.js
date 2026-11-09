// Шов хранения заявок «хочу к этому тренеру» (v2 CoachRequest) — strangler Mongo→PG. Флаг TENANT_DB.
// Форма Mongo-дока: { _id, club, student, coach, experience, goals, status, decidedAt, enrollment, timestamps }.
const mongoose = require('mongoose');
const ReqMongo = require('../models/CoachRequest');

const usePg = () => String(process.env.TENANT_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); } return _prisma; };
const newId = () => new mongoose.Types.ObjectId().toString();

const pgRowToDoc = (r) => r && {
  _id: r.id, club: r.clubId ?? undefined, student: r.studentId, coach: r.coachId,
  experience: r.experience, goals: r.goals, status: r.status,
  decidedAt: r.decidedAt ?? null, enrollment: r.enrollmentId ?? null,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
};
const dup = () => { const e = new Error('duplicate pending request'); e.code = 11000; return e; };

async function existsPending(student, coach) {
  if (usePg()) return !!(await prisma().coachRequest.findFirst({ where: { studentId: String(student), coachId: String(coach), status: 'pending' }, select: { id: true } }));
  return !!(await ReqMongo.exists({ student, coach, status: 'pending' }));
}

async function create(data) {
  if (usePg()) {
    try {
      const row = await prisma().coachRequest.create({ data: {
        id: newId(), clubId: data.club ? String(data.club) : null, studentId: String(data.student),
        coachId: String(data.coach), experience: data.experience, goals: data.goals || '',
        status: data.status || 'pending',
      } });
      return pgRowToDoc(row);
    } catch (e) { if (e.code === 'P2002') throw dup(); throw e; }
  }
  try { return (await ReqMongo.create(data)).toObject(); }
  catch (e) { if (e.code === 11000) throw dup(); throw e; }
}

async function findByStudent(student) {
  if (usePg()) return (await prisma().coachRequest.findMany({ where: { studentId: String(student) }, orderBy: { createdAt: 'desc' } })).map(pgRowToDoc);
  return ReqMongo.find({ student }).sort({ createdAt: -1 }).lean();
}

// listCoachRequests: filter { coach?, club?, status? }, sort createdAt desc, limit 200.
async function findMany({ coach, club, status } = {}) {
  if (usePg()) {
    const where = { ...(coach ? { coachId: String(coach) } : {}), ...(club ? { clubId: String(club) } : {}), ...(status ? { status } : {}) };
    return (await prisma().coachRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })).map(pgRowToDoc);
  }
  return ReqMongo.find({ ...(coach ? { coach } : {}), ...(club ? { club } : {}), ...(status ? { status } : {}) }).sort({ createdAt: -1 }).limit(200).lean();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().coachRequest.findUnique({ where: { id: String(id) } })) || null;
  return ReqMongo.findById(id).lean();
}

// findOneAndUpdate({ _id, status:'pending' }, {$set}) — защита от параллельного решения. -> doc|null.
async function updateIfPending(id, patch = {}) {
  if (usePg()) {
    const data = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.decidedAt !== undefined) data.decidedAt = patch.decidedAt;
    if (patch.enrollment !== undefined) data.enrollmentId = patch.enrollment ? String(patch.enrollment) : null;
    const r = await prisma().coachRequest.updateMany({ where: { id: String(id), status: 'pending' }, data });
    if (!r.count) return null;
    return pgRowToDoc(await prisma().coachRequest.findUnique({ where: { id: String(id) } }));
  }
  return ReqMongo.findOneAndUpdate({ _id: id, status: 'pending' }, { $set: patch }, { new: true }).lean();
}

module.exports = {
  existsPending, create, findByStudent, findMany, findById, updateIfPending, usePg, _pgRowToDoc: pgRowToDoc,
  EXPERIENCE_LEVELS: ReqMongo.EXPERIENCE_LEVELS, REQUEST_STATUSES: ReqMongo.REQUEST_STATUSES, GOALS_MAX: ReqMongo.GOALS_MAX,
};
