// Слой хранения live-сессий урока (v2 ClassroomSession) — ШОВ Mongo→PG (домен Play/Realtime).
// Флаг PLAY_DB. attendance — массив присутствий: в mongo позиционные $-апдейты, в pg — RMW Json.
// mongo-ветка повторяет прежние операции 1:1 (гейт/classroom-тесты не меняются).
const ClassroomMongo = require('../models/ClassroomSession');

const usePg = () => String(process.env.PLAY_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); } return _prisma; };
const s = (v) => (v == null ? null : String(v));
const newId = () => new (require('mongoose').Types.ObjectId)().toString();

const pgRowToDoc = (r) => r && {
  _id: r.id, club: r.clubId, group: r.groupId, student: r.studentId, coach: r.coachId, schedule: r.scheduleId,
  status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, attendance: r.attendance || [],
  createdAt: r.createdAt, updatedAt: r.updatedAt,
};

// Идемпотентно получить/создать live-сессию по занятию (partial-unique schedule+live страхует гонку).
async function ensureLive({ schedule, group, student, coach, club }) {
  if (usePg()) {
    const existing = await prisma().classroomSession.findFirst({ where: { scheduleId: s(schedule), status: 'live' } });
    if (existing) return pgRowToDoc(existing);
    try {
      return pgRowToDoc(await prisma().classroomSession.create({ data: { id: newId(), scheduleId: s(schedule), groupId: s(group), studentId: s(student), coachId: s(coach), clubId: s(club) || null, status: 'live', startedAt: new Date(), attendance: [] } }));
    } catch (e) {
      if (e.code === 'P2002') return pgRowToDoc(await prisma().classroomSession.findFirst({ where: { scheduleId: s(schedule), status: 'live' } }));
      throw e;
    }
  }
  try {
    return await ClassroomMongo.findOneAndUpdate(
      { schedule, status: 'live' },
      { $setOnInsert: { group, student, coach, schedule, status: 'live', startedAt: new Date(), attendance: [], ...(club ? { club } : {}) } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (e) {
    if (e.code === 11000) return ClassroomMongo.findOne({ schedule, status: 'live' });
    throw e;
  }
}

async function findLiveBySchedule(eventId) {
  if (usePg()) return pgRowToDoc(await prisma().classroomSession.findFirst({ where: { scheduleId: s(eventId), status: 'live' }, orderBy: { startedAt: 'desc' } }));
  return ClassroomMongo.findOne({ schedule: eventId, status: 'live' }).sort({ startedAt: -1 });
}

async function findLiveByGroup(ref) {
  if (usePg()) return pgRowToDoc(await prisma().classroomSession.findFirst({ where: { groupId: s(ref), status: 'live' }, orderBy: { startedAt: 'desc' } }));
  return ClassroomMongo.findOne({ group: ref, status: 'live' }).sort({ startedAt: -1 });
}

async function findById(sessionId) {
  if (usePg()) return pgRowToDoc(await prisma().classroomSession.findUnique({ where: { id: s(sessionId) } }));
  return ClassroomMongo.findById(sessionId).lean();
}

// Отметить присутствие: обновить свою запись или добавить новую (как touch-or-push в mongo).
async function joinAttendance(sessionId, userId, role, now) {
  if (usePg()) {
    const row = await prisma().classroomSession.findUnique({ where: { id: s(sessionId) }, select: { attendance: true } });
    if (!row) return;
    const att = Array.isArray(row.attendance) ? row.attendance : [];
    const i = att.findIndex((a) => String(a.user) === String(userId));
    if (i >= 0) { att[i].lastSeenAt = now; att[i].leftAt = null; }
    else att.push({ user: String(userId), role, joinedAt: now, lastSeenAt: now, leftAt: null });
    await prisma().classroomSession.update({ where: { id: s(sessionId) }, data: { attendance: att } });
    return;
  }
  const touched = await ClassroomMongo.updateOne(
    { _id: sessionId, 'attendance.user': userId },
    { $set: { 'attendance.$.lastSeenAt': now, 'attendance.$.leftAt': null } },
  );
  if (touched.matchedCount === 0) {
    await ClassroomMongo.updateOne(
      { _id: sessionId, 'attendance.user': { $ne: userId } },
      { $push: { attendance: { user: userId, role, joinedAt: now, lastSeenAt: now, leftAt: null } } },
    );
  }
}

async function markLeft(sessionId, userId, now) {
  if (usePg()) {
    const row = await prisma().classroomSession.findUnique({ where: { id: s(sessionId) }, select: { attendance: true } });
    if (!row) return;
    const att = (row.attendance || []).map((a) => (String(a.user) === String(userId) ? { ...a, leftAt: now } : a));
    await prisma().classroomSession.update({ where: { id: s(sessionId) }, data: { attendance: att } });
    return;
  }
  await ClassroomMongo.updateOne({ _id: sessionId, 'attendance.user': userId }, { $set: { 'attendance.$.leftAt': now } });
}

// Завершить сессию: status=ended, endedAt, проставить leftAt всем без выхода. Идемпотентно.
async function end(sessionId, now) {
  if (usePg()) {
    const row = await prisma().classroomSession.findUnique({ where: { id: s(sessionId) } });
    if (!row || row.status === 'ended') return pgRowToDoc(row);
    const att = (row.attendance || []).map((a) => (a.leftAt ? a : { ...a, leftAt: now }));
    return pgRowToDoc(await prisma().classroomSession.update({ where: { id: s(sessionId) }, data: { status: 'ended', endedAt: now, attendance: att } }));
  }
  const session = await ClassroomMongo.findById(sessionId);
  if (!session || session.status === 'ended') return session;
  session.status = 'ended'; session.endedAt = now;
  session.attendance.forEach((a) => { if (!a.leftAt) a.leftAt = now; });
  await session.save();
  return session;
}

async function listByGroup(groupId, limit = 100) {
  if (usePg()) {
    const rows = await prisma().classroomSession.findMany({ where: { groupId: s(groupId) }, orderBy: { startedAt: 'desc' }, take: limit, select: { id: true, status: true, startedAt: true, endedAt: true, scheduleId: true, attendance: true } });
    return rows.map((r) => ({ _id: r.id, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, schedule: r.scheduleId, attendance: r.attendance || [] }));
  }
  return ClassroomMongo.find({ group: groupId }).sort({ startedAt: -1 }).limit(limit).select('status startedAt endedAt schedule attendance').lean();
}

module.exports = { ensureLive, findLiveBySchedule, findLiveByGroup, findById, joinAttendance, markLeft, end, listByGroup, usePg, _pgRowToDoc: pgRowToDoc };
