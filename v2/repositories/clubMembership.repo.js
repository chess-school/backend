// Шов хранения членств в клубе (v2 ClubMembership) — strangler Mongo→PG. Флаг TENANT_DB.
// КРИТИЧНО: findActive читается на КАЖДОМ authed-запросе (resolveClubV2). Форма Mongo-дока:
// { _id, club, user, role, status, children, createdAt, updatedAt }.
const mongoose = require('mongoose');
const MembershipMongo = require('../models/ClubMembership');
const clubRepo = require('./club.repo');

const usePg = () => String(process.env.TENANT_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); } return _prisma; };
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

module.exports = { findActive, findByUser, findByUserWithClub, countByClubRole, upsert, usePg, _pgRowToDoc: pgRowToDoc };
