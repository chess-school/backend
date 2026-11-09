// Шов хранения заявок «стать тренером» (v2 CoachApplication) — strangler Mongo→PG. Флаг TENANT_DB.
// Форма Mongo-дока: { _id, club, applicant, headline, motivation, experience, specializations,
// contact, fideProfile, sourceLang, status, adminNote, decidedAt, decidedBy, timestamps }.
const mongoose = require('mongoose');
const AppMongo = require('../models/CoachApplication');

const usePg = () => String(process.env.TENANT_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); } return _prisma; };
const newId = () => new mongoose.Types.ObjectId().toString();

const pgRowToDoc = (r) => r && {
  _id: r.id, club: r.clubId ?? undefined, applicant: r.applicantId,
  headline: r.headline, motivation: r.motivation, experience: r.experience,
  specializations: r.specializations || [], contact: r.contact, fideProfile: r.fideProfile ?? undefined,
  sourceLang: r.sourceLang, status: r.status, adminNote: r.adminNote,
  decidedAt: r.decidedAt ?? null, decidedBy: r.decidedById ?? null,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
};
const dup = () => { const e = new Error('duplicate pending application'); e.code = 11000; return e; };

async function existsPending(applicant) {
  if (usePg()) return !!(await prisma().coachApplication.findFirst({ where: { applicantId: String(applicant), status: 'pending' }, select: { id: true } }));
  return !!(await AppMongo.exists({ applicant, status: 'pending' }));
}

async function create(data) {
  if (usePg()) {
    try {
      const row = await prisma().coachApplication.create({ data: {
        id: newId(), clubId: data.club ? String(data.club) : null, applicantId: String(data.applicant),
        headline: data.headline || '', motivation: data.motivation, experience: data.experience || '',
        specializations: data.specializations || [], contact: data.contact || '',
        fideProfile: data.fideProfile ?? undefined, sourceLang: data.sourceLang || 'en',
        status: data.status || 'pending', adminNote: data.adminNote || '',
      } });
      return pgRowToDoc(row);
    } catch (e) { if (e.code === 'P2002') throw dup(); throw e; }
  }
  try { return (await AppMongo.create(data)).toObject(); }
  catch (e) { if (e.code === 11000) throw dup(); throw e; }
}

async function findLatestByApplicant(applicant) {
  if (usePg()) return pgRowToDoc(await prisma().coachApplication.findFirst({ where: { applicantId: String(applicant) }, orderBy: { createdAt: 'desc' } })) || null;
  return AppMongo.findOne({ applicant }).sort({ createdAt: -1 }).lean();
}

async function findMany({ club, status } = {}) {
  if (usePg()) {
    const where = { ...(club ? { clubId: String(club) } : {}), ...(status ? { status } : {}) };
    return (await prisma().coachApplication.findMany({ where, orderBy: { createdAt: 'desc' } })).map(pgRowToDoc);
  }
  return AppMongo.find({ ...(club ? { club } : {}), ...(status ? { status } : {}) }).sort({ createdAt: -1 }).lean();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().coachApplication.findUnique({ where: { id: String(id) } })) || null;
  return AppMongo.findById(id).lean();
}

async function updateById(id, patch = {}) {
  if (usePg()) {
    const data = {};
    for (const k of ['status', 'adminNote']) if (patch[k] !== undefined) data[k] = patch[k];
    if (patch.decidedAt !== undefined) data.decidedAt = patch.decidedAt;
    if (patch.decidedBy !== undefined) data.decidedById = patch.decidedBy ? String(patch.decidedBy) : null;
    try { return pgRowToDoc(await prisma().coachApplication.update({ where: { id: String(id) }, data })); }
    catch (e) { if (e.code === 'P2025') return null; throw e; }
  }
  const set = {};
  for (const k of ['status', 'adminNote', 'decidedAt', 'decidedBy']) if (patch[k] !== undefined) set[k] = patch[k];
  return AppMongo.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
}

module.exports = {
  existsPending, create, findLatestByApplicant, findMany, findById, updateById, usePg, _pgRowToDoc: pgRowToDoc,
  APPLICATION_STATUSES: AppMongo.APPLICATION_STATUSES, FIDE_TITLES: AppMongo.FIDE_TITLES,
  MOTIVATION_MAX: AppMongo.MOTIVATION_MAX, EXPERIENCE_MAX: AppMongo.EXPERIENCE_MAX,
};
