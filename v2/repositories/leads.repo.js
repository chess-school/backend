// leads.repo.js — хранение заявок на пробное (Lead). Шов MongoDB → PostgreSQL (strangler).
// Флаг MISC_DB: 'mongo' (по умолчанию) | 'pg'. Наружу — форма Mongo-дока Lead.

const mongoose = require('mongoose');
const LeadMongo = require('../models/Lead');

const usePg = () => String(process.env.MISC_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); }
  return _prisma;
};
const newId = () => new mongoose.Types.ObjectId().toString();
const s = (v) => (v == null ? v : String(v));

// PG-строка → форма Mongo-дока.
const pgRowToDoc = (r) => r && {
  _id: r.id, club: r.clubId, source: r.source, pagePath: r.pagePath ?? undefined,
  who: r.who, name: r.name, childAge: r.childAge ?? undefined,
  email: r.email ?? undefined, phone: r.phone ?? undefined,
  level: r.level ?? '', format: r.format ?? '', preferredTime: r.preferredTime ?? undefined,
  coach: r.coachId ?? undefined, group: r.groupId ?? undefined,
  status: r.status, lostReason: r.lostReason ?? undefined, assignee: r.assigneeId ?? undefined, note: r.note ?? undefined,
  consent: { at: r.consentAt ?? undefined, ip: r.consentIp ?? undefined },
  createdAt: r.createdAt, updatedAt: r.updatedAt,
};

// Форма Mongo-дока → колонки PG.
const docToPg = (d) => ({
  clubId: s(d.club), source: d.source || 'site', pagePath: d.pagePath ?? null,
  who: d.who || 'self', name: d.name, childAge: d.childAge ?? null,
  email: d.email ?? null, phone: d.phone ?? null,
  level: d.level || null, format: d.format || null, preferredTime: d.preferredTime ?? null,
  coachId: d.coach ? s(d.coach) : null, groupId: d.group ? s(d.group) : null,
  status: d.status || 'new', lostReason: d.lostReason ?? null,
  assigneeId: d.assignee ? s(d.assignee) : null, note: d.note ?? null,
  consentAt: d.consent?.at ?? null, consentIp: d.consent?.ip ?? null,
});

async function create(data) {
  if (usePg()) {
    const row = await prisma().lead.create({ data: { id: newId(), ...docToPg(data) } });
    return pgRowToDoc(row);
  }
  return (await LeadMongo.create(data)).toObject();
}

async function listByClub(clubId, { status } = {}) {
  if (usePg()) {
    const rows = await prisma().lead.findMany({
      where: { clubId: s(clubId), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    return rows.map(pgRowToDoc);
  }
  return LeadMongo.find({ club: clubId, ...(status ? { status } : {}) }).sort({ createdAt: -1 }).limit(500).lean();
}

async function countNew(clubId) {
  if (usePg()) return prisma().lead.count({ where: { clubId: s(clubId), status: 'new' } });
  return LeadMongo.countDocuments({ club: clubId, status: 'new' });
}

// Обновить заявку ТОЛЬКО в рамках своего клуба (изоляция). Возвращает обновлённый док или null.
async function updateInClub(clubId, id, patch) {
  const allowed = {};
  for (const k of ['status', 'note', 'lostReason']) if (patch[k] !== undefined) allowed[k] = patch[k];
  if (patch.assignee !== undefined) allowed.assignee = patch.assignee;
  if (usePg()) {
    const data = {};
    for (const k of ['status', 'note', 'lostReason']) if (allowed[k] !== undefined) data[k] = allowed[k];
    if (allowed.assignee !== undefined) data.assigneeId = allowed.assignee ? s(allowed.assignee) : null;
    const res = await prisma().lead.updateMany({ where: { id: s(id), clubId: s(clubId) }, data });
    if (!res.count) return null;
    return pgRowToDoc(await prisma().lead.findUnique({ where: { id: s(id) } }));
  }
  return LeadMongo.findOneAndUpdate({ _id: id, club: clubId }, { $set: allowed }, { new: true }).lean();
}

module.exports = { create, listByClub, countNew, updateInClub, usePg };
