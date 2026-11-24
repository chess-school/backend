// Шов хранения членств в клубе (v2 ClubMembership) — strangler Mongo→PG. Флаг TENANT_DB.
// КРИТИЧНО: findActive читается на КАЖДОМ authed-запросе (resolveClubV2). Форма Mongo-дока:
// { _id, club, user, role, status, children, createdAt, updatedAt }.
const mongoose = require('mongoose');
const MembershipMongo = require('../models/ClubMembership');
const clubRepo = require('./club.repo');

const usePg = () => String(process.env.TENANT_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); } return _prisma; };
const newId = () => new mongoose.Types.ObjectId().toString();

const pgRowToDoc = (r) => r && {
  _id: r.id, club: r.clubId, user: r.userId, role: r.role, status: r.status,
  children: r.childrenIds || [], createdAt: r.createdAt, updatedAt: r.updatedAt,
};

// findOne({ club, user, status:'active' }).
async function findActive(club, user) {
  if (usePg()) return pgRowToDoc(await prisma().clubMembership.findFirst({ where: { clubId: String(club), userId: String(user), status: 'active' } })) || null;
  return MembershipMongo.findOne({ club, user, status: 'active' }).lean();
}

// find({ user, status:'active' }).
async function findByUser(user, { status = 'active' } = {}) {
  if (usePg()) return (await prisma().clubMembership.findMany({ where: { userId: String(user), ...(status ? { status } : {}) } })).map(pgRowToDoc);
  return MembershipMongo.find({ user, ...(status ? { status } : {}) }).lean();
}

// Клубы пользователя с подставленным club (getUserClubs: было populate('club')).
async function findByUserWithClub(user) {
  const memberships = await findByUser(user, { status: 'active' });
  const clubIds = [...new Set(memberships.map((m) => String(m.club)))];
  const clubs = await Promise.all(clubIds.map((id) => clubRepo.findById(id)));
  const byId = new Map(clubs.filter(Boolean).map((c) => [String(c._id), c]));
  for (const m of memberships) m.club = byId.get(String(m.club)) || null;
  return memberships;
}

async function countByClubRole(club, role, status = 'active') {
  if (usePg()) return prisma().clubMembership.count({ where: { clubId: String(club), role, status } });
  return MembershipMongo.countDocuments({ club, role, status });
}

// Все членства клуба (для экрана «Участники»). status: undefined = любые кроме removed.
async function findByClub(club, { status } = {}) {
  if (usePg()) {
    const where = { clubId: String(club), ...(status ? { status } : { status: { not: 'removed' } }) };
    return (await prisma().clubMembership.findMany({ where, orderBy: { createdAt: 'asc' } })).map(pgRowToDoc);
  }
  const q = { club, ...(status ? { status } : { status: { $ne: 'removed' } }) };
  return MembershipMongo.find(q).sort({ createdAt: 1 }).lean();
}

// Членство по club+user В ЛЮБОМ статусе (смена роли / удаление / реактивация).
async function findOneAny(club, user) {
  if (usePg()) return pgRowToDoc(await prisma().clubMembership.findFirst({ where: { clubId: String(club), userId: String(user) } })) || null;
  return MembershipMongo.findOne({ club, user }).lean();
}

// Сменить роль участника. -> обновлённый док | null, если членства нет.
async function updateRole(club, user, role) {
  if (usePg()) {
    const existing = await prisma().clubMembership.findFirst({ where: { clubId: String(club), userId: String(user) }, select: { id: true } });
    if (!existing) return null;
    return pgRowToDoc(await prisma().clubMembership.update({ where: { id: existing.id }, data: { role } }));
  }
  return MembershipMongo.findOneAndUpdate({ club, user }, { role }, { new: true }).lean();
}

// Сменить статус участника (active|invited|removed). -> обновлённый док | null.
async function setStatus(club, user, status) {
  if (usePg()) {
    const existing = await prisma().clubMembership.findFirst({ where: { clubId: String(club), userId: String(user) }, select: { id: true } });
    if (!existing) return null;
    return pgRowToDoc(await prisma().clubMembership.update({ where: { id: existing.id }, data: { status } }));
  }
  return MembershipMongo.findOneAndUpdate({ club, user }, { status }, { new: true }).lean();
}

// Upsert членства (club.service: owner при создании клуба). $setOnInsert-семантика.
async function upsert(club, user, { setOnInsert = {} } = {}) {
  if (usePg()) {
    const existing = await prisma().clubMembership.findFirst({ where: { clubId: String(club), userId: String(user) }, select: { id: true } });
    if (existing) return pgRowToDoc(await prisma().clubMembership.findUnique({ where: { id: existing.id } }));
    const row = await prisma().clubMembership.create({ data: {
      id: newId(), clubId: String(club), userId: String(user),
      role: setOnInsert.role || 'student', status: setOnInsert.status || 'active',
      childrenIds: setOnInsert.children || [],
    } });
    return pgRowToDoc(row);
  }
  await MembershipMongo.updateOne({ club, user }, { $setOnInsert: { club, user, ...setOnInsert } }, { upsert: true });
  return MembershipMongo.findOne({ club, user }).lean();
}

module.exports = { findActive, findByUser, findByUserWithClub, findByClub, findOneAny, updateRole, setStatus, countByClubRole, upsert, usePg, _pgRowToDoc: pgRowToDoc };
