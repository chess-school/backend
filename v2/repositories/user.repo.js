// Слой хранения пользователей (v2 'TestUser' / коллекция testusers) —
// ШОВ миграции MongoDB → PostgreSQL (strangler, домен 3 Identity).
// Переключается флагом окружения USER_DB: 'mongo' (по умолчанию) | 'pg'.
//
// Репозиторий ВСЕГДА отдаёт данные в форме Mongo-документа TestUser
// ({ _id, uuid, firstName, lastName, email, phone, avatarUrl, emailVerified, roles,
//    ratings:{ bullet:{rating,rd,vol,games}, blitz, rapid, classical },
//    puzzleRating, puzzleRatingGames, createdAt, updatedAt, ... }),
// чтобы контракт контроллеров/фронта не менялся при переключении бэкенда.
//
// Секреты (password/verificationToken/sessionTokenVersion) НЕ попадают в «публичный»
// документ — они доступны только через явные auth-методы (*ForAuth, *VerificationToken).
// Хеширование пароля (bcrypt) и сравнение инкапсулированы здесь (раньше это были
// Mongoose pre-save хук и метод comparePassword).
//
// См. docs/postgres-migration/MIGRATION-PLAN.md (домен 3, identity).

const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const UserMongo = require('../models/User');

const usePg = () => String(process.env.USER_DB || 'mongo').toLowerCase() === 'pg';

// Ленивая инициализация Prisma — при USER_DB=mongo клиент не трогается вовсе.
let _prisma = null;
const prisma = () => {
  if (!_prisma) {
    const { PrismaClient } = require('@prisma/client');
    _prisma = new PrismaClient();
  }
  return _prisma;
};

const newId = () => new mongoose.Types.ObjectId().toString();
const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical'];
const SECRET_FIELDS = ['password', 'verificationToken', 'sessionTokenVersion'];

// --- мапперы PG-строка -> форма Mongo-дока ---

// Вложенный объект рейтингов из 16 уплощённых колонок.
const pgRatings = (r) => SPEEDS.reduce((acc, s) => {
  const cap = s[0].toUpperCase() + s.slice(1);
  acc[s] = {
    rating: r[`${s}Rating`],
    rd: r[`${s}Rd`],
    vol: r[`${s}Vol`],
    games: r[`${s}Games`],
  };
  return acc;
}, {});

// Публичный документ (без секретов) — то, что раньше отдавали .select('-password ...').
const pgRowToDoc = (r) => r && {
  _id: r.id,
  uuid: r.uuid,
  firebaseUID: r.firebaseUID ?? undefined,
  firstName: r.firstName,
  lastName: r.lastName,
  avatarUrl: r.avatarUrl ?? undefined,
  email: r.email,
  phone: r.phone ?? undefined,
  emailVerified: r.emailVerified,
  roles: r.roles,
  ratings: pgRatings(r),
  puzzleRating: r.puzzleRating,
  puzzleRatingGames: r.puzzleRatingGames,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
};

// Auth-документ — публичный + секреты (для логина/верификации/сессии).
const pgRowToAuth = (r) => r && {
  ...pgRowToDoc(r),
  password: r.password,
  verificationToken: r.verificationToken ?? undefined,
  sessionTokenVersion: r.sessionTokenVersion,
};

// Mongo lean-док: убрать секреты для публичных чтений.
const stripSecret = (doc) => {
  if (!doc) return doc;
  for (const f of SECRET_FIELDS) delete doc[f];
  return doc;
};

// speed -> объект данных для Prisma-апдейта рейтинга (set 3 поля + inc games).
const pgRatingUpdate = (speed, { rating, rd, vol }) => ({
  [`${speed}Rating`]: rating,
  [`${speed}Rd`]: rd,
  [`${speed}Vol`]: vol,
  [`${speed}Games`]: { increment: 1 },
});

// =====================================================================
//  Чтения (публичный документ, без секретов)
// =====================================================================

async function findById(id, { select } = {}) {
  if (usePg()) {
    const r = await prisma().user.findUnique({ where: { id: String(id) } });
    return pgRowToDoc(r) || null;
  }
  const q = UserMongo.findById(id);
  if (select) q.select(select);
  return stripSecret(await q.lean());
}

async function findByUuid(uuid, { select } = {}) {
  if (usePg()) {
    const r = await prisma().user.findUnique({ where: { uuid: String(uuid) } });
    return pgRowToDoc(r) || null;
  }
  const q = UserMongo.findOne({ uuid });
  if (select) q.select(select);
  return stripSecret(await q.lean());
}

async function findByEmail(email) {
  const norm = String(email).toLowerCase();
  if (usePg()) {
    const r = await prisma().user.findUnique({ where: { email: norm } });
    return pgRowToDoc(r) || null;
  }
  return stripSecret(await UserMongo.findOne({ email: norm }).lean());
}

// Список по массиву _id, отсортирован по фамилии/имени (как в чате/расписании).
async function findByIdList(ids) {
  const list = (ids || []).map(String);
  if (usePg()) {
    const rows = await prisma().user.findMany({
      where: { id: { in: list } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map(pgRowToDoc);
  }
  return (await UserMongo.find({ _id: { $in: list } })
    .sort({ lastName: 1, firstName: 1 }).lean()).map(stripSecret);
}

async function findByEmailList(emails) {
  const list = (emails || []).map((e) => String(e).toLowerCase());
  if (usePg()) {
    const rows = await prisma().user.findMany({ where: { email: { in: list } } });
    return rows.map(pgRowToDoc);
  }
  return (await UserMongo.find({ email: { $in: list } }).lean()).map(stripSecret);
}

// Поиск по словам имени (каталог тренеров): каждое слово — в firstName ИЛИ lastName.
async function findByNameWords(words, { limit = 200 } = {}) {
  const terms = (words || []).map((w) => String(w)).filter(Boolean);
  if (!terms.length) return [];
  if (usePg()) {
    const rows = await prisma().user.findMany({
      where: {
        AND: terms.map((w) => ({
          OR: [
            { firstName: { contains: w, mode: 'insensitive' } },
            { lastName: { contains: w, mode: 'insensitive' } },
          ],
        })),
      },
      take: limit,
    });
    return rows.map(pgRowToDoc);
  }
  const esc = (w) => w.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const and = terms.map((w) => {
    const rx = new RegExp(esc(w), 'i');
    return { $or: [{ firstName: rx }, { lastName: rx }] };
  });
  return (await UserMongo.find({ $and: and }).limit(limit).lean()).map(stripSecret);
}

async function findAdmins() {
  if (usePg()) {
    const rows = await prisma().user.findMany({ where: { roles: { has: 'ADMIN' } } });
    return rows.map(pgRowToDoc);
  }
  return (await UserMongo.find({ roles: 'ADMIN' }).lean()).map(stripSecret);
}

// Построить where/filter из {uuid, email(подстрока, i), role} — общая часть find+count.
const pgListWhere = ({ uuid, email, role }) => ({
  ...(uuid ? { uuid } : {}),
  ...(email ? { email: { contains: String(email).slice(0, 100), mode: 'insensitive' } } : {}),
  ...(role ? { roles: { has: role } } : {}),
});
const mongoListFilter = ({ uuid, email, role }) => {
  const f = {};
  if (uuid) f.uuid = uuid;
  if (email) {
    const safe = String(email).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    f.email = { $regex: safe, $options: 'i' };
  }
  if (role) f.roles = role;
  return f;
};

// Админский список с пагинацией (новые сверху).
async function findMany(filter = {}, { skip = 0, limit = 20 } = {}) {
  if (usePg()) {
    const rows = await prisma().user.findMany({
      where: pgListWhere(filter),
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });
    return rows.map(pgRowToDoc);
  }
  return (await UserMongo.find(mongoListFilter(filter))
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean()).map(stripSecret);
}

async function count(filter = {}) {
  if (usePg()) return prisma().user.count({ where: pgListWhere(filter) });
  return UserMongo.countDocuments(mongoListFilter(filter));
}

async function existsById(id) {
  if (usePg()) {
    return !!(await prisma().user.findUnique({ where: { id: String(id) }, select: { id: true } }));
  }
  return !!(await UserMongo.exists({ _id: id }));
}

// =====================================================================
//  Аутентификация и сессия
// =====================================================================

async function findByEmailForAuth(email) {
  const norm = String(email).toLowerCase();
  if (usePg()) {
    const r = await prisma().user.findUnique({ where: { email: norm } });
    return pgRowToAuth(r) || null;
  }
  return UserMongo.findOne({ email: norm }).lean();
}

async function findByIdForAuth(id) {
  if (usePg()) {
    const r = await prisma().user.findUnique({ where: { id: String(id) } });
    return pgRowToAuth(r) || null;
  }
  return UserMongo.findById(id).lean();
}

async function findByVerificationToken(token) {
  if (usePg()) {
    const r = await prisma().user.findFirst({ where: { verificationToken: String(token) } });
    return pgRowToAuth(r) || null;
  }
  return UserMongo.findOne({ verificationToken: token }).lean();
}

// Сравнение пароля (bcrypt) — работает с auth-документом обоих бэкендов.
async function comparePassword(authDoc, plain) {
  if (!authDoc || !authDoc.password) return false;
  return bcrypt.compare(plain, authDoc.password);
}

// Создание пользователя. Пароль хешируется (pg — здесь; mongo — pre-save хук модели).
async function create(data) {
  const email = String(data.email).toLowerCase();
  if (usePg()) {
    const row = await prisma().user.create({
      data: {
        id: newId(),
        firstName: data.firstName,
        lastName: data.lastName,
        email,
        password: await bcrypt.hash(data.password, 10),
        roles: data.roles || ['USER'],
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.firebaseUID !== undefined ? { firebaseUID: data.firebaseUID } : {}),
        ...(data.verificationToken !== undefined ? { verificationToken: data.verificationToken } : {}),
        ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}),
      },
    });
    return pgRowToDoc(row);
  }
  const doc = await UserMongo.create({ ...data, email }); // pre-save хеширует пароль
  return stripSecret(doc.toObject());
}

// Инкремент версии сессии (ревокация старых токенов). -> новое значение.
async function incrementSessionTokenVersion(id) {
  if (usePg()) {
    const r = await prisma().user.update({
      where: { id: String(id) },
      data: { sessionTokenVersion: { increment: 1 } },
    });
    return r.sessionTokenVersion;
  }
  const doc = await UserMongo.findByIdAndUpdate(
    id, { $inc: { sessionTokenVersion: 1 } }, { new: true },
  );
  return doc ? doc.sessionTokenVersion : null;
}

async function markEmailVerified(id) {
  if (usePg()) {
    await prisma().user.update({
      where: { id: String(id) },
      data: { emailVerified: true, verificationToken: null },
    });
    return;
  }
  await UserMongo.updateOne({ _id: id }, { emailVerified: true, $unset: { verificationToken: 1 } });
}

async function setVerificationToken(id, token) {
  if (usePg()) {
    await prisma().user.update({ where: { id: String(id) }, data: { verificationToken: String(token) } });
    return;
  }
  await UserMongo.updateOne({ _id: id }, { verificationToken: token });
}

async function updatePassword(id, plain) {
  if (usePg()) {
    await prisma().user.update({
      where: { id: String(id) },
      data: { password: await bcrypt.hash(plain, 10) },
    });
    return;
  }
  // mongo: загрузить + save, чтобы сработал pre-save хук хеширования
  const doc = await UserMongo.findById(id);
  if (!doc) return;
  doc.password = plain;
  await doc.save();
}

// =====================================================================
//  Профиль и роли
// =====================================================================

// Частичное обновление профиля по _id. undefined-поля пропускаются,
// null в phone -> очистка. -> публичный документ.
async function updateProfile(id, { firstName, lastName, phone } = {}) {
  if (usePg()) {
    const data = {};
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;
    if (phone !== undefined) data.phone = phone; // null очищает
    try {
      const row = await prisma().user.update({ where: { id: String(id) }, data });
      return pgRowToDoc(row);
    } catch (e) {
      if (e.code === 'P2025') return null; // запись не найдена
      throw e;
    }
  }
  const set = {};
  const unset = {};
  if (firstName !== undefined) set.firstName = firstName;
  if (lastName !== undefined) set.lastName = lastName;
  if (phone !== undefined) { if (phone === null) unset.phone = 1; else set.phone = phone; }
  const doc = await UserMongo.findByIdAndUpdate(
    id,
    { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true, runValidators: true },
  ).lean();
  return stripSecret(doc);
}

// То же по uuid (student.service). -> публичный документ.
async function updateProfileByUuid(uuid, { firstName, lastName, phone } = {}) {
  if (usePg()) {
    const data = {};
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;
    if (phone !== undefined) data.phone = phone;
    try {
      const row = await prisma().user.update({ where: { uuid: String(uuid) }, data });
      return pgRowToDoc(row);
    } catch (e) {
      if (e.code === 'P2025') return null; // запись не найдена
      throw e;
    }
  }
  const set = {};
  const unset = {};
  if (firstName !== undefined) set.firstName = firstName;
  if (lastName !== undefined) set.lastName = lastName;
  if (phone !== undefined) { if (phone === null) unset.phone = 1; else set.phone = phone; }
  const doc = await UserMongo.findOneAndUpdate(
    { uuid },
    { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true, runValidators: true },
  ).lean();
  return stripSecret(doc);
}

async function updateRoles(id, roles) {
  const unique = [...new Set(roles)];
  if (usePg()) {
    await prisma().user.update({ where: { id: String(id) }, data: { roles: unique } });
    return unique;
  }
  await UserMongo.updateOne({ _id: id }, { roles: unique });
  return unique;
}

async function addRole(id, role) {
  if (usePg()) {
    const r = await prisma().user.findUnique({ where: { id: String(id) }, select: { roles: true } });
    if (!r) return null;
    const next = [...new Set([...r.roles, role])];
    await prisma().user.update({ where: { id: String(id) }, data: { roles: next } });
    return next;
  }
  await UserMongo.updateOne({ _id: id }, { $addToSet: { roles: role } });
  return undefined;
}

// =====================================================================
//  Рейтинги онлайн-партий (Glicko-2)
// =====================================================================

// -> { _id, ratings:{ bullet:{rating,rd,vol,games}, ... } } | null
async function findRatings(id) {
  if (usePg()) {
    const r = await prisma().user.findUnique({ where: { id: String(id) } });
    if (!r) return null;
    return { _id: r.id, ratings: pgRatings(r) };
  }
  return UserMongo.findById(id).select('ratings').lean();
}

// Атомарно: set rating/rd/vol + inc games на ratings.{speed}.
async function updateRatings(id, speed, { rating, rd, vol }) {
  if (usePg()) {
    await prisma().user.update({ where: { id: String(id) }, data: pgRatingUpdate(speed, { rating, rd, vol }) });
    return;
  }
  await UserMongo.updateOne({ _id: id }, {
    $set: { [`ratings.${speed}.rating`]: rating, [`ratings.${speed}.rd`]: rd, [`ratings.${speed}.vol`]: vol },
    $inc: { [`ratings.${speed}.games`]: 1 },
  });
}

// =====================================================================
//  Рейтинг решения задач (Elo, Module 4)
// =====================================================================

async function findPuzzleRating(id) {
  if (usePg()) {
    const r = await prisma().user.findUnique({
      where: { id: String(id) },
      select: { puzzleRating: true, puzzleRatingGames: true },
    });
    return r || null;
  }
  return UserMongo.findById(id).select('puzzleRating puzzleRatingGames').lean();
}

// Атомарно: set puzzleRating + inc puzzleRatingGames.
async function updatePuzzleRating(id, newRating) {
  if (usePg()) {
    await prisma().user.update({
      where: { id: String(id) },
      data: { puzzleRating: newRating, puzzleRatingGames: { increment: 1 } },
    });
    return;
  }
  await UserMongo.updateOne(
    { _id: id }, { $set: { puzzleRating: newRating }, $inc: { puzzleRatingGames: 1 } },
  );
}

module.exports = {
  // чтения
  findById, findByUuid, findByEmail, findByIdList, findByEmailList,
  findByNameWords, findAdmins, findMany, count, existsById,
  // auth/сессия
  findByEmailForAuth, findByIdForAuth, findByVerificationToken, comparePassword,
  create, incrementSessionTokenVersion, markEmailVerified, setVerificationToken, updatePassword,
  // профиль/роли
  updateProfile, updateProfileByUuid, updateRoles, addRole,
  // рейтинги
  findRatings, updateRatings, findPuzzleRating, updatePuzzleRating,
  // прочее
  usePg,
  _pgRowToDoc: pgRowToDoc, // для тестов/ETL
};
