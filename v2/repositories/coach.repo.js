// Слой хранения профилей тренеров (v2 Coach, коллекция coaches) —
// ШОВ миграции MongoDB → PostgreSQL (strangler, домен 4 Coaching).
// Переключается флагом COACHING_DB: 'mongo' (по умолчанию) | 'pg'.
//
// ВАЖНО: джойн Coach→User делается на уровне ПРИЛОЖЕНИЯ через userRepo (а не Mongoose
// populate('user')), поэтому работает одинаково при любом сочетании COACHING_DB/USER_DB —
// это снимает кросс-БД ландмайн и не зависит от того, где лежат пользователи.
//
// Репозиторий отдаёт данные в форме Mongo-дока Coach:
//   { _id, club, user, headline, bio, specializations, fideProfile, isVerified,
//     platformRating:{average,count}, payoutInfo, createdAt, updatedAt }
// Методы с суффиксом WithUser возвращают coach.user = публичная карточка пользователя.
//
// См. docs/postgres-migration/MIGRATION-PLAN.md (домен 4, coaching).

const mongoose = require('mongoose');
const CoachMongo = require('../models/Coach');
const userRepo = require('./user.repo');

const usePg = () => String(process.env.COACHING_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) {
    const { PrismaClient } = require('@prisma/client');
    _prisma = new PrismaClient();
  }
  return _prisma;
};

const newId = () => new mongoose.Types.ObjectId().toString();

// PG-строка -> форма Mongo-дока Coach.
const pgRowToDoc = (r) => r && {
  _id: r.id,
  club: r.clubId ?? undefined,
  user: r.userId,
  headline: r.headline ?? undefined,
  bio: r.bio ?? undefined,
  specializations: r.specializations ?? undefined,
  fideProfile: r.fideProfile ?? undefined,
  isVerified: r.isVerified,
  platformRating: { average: r.platformRatingAverage, count: r.platformRatingCount },
  payoutInfo: r.payoutInfo ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
};

// Поля публичной карточки пользователя для populate('user') (как в catalog/getMe/club).
const USER_CARD = (u) => u && {
  _id: u._id, uuid: u.uuid, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl,
};

// Прикладной джойн: подставить coach.user = карточка пользователя (батч через userRepo).
async function attachUsers(coaches) {
  const list = coaches.filter(Boolean);
  if (!list.length) return coaches;
  const ids = [...new Set(list.map((c) => String(c.user)).filter(Boolean))];
  const users = await userRepo.findByIdList(ids);
  const byId = new Map(users.map((u) => [String(u._id), USER_CARD(u)]));
  for (const c of list) c.user = byId.get(String(c.user)) || null;
  return coaches;
}

// --- Поля localized/прочие для PG-записи (undefined-поля не трогаем) ---
const COACH_SETTABLE = ['headline', 'bio', 'specializations', 'fideProfile', 'isVerified', 'platformRating', 'payoutInfo', 'club'];
const pgSetData = (set) => {
  const d = {};
  for (const k of Object.keys(set || {})) {
    if (!COACH_SETTABLE.includes(k)) continue;
    if (k === 'platformRating') {
      if (set.platformRating.average !== undefined) d.platformRatingAverage = set.platformRating.average;
      if (set.platformRating.count !== undefined) d.platformRatingCount = set.platformRating.count;
    } else if (k === 'club') {
      d.clubId = set.club ?? null;
    } else {
      d[k] = set[k];
    }
  }
  return d;
};

// =====================================================================

async function findByUser(userId) {
  if (usePg()) return pgRowToDoc(await prisma().coach.findUnique({ where: { userId: String(userId) } })) || null;
  return CoachMongo.findOne({ user: userId }).lean();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().coach.findUnique({ where: { id: String(id) } })) || null;
  return CoachMongo.findById(id).lean();
}

async function existsById(id) {
  if (usePg()) return !!(await prisma().coach.findUnique({ where: { id: String(id) }, select: { id: true } }));
  return !!(await CoachMongo.exists({ _id: id }));
}

// [{ _id, user }] по массиву id (chat.service select('user')).
async function findByIds(ids) {
  const list = (ids || []).map(String);
  if (usePg()) {
    const rows = await prisma().coach.findMany({ where: { id: { in: list } }, select: { id: true, userId: true } });
    return rows.map((r) => ({ _id: r.id, user: r.userId }));
  }
  return CoachMongo.find({ _id: { $in: list } }).select('user').lean();
}

// Прикладной джойн: подставить doc[field] (ссылка на Coach) = coach-док с user-карточкой.
// Батч через findByIds+attachUsers. Замена Mongoose populate({ path: field, populate: { path: 'user' } }).
async function attachCoachField(docs, field = 'coach') {
  const list = (Array.isArray(docs) ? docs : [docs]).filter(Boolean);
  if (!list.length) return docs;
  const ids = [...new Set(list.map((d) => d[field]).filter(Boolean).map(String))];
  const coaches = await findByIds(ids);
  await attachUsers(coaches);
  const byId = new Map(coaches.map((c) => [String(c._id), c]));
  for (const d of list) d[field] = d[field] ? (byId.get(String(d[field])) || null) : null;
  return docs;
}

// Полные coach-доки по списку id (напр. авторы курса). Батч.
async function findManyByIds(ids) {
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return [];
  if (usePg()) {
    const rows = await prisma().coach.findMany({ where: { id: { in: list } } });
    return rows.map(pgRowToDoc);
  }
  return CoachMongo.find({ _id: { $in: list } }).lean();
}

// Профиль тренера с подставленным user (getMyCoachProfile).
async function findByUserWithUser(userId) {
  const coach = await findByUser(userId);
  if (!coach) return null;
  await attachUsers([coach]);
  return coach;
}

// Upsert по user: $set полей + $setOnInsert { user, club? }. Возвращает coach-док.
async function upsertByUser(userId, { set = {}, club } = {}) {
  if (usePg()) {
    const data = pgSetData(set);
    const created = await prisma().coach.upsert({
      where: { userId: String(userId) },
      update: data,
      create: {
        id: newId(),
        userId: String(userId),
        ...(club !== undefined ? { clubId: club } : {}),
        ...data,
      },
    });
    return pgRowToDoc(created);
  }
  return CoachMongo.findOneAndUpdate(
    { user: userId },
    { $set: set, ...(club ? { $setOnInsert: { club } } : {}) },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
}

// Пометить верифицированным (БЕЗ upsert). -> coach-док | null, если профиля нет.
async function setVerifiedByUser(userId) {
  if (usePg()) {
    try {
      return pgRowToDoc(await prisma().coach.update({ where: { userId: String(userId) }, data: { isVerified: true } }));
    } catch (e) {
      if (e.code === 'P2025') return null;
      throw e;
    }
  }
  return CoachMongo.findOneAndUpdate({ user: userId }, { isVerified: true }, { new: true }).lean();
}

// Каталог тренеров: фильтр { isVerified?, clubId?, userIds? }, сортировка по
// platformRating.average desc, с подставленным user, БЕЗ payoutInfo. Пагинация.
async function findCatalog({ isVerified, clubId, userIds } = {}, { skip = 0, limit = 10 } = {}) {
  let coaches;
  if (usePg()) {
    const where = {
      ...(isVerified !== undefined ? { isVerified } : {}),
      ...(clubId ? { clubId: String(clubId) } : {}),
      ...(userIds ? { userId: { in: userIds.map(String) } } : {}),
    };
    const rows = await prisma().coach.findMany({
      where, orderBy: { platformRatingAverage: 'desc' }, skip, take: limit,
    });
    coaches = rows.map(pgRowToDoc);
  } else {
    const query = {
      ...(isVerified !== undefined ? { isVerified } : {}),
      ...(clubId ? { club: clubId } : {}),
      ...(userIds ? { user: { $in: userIds } } : {}),
    };
    coaches = await CoachMongo.find(query)
      .sort({ 'platformRating.average': -1 }).skip(skip).limit(limit).lean();
  }
  for (const c of coaches) delete c.payoutInfo; // как select('-payoutInfo')
  await attachUsers(coaches);
  return coaches;
}

async function countCatalog({ isVerified, clubId, userIds } = {}) {
  if (usePg()) {
    return prisma().coach.count({
      where: {
        ...(isVerified !== undefined ? { isVerified } : {}),
        ...(clubId ? { clubId: String(clubId) } : {}),
        ...(userIds ? { userId: { in: userIds.map(String) } } : {}),
      },
    });
  }
  return CoachMongo.countDocuments({
    ...(isVerified !== undefined ? { isVerified } : {}),
    ...(clubId ? { club: clubId } : {}),
    ...(userIds ? { user: { $in: userIds } } : {}),
  });
}

// Тренеры клуба с подставленным user (club.controller, публичная витрина).
async function findByClubWithUser(clubId, limit = 12) {
  let coaches;
  if (usePg()) {
    const rows = await prisma().coach.findMany({ where: { clubId: String(clubId) }, take: limit });
    coaches = rows.map(pgRowToDoc);
  } else {
    coaches = await CoachMongo.find({ club: clubId }).limit(limit).lean();
  }
  await attachUsers(coaches);
  return coaches;
}

module.exports = {
  findByUser, findById, existsById, findByIds, findByUserWithUser,
  upsertByUser, setVerifiedByUser,
  findCatalog, countCatalog, findByClubWithUser, attachUsers, attachCoachField, findManyByIds,
  usePg,
  _pgRowToDoc: pgRowToDoc,
};
