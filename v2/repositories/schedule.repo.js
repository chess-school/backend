// Слой хранения расписания (v2 модель 'ScheduleV2', коллекция schedulev2) — ШОВ миграции
// MongoDB → PostgreSQL (strangler, домен 6 Learning). Флаг LEARNING_DB: 'mongo' (по умолчанию) | 'pg'.
// Наружу — форма Mongo-дока: context:{type,refId} (в pg уплощён в contextType/contextRefId),
// coach/contract/club — id-строки. Кросс-джойны (coach→user, context.ref, group) делает приложение.

const mongoose = require('mongoose');
const ScheduleMongo = require('../models/Schedule');

const usePg = () => String(process.env.LEARNING_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); }
  return _prisma;
};
const newId = () => new mongoose.Types.ObjectId().toString();
const s = (v) => (v === undefined || v === null ? v : String(v));

const pgRowToDoc = (r) => r && ({
  _id: r.id,
  club: r.clubId ?? undefined,
  title: r.title,
  description: r.description,
  date: r.date,
  durationMinutes: r.durationMinutes ?? undefined,
  link: r.link,
  status: r.status,
  coach: r.coachId,
  context: { type: r.contextType, refId: r.contextRefId },
  contract: r.contractId ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// Mongo-данные создания/обновления → PG-колонки (undefined не трогаем).
const docToPg = (d) => {
  const o = {};
  if (d.club !== undefined) o.clubId = s(d.club);
  if (d.title !== undefined) o.title = d.title;
  if (d.description !== undefined) o.description = d.description ?? '';
  if (d.date !== undefined) o.date = d.date;
  if (d.durationMinutes !== undefined) o.durationMinutes = d.durationMinutes;
  if (d.link !== undefined) o.link = d.link ?? '';
  if (d.status !== undefined) o.status = d.status;
  if (d.coach !== undefined) o.coachId = s(d.coach);
  if (d.context !== undefined) { o.contextType = d.context.type; o.contextRefId = s(d.context.refId); }
  if (d.contract !== undefined) o.contractId = d.contract ? s(d.contract) : null;
  return o;
};

async function create(data) {
  if (usePg()) {
    const row = await prisma().scheduleV2.create({ data: { id: newId(), ...docToPg(data) } });
    return pgRowToDoc(row);
  }
  return (await ScheduleMongo.create(data)).toObject();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().scheduleV2.findUnique({ where: { id: s(id) } }));
  return ScheduleMongo.findById(id).lean();
}

// Обновить только своё событие (по coach). Возвращает обновлённый док или null.
async function updateOwn(id, coachId, fields) {
  if (usePg()) {
    const r = await prisma().scheduleV2.updateMany({ where: { id: s(id), coachId: s(coachId) }, data: docToPg(fields) });
    if (!r.count) return null;
    return pgRowToDoc(await prisma().scheduleV2.findUnique({ where: { id: s(id) } }));
  }
  return ScheduleMongo.findOneAndUpdate({ _id: id, coach: coachId }, { $set: fields }, { new: true, runValidators: true }).lean();
}

// Удалить только своё событие (по coach). Возвращает удалённый док или null.
async function deleteOwn(id, coachId) {
  if (usePg()) {
    const row = await prisma().scheduleV2.findFirst({ where: { id: s(id), coachId: s(coachId) } });
    if (!row) return null;
    await prisma().scheduleV2.delete({ where: { id: s(id) } });
    return pgRowToDoc(row);
  }
  return ScheduleMongo.findOneAndDelete({ _id: id, coach: coachId }).lean();
}

// Расписание пользователя: он студент индивидуального события, участник группы или тренер события.
async function findForUser({ userId, groupIds = [], coachId = null, club = null, startDate, endDate }) {
  if (usePg()) {
    // OR строим только из заданных критериев (contextRefId — NOT NULL, пустой in:[] безвреден,
    // но равенство null невалидно) — иначе Prisma отвергает фильтр.
    const OR = [];
    if (userId) OR.push({ contextType: 'individual', contextRefId: s(userId) });
    if (groupIds.length) OR.push({ contextType: 'group', contextRefId: { in: groupIds.map(s) } });
    if (coachId) OR.push({ coachId: s(coachId) });
    if (!OR.length) return [];
    const where = { OR };
    if (club) where.clubId = s(club);
    if (startDate || endDate) { where.date = {}; if (startDate) where.date.gte = new Date(startDate); if (endDate) where.date.lte = new Date(endDate); }
    const rows = await prisma().scheduleV2.findMany({ where, orderBy: { date: 'asc' } });
    return rows.map(pgRowToDoc);
  }
  const query = { $or: [
    { 'context.type': 'individual', 'context.refId': userId },
    { 'context.type': 'group', 'context.refId': { $in: groupIds } },
    ...(coachId ? [{ coach: coachId }] : []),
  ] };
  if (club) query.club = club;
  if (startDate || endDate) { query.date = {}; if (startDate) query.date.$gte = new Date(startDate); if (endDate) query.date.$lte = new Date(endDate); }
  return ScheduleMongo.find(query).sort({ date: 'asc' }).lean();
}

// Ближайшие занятия студента (status scheduled, date>=now) — опц. в рамках одного тренера.
async function findUpcomingForStudent({ coachId = null, studentId, groupIds = [], limit = 5 }) {
  if (usePg()) {
    const OR = [];
    if (studentId) OR.push({ contextType: 'individual', contextRefId: s(studentId) });
    if (groupIds.length) OR.push({ contextType: 'group', contextRefId: { in: groupIds.map(s) } });
    if (!OR.length) return [];
    const where = { status: 'scheduled', date: { gte: new Date() }, OR };
    if (coachId) where.coachId = s(coachId);
    const rows = await prisma().scheduleV2.findMany({ where, orderBy: { date: 'asc' }, take: limit });
    return rows.map(pgRowToDoc);
  }
  const q = {
    ...(coachId ? { coach: coachId } : {}),
    status: 'scheduled', date: { $gte: new Date() },
    $or: [
      { 'context.type': 'individual', 'context.refId': studentId },
      { 'context.type': 'group', 'context.refId': { $in: groupIds } },
    ],
  };
  return ScheduleMongo.find(q).select('title date durationMinutes link context').sort({ date: 1 }).limit(limit).lean();
}

// События клуба в диапазоне дат (дашборд владельца «сегодня»).
async function findClubEventsInRange(clubId, start, end) {
  if (usePg()) {
    const rows = await prisma().scheduleV2.findMany({ where: { clubId: s(clubId), date: { gte: start, lt: end } }, orderBy: { date: 'asc' } });
    return rows.map(pgRowToDoc);
  }
  return ScheduleMongo.find({ club: clubId, date: { $gte: start, $lt: end } }).sort({ date: 1 }).lean();
}

// Ближайшие групповые события клуба.
async function findClubUpcomingGroup(clubId, now) {
  if (usePg()) {
    const rows = await prisma().scheduleV2.findMany({ where: { clubId: s(clubId), contextType: 'group', date: { gte: now } }, orderBy: { date: 'asc' } });
    return rows.map(pgRowToDoc);
  }
  return ScheduleMongo.find({ club: clubId, 'context.type': 'group', date: { $gte: now } }).sort({ date: 1 }).lean();
}

// id будущих занятий по контракту (для отмены записи).
async function distinctIdsByContract(contractId) {
  if (usePg()) {
    const rows = await prisma().scheduleV2.findMany({ where: { contractId: s(contractId), status: 'scheduled', date: { gte: new Date() } }, select: { id: true } });
    return rows.map((r) => r.id);
  }
  return (await ScheduleMongo.find({ contract: contractId, status: 'scheduled', date: { $gte: new Date() } }).distinct('_id')).map(String);
}

async function deleteManyByIds(ids) {
  const list = (ids || []).map(s);
  if (!list.length) return;
  if (usePg()) { await prisma().scheduleV2.deleteMany({ where: { id: { in: list } } }); return; }
  await ScheduleMongo.deleteMany({ _id: { $in: list } });
}

module.exports = {
  create, findById, updateOwn, deleteOwn,
  findForUser, findUpcomingForStudent, findClubEventsInRange, findClubUpcomingGroup,
  distinctIdsByContract, deleteManyByIds,
  usePg, _pgRowToDoc: pgRowToDoc,
};
