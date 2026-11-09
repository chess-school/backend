// Слой хранения курсов (v2 Course) — ШОВ миграции MongoDB → PostgreSQL (strangler, домен 5 Content).
// Флаг CONTENT_DB. Вложенные modules — Json; authors/allowedUsers/allowedGroups — массивы id (app-join);
// price.{amount,currency} — колонки. Фильтр доступа (Module 1) строится по СЕМАНТИЧЕСКОМУ дескриптору
// access={isAdmin,userId,coachId,groupIds} — одинаково для mongo и pg.

const mongoose = require('mongoose');
const CourseMongo = require('../models/Course');

const usePg = () => String(process.env.CONTENT_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); }
  return _prisma;
};
const newId = () => new mongoose.Types.ObjectId().toString();
const oid = (v) => new mongoose.Types.ObjectId(String(v));

const pgRowToDoc = (r) => r && ({
  _id: r.id,
  club: r.clubId ?? undefined,
  title: r.title,
  description: r.description,
  thumbnailUrl: r.thumbnailUrl ?? undefined,
  authors: r.authorIds || [],
  isSchoolCourse: r.isSchoolCourse,
  modules: r.modules ?? [],
  price: { amount: r.priceAmount, currency: r.priceCurrency },
  status: r.status,
  visibility: r.visibility,
  allowedUsers: r.allowedUserIds || [],
  allowedGroups: r.allowedGroupIds || [],
  isArchived: r.isArchived,
  level: r.level ?? undefined,
  tags: r.tags || [],
  language: r.language,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// Mongo-$or фильтр доступа по дескриптору (как было в buildVisibilityFilter).
const mongoAccess = (access) => {
  if (access.isAdmin) return {};
  const userId = access.userId ? oid(access.userId) : null;
  const notArchived = { isArchived: { $ne: true } };
  const or = [
    { visibility: 'public', ...notArchived },
    { visibility: { $exists: false }, status: 'published', ...notArchived }, // легаси без visibility
  ];
  if (access.coachId) or.push({ authors: oid(access.coachId) });
  if (userId) or.push({ allowedUsers: userId, visibility: { $ne: 'draft' }, ...notArchived });
  if (access.groupIds && access.groupIds.length) {
    or.push({ allowedGroups: { $in: access.groupIds.map(oid) }, visibility: { $ne: 'draft' }, ...notArchived });
  }
  return { $or: or };
};

// PG-where доступа. В pg нет записей без visibility (легаси-ветка не нужна).
const pgAccess = (access) => {
  if (access.isAdmin) return {};
  const OR = [{ visibility: 'public', isArchived: false }];
  if (access.coachId) OR.push({ authorIds: { has: String(access.coachId) } });
  if (access.userId) OR.push({ allowedUserIds: { has: String(access.userId) }, visibility: { not: 'draft' }, isArchived: false });
  if (access.groupIds && access.groupIds.length) {
    OR.push({ allowedGroupIds: { hasSome: access.groupIds.map(String) }, visibility: { not: 'draft' }, isArchived: false });
  }
  return { OR };
};

// Доп. фильтры каталога → mongo/pg.
const mongoExtra = ({ club, level, tag, language, courseId }) => {
  const q = {};
  if (club) q.club = oid(club);
  if (level) q.level = level;
  if (tag) q.tags = tag;
  if (language) q.language = language;
  if (courseId) q._id = courseId;
  return q;
};
const pgExtra = ({ club, level, tag, language, courseId }) => {
  const q = {};
  if (club) q.clubId = String(club);
  if (level) q.level = level;
  if (tag) q.tags = { has: tag };
  if (language) q.language = language;
  if (courseId) q.id = String(courseId);
  return q;
};

// --- Записи -----------------------------------------------------------------------------------

async function create(data) {
  if (usePg()) {
    const row = await prisma().course.create({ data: {
      id: newId(),
      clubId: data.club != null ? String(data.club) : null,
      title: data.title,
      description: data.description,
      thumbnailUrl: data.thumbnailUrl ?? null,
      authorIds: (data.authors || []).map(String),
      isSchoolCourse: !!data.isSchoolCourse,
      modules: data.modules ?? undefined,
      priceAmount: data.price?.amount ?? 0,
      priceCurrency: data.price?.currency ?? 'USD',
      status: data.status || 'draft',
      visibility: data.visibility || 'draft',
      allowedUserIds: (data.allowedUsers || []).map(String),
      allowedGroupIds: (data.allowedGroups || []).map(String),
      isArchived: !!data.isArchived,
      level: data.level ?? null,
      tags: data.tags || [],
      language: data.language || 'en',
    } });
    return pgRowToDoc(row);
  }
  const doc = await CourseMongo.create(data);
  return doc.toObject();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().course.findUnique({ where: { id: String(id) } })) || null;
  return CourseMongo.findById(id).lean();
}

// Маппинг set-полей обновления → pg-колонки.
const pgSetData = (set) => {
  const d = {};
  if (set.title !== undefined) d.title = set.title;
  if (set.description !== undefined) d.description = set.description;
  if (set.thumbnailUrl !== undefined) d.thumbnailUrl = set.thumbnailUrl;
  if (set.modules !== undefined) d.modules = set.modules;
  if (set.price !== undefined) { d.priceAmount = set.price.amount; d.priceCurrency = set.price.currency; }
  if (set.level !== undefined) d.level = set.level;
  if (set.tags !== undefined) d.tags = set.tags;
  if (set.language !== undefined) d.language = set.language;
  if (set.isSchoolCourse !== undefined) d.isSchoolCourse = set.isSchoolCourse;
  if (set.visibility !== undefined) d.visibility = set.visibility;
  if (set.allowedUsers !== undefined) d.allowedUserIds = (set.allowedUsers || []).map(String);
  if (set.allowedGroups !== undefined) d.allowedGroupIds = (set.allowedGroups || []).map(String);
  if (set.isArchived !== undefined) d.isArchived = set.isArchived;
  if (set.status !== undefined) d.status = set.status;
  return d;
};

async function updateById(id, set, { runValidators = true } = {}) {
  if (usePg()) {
    const row = await prisma().course.update({ where: { id: String(id) }, data: pgSetData(set) });
    return pgRowToDoc(row);
  }
  return CourseMongo.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators }).lean();
}

/** Сменить статус курса, только если coachId — его автор. Возвращает lean-док или null. */
async function updateStatusByAuthor(courseId, coachId, status) {
  if (usePg()) {
    const row = await prisma().course.findFirst({ where: { id: String(courseId), authorIds: { has: String(coachId) } } });
    if (!row) return null;
    return pgRowToDoc(await prisma().course.update({ where: { id: String(courseId) }, data: { status } }));
  }
  return CourseMongo.findOneAndUpdate({ _id: courseId, authors: coachId }, { status }, { new: true }).lean();
}

// --- Чтения -----------------------------------------------------------------------------------

/** Курсы автора (кабинет тренера), свежие сверху; опц. изоляция по клубу. */
async function findByAuthor(coachId, { club } = {}) {
  if (usePg()) {
    const where = { authorIds: { has: String(coachId) } };
    if (club) where.clubId = String(club);
    const rows = await prisma().course.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map(pgRowToDoc);
  }
  const filter = { authors: coachId };
  if (club) filter.club = club;
  return CourseMongo.find(filter).sort({ createdAt: -1 }).lean();
}

async function findCatalog(access, filters, { skip = 0, limit = 10 } = {}) {
  if (usePg()) {
    const where = { ...pgAccess(access), ...pgExtra(filters) };
    const rows = await prisma().course.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit });
    return rows.map(pgRowToDoc);
  }
  const query = { ...mongoAccess(access), ...mongoExtra(filters) };
  return CourseMongo.find(query).select('-__v').sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

async function countCatalog(access, filters) {
  if (usePg()) return prisma().course.count({ where: { ...pgAccess(access), ...pgExtra(filters) } });
  return CourseMongo.countDocuments({ ...mongoAccess(access), ...mongoExtra(filters) });
}

async function existsById(id) {
  if (usePg()) return !!(await prisma().course.findUnique({ where: { id: String(id) }, select: { id: true } }));
  return !!(await CourseMongo.exists({ _id: id }));
}

/** Один курс по id с учётом доступа (null, если нет доступа). */
async function findOneWithAccess(courseId, access) {
  if (usePg()) {
    const row = await prisma().course.findFirst({ where: { id: String(courseId), ...pgAccess(access) } });
    return pgRowToDoc(row) || null;
  }
  return CourseMongo.findOne({ _id: courseId, ...mongoAccess(access) }).select('-__v').lean();
}

/** Курсы по списку id (для app-join в контрактах / student.service). */
async function findByIds(ids) {
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return [];
  if (usePg()) return (await prisma().course.findMany({ where: { id: { in: list } } })).map(pgRowToDoc);
  return CourseMongo.find({ _id: { $in: list } }).lean();
}

/** Опубликованный курс по id (запись ученика). */
async function findPublishedById(id) {
  if (usePg()) {
    const row = await prisma().course.findFirst({ where: { id: String(id), status: 'published' } });
    return pgRowToDoc(row) || null;
  }
  return CourseMongo.findOne({ _id: id, status: 'published' }).lean();
}

/** Персональный курс тренера по автору+названию (resolveCourseForApproval). */
async function findByAuthorAndTitle(coachId, title) {
  if (usePg()) {
    const row = await prisma().course.findFirst({ where: { authorIds: { has: String(coachId) }, title } });
    return pgRowToDoc(row) || null;
  }
  return CourseMongo.findOne({ authors: coachId, title }).lean();
}

module.exports = {
  create, findById, updateById, updateStatusByAuthor,
  findByAuthor, findCatalog, countCatalog, existsById, findOneWithAccess,
  findByIds, findPublishedById, findByAuthorAndTitle,
  usePg, _pgRowToDoc: pgRowToDoc,
};
