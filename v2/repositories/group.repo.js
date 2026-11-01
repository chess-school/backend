// Шов хранения групп (v2 Group) — strangler Mongo→PG. Флаг TENANT_DB.
// Форма Mongo-дока: { _id, club, name, description, coach, members:[userId], status, timestamps }.
// members — массив id (app-join user-карточек делают потребители через userRepo).
const mongoose = require('mongoose');
const GroupMongo = require('../models/Group');

const usePg = () => String(process.env.TENANT_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); } return _prisma; };
const newId = () => new mongoose.Types.ObjectId().toString();

const pgRowToDoc = (r) => r && {
  _id: r.id, club: r.clubId ?? undefined, name: r.name, description: r.description ?? undefined,
  coach: r.coachId, members: r.memberIds || [], status: r.status,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
};
const s = (v) => String(v);

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().group.findUnique({ where: { id: s(id) } })) || null;
  return GroupMongo.findById(id).lean();
}

// find({ members: userId }) [+ _id в ids] [+ coach].
async function findByMember(userId, { ids = null, coach = null } = {}) {
  if (usePg()) {
    const where = { memberIds: { has: s(userId) }, ...(ids ? { id: { in: ids.map(s) } } : {}), ...(coach ? { coachId: s(coach) } : {}) };
    return (await prisma().group.findMany({ where })).map(pgRowToDoc);
  }
  return GroupMongo.find({ members: userId, ...(ids ? { _id: { $in: ids } } : {}), ...(coach ? { coach } : {}) }).lean();
}

// id групп, где пользователь — участник (было .distinct('_id')).
async function memberGroupIds(userId) {
  return (await findByMember(userId)).map((g) => g._id);
}

async function findByClub(club) {
  if (usePg()) return (await prisma().group.findMany({ where: { clubId: s(club) } })).map(pgRowToDoc);
  return GroupMongo.find({ club }).lean();
}

async function countByClub(club) {
  if (usePg()) return prisma().group.count({ where: { clubId: s(club) } });
  return GroupMongo.countDocuments({ club });
}

async function findByIds(ids) {
  const list = (ids || []).map(s);
  if (usePg()) return (await prisma().group.findMany({ where: { id: { in: list } } })).map(pgRowToDoc);
  return GroupMongo.find({ _id: { $in: list } }).lean();
}

// find({ coach, club? }) sort createdAt desc (getMyGroups).
async function findMany({ coach, club } = {}) {
  if (usePg()) {
    const where = { ...(coach ? { coachId: s(coach) } : {}), ...(club ? { clubId: s(club) } : {}) };
    return (await prisma().group.findMany({ where, orderBy: { createdAt: 'desc' } })).map(pgRowToDoc);
  }
  return GroupMongo.find({ ...(coach ? { coach } : {}), ...(club ? { club } : {}) }).sort({ createdAt: -1 }).lean();
}

async function create(data) {
  if (usePg()) {
    const row = await prisma().group.create({ data: {
      id: newId(), clubId: data.club ? s(data.club) : null, name: data.name,
      description: data.description ?? null, coachId: s(data.coach),
      memberIds: (data.members || []).map(s), status: data.status || 'active',
    } });
    return pgRowToDoc(row);
  }
  return (await GroupMongo.create(data)).toObject();
}

// Атомарно добавить участника, только если его ещё нет (было updateOne {members:$ne}+$addToSet).
// -> { matchedCount, modifiedCount } (matchedCount=0 => уже участник).
async function addMember(groupId, userId) {
  if (usePg()) {
    const r = await prisma().group.updateMany({
      where: { id: s(groupId), NOT: { memberIds: { has: s(userId) } } },
      data: { memberIds: { push: s(userId) } },
    });
    return { matchedCount: r.count, modifiedCount: r.count };
  }
  const r = await GroupMongo.updateOne({ _id: groupId, members: { $ne: userId } }, { $addToSet: { members: userId } });
  return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount };
}

// Убрать участника ($pull, только если он там есть). PG-массив: read-modify-write.
// -> { matchedCount, modifiedCount } (matchedCount=0 => его не было).
async function removeMember(groupId, userId) {
  if (usePg()) {
    const g = await prisma().group.findUnique({ where: { id: s(groupId) }, select: { memberIds: true } });
    if (!g || !g.memberIds.includes(s(userId))) return { matchedCount: 0, modifiedCount: 0 };
    await prisma().group.update({ where: { id: s(groupId) }, data: { memberIds: { set: g.memberIds.filter((m) => m !== s(userId)) } } });
    return { matchedCount: 1, modifiedCount: 1 };
  }
  const r = await GroupMongo.updateOne({ _id: groupId, members: userId }, { $pull: { members: userId } });
  return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount };
}

module.exports = {
  findById, findByMember, memberGroupIds, findByClub, countByClub, findByIds, findMany,
  create, addMember, removeMember, usePg, _pgRowToDoc: pgRowToDoc,
};
