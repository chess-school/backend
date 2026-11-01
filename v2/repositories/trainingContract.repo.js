// Слой хранения учебных контрактов (v2 TrainingContract, коллекция trainingcontracts) —
// ШОВ миграции MongoDB → PostgreSQL (strangler, домен 4 Coaching).
// Переключается флагом COACHING_DB: 'mongo' (по умолчанию) | 'pg' (тот же флаг, что Coach).
//
// Все кросс-модельные джойны (student→user, coach→user, course, group, payment) делаются
// на уровне ПРИЛОЖЕНИЯ через userRepo/paymentRepo/coachRepo/Mongo-модели Course,Group —
// это заменяет Mongo populate/$lookup и снимает кросс-БД ландмайны (в т.ч. блокировавшие
// флип Identity и Payment: аггрегация listStudents раньше делала $lookup и на users, и на payments).
//
// Форма Mongo-дока TrainingContract:
//   { _id, club, student, course, coach, group, priceAtPurchase:{amount,currency},
//     packageSnapshot, status, progress:{completedLessons,lessonsCompletedCount,percentage},
//     startDate, endDate, createdAt, updatedAt }
//
// См. docs/postgres-migration/MIGRATION-PLAN.md (домен 4, coaching).

const mongoose = require('mongoose');
const ContractMongo = require('../models/TrainingContract');
const courseRepo = require('../repositories/course.repo'); // шов content (mongo|pg по CONTENT_DB)
const Group = require('../models/Group');
const userRepo = require('./user.repo');
const paymentRepo = require('./payment.repo');
const coachRepo = require('./coach.repo');

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
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// PG-строка -> форма Mongo-дока.
const pgRowToDoc = (r) => r && {
  _id: r.id,
  club: r.clubId ?? undefined,
  student: r.studentId,
  course: r.courseId,
  coach: r.coachId,
  group: r.groupId ?? null,
  priceAtPurchase: { amount: r.priceAmount, currency: r.priceCurrency },
  packageSnapshot: r.packageSnapshot ?? undefined,
  status: r.status,
  progress: {
    completedLessons: r.progressCompletedLessons || [],
    lessonsCompletedCount: r.progressLessonsCompletedCount,
    percentage: r.progressPercentage,
  },
  startDate: r.startDate ?? undefined,
  endDate: r.endDate ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
};

// --- трансляция нейтрального фильтра -> PG where (student->studentId и т.д., status/$in) ---
const FIELD = { _id: 'id', id: 'id', student: 'studentId', course: 'courseId', coach: 'coachId', group: 'groupId', club: 'clubId' };
const pgWhere = (f = {}) => {
  const w = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'status') {
      w.status = v && v.$in ? { in: v.$in } : v;
    } else if (FIELD[k]) {
      if (v === null) w[FIELD[k]] = null;
      else if (v && v.$in) w[FIELD[k]] = { in: v.$in.map(String) };
      else w[FIELD[k]] = String(v);
    }
  }
  return w;
};

// --- $set -> PG data ---
const pgSet = (set = {}) => {
  const d = {};
  if (set.status !== undefined) d.status = set.status;
  if (set.group !== undefined) d.groupId = set.group === null ? null : String(set.group);
  if (set.club !== undefined) d.clubId = set.club === null ? null : String(set.club);
  if (set.startDate !== undefined) d.startDate = set.startDate ?? null;
  if (set.endDate !== undefined) d.endDate = set.endDate ?? null;
  if (set['progress.percentage'] !== undefined) d.progressPercentage = set['progress.percentage'];
  if (set['progress.lessonsCompletedCount'] !== undefined) d.progressLessonsCompletedCount = set['progress.lessonsCompletedCount'];
  return d;
};

// =====================================================================
//  Базовый CRUD
// =====================================================================

async function findOne(filter, { sort } = {}) {
  if (usePg()) {
    const row = await prisma().trainingContract.findFirst({
      where: pgWhere(filter), orderBy: sort ? pgSort(sort) : undefined,
    });
    return pgRowToDoc(row) || null;
  }
  let q = ContractMongo.findOne(filter);
  if (sort) q = q.sort(sort);
  return q.lean();
}

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().trainingContract.findUnique({ where: { id: String(id) } })) || null;
  return ContractMongo.findById(id).lean();
}

async function findMany(filter, { sort } = {}) {
  if (usePg()) {
    const rows = await prisma().trainingContract.findMany({ where: pgWhere(filter), orderBy: sort ? pgSort(sort) : undefined });
    return rows.map(pgRowToDoc);
  }
  let q = ContractMongo.find(filter);
  if (sort) q = q.sort(sort);
  return q.lean();
}

const pgSort = (sort) => Object.entries(sort).map(([k, v]) => ({ [k === '_id' ? 'id' : k]: v === -1 || v === 'desc' ? 'desc' : 'asc' }));

async function exists(filter) {
  if (usePg()) return !!(await prisma().trainingContract.findFirst({ where: pgWhere(filter), select: { id: true } }));
  return !!(await ContractMongo.exists(filter));
}

async function count(filter) {
  if (usePg()) return prisma().trainingContract.count({ where: pgWhere(filter) });
  return ContractMongo.countDocuments(filter);
}

// Уникальные значения поля (student|course|coach) по фильтру — как Mongo .distinct().
async function distinct(field, filter) {
  if (usePg()) {
    const col = FIELD[field] || field;
    const rows = await prisma().trainingContract.findMany({ where: pgWhere(filter), select: { [col]: true }, distinct: [col] });
    return rows.map((r) => r[col]).filter((v) => v != null);
  }
  return ContractMongo.find(filter).distinct(field);
}

async function create(data) {
  try {
    if (usePg()) {
      const row = await prisma().trainingContract.create({
        data: {
          id: newId(),
          clubId: data.club != null ? String(data.club) : null,
          studentId: String(data.student),
          courseId: String(data.course),
          coachId: String(data.coach),
          groupId: data.group != null ? String(data.group) : null,
          priceAmount: data.priceAtPurchase?.amount ?? 0,
          priceCurrency: data.priceAtPurchase?.currency ?? '',
          ...(data.packageSnapshot !== undefined ? { packageSnapshot: data.packageSnapshot } : {}),
          status: data.status || 'pending_payment',
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
        },
      });
      return pgRowToDoc(row);
    }
    const doc = await ContractMongo.create(data);
    return doc.toObject();
  } catch (e) {
    if (e.code === 11000 || e.code === 'P2002') {
      throw Object.assign(new Error('Duplicate enrollment (student+course).'), { code: 'DUPLICATE_ENROLLMENT' });
    }
    throw e;
  }
}

// updateOne($set). -> { modifiedCount }
async function updateOne(filter, set) {
  if (usePg()) {
    const res = await prisma().trainingContract.updateMany({ where: pgWhere(filter), data: pgSet(set) });
    return { modifiedCount: res.count };
  }
  const res = await ContractMongo.updateOne(filter, { $set: set });
  return { modifiedCount: res.modifiedCount };
}

async function updateMany(filter, set) {
  if (usePg()) {
    const res = await prisma().trainingContract.updateMany({ where: pgWhere(filter), data: pgSet(set) });
    return { modifiedCount: res.count };
  }
  const res = await ContractMongo.updateMany(filter, { $set: set });
  return { modifiedCount: res.modifiedCount };
}

// Условный апдейт (оптимистичная блокировка по статусу). -> обновлённый док | null.
async function findOneAndUpdate(filter, set) {
  if (usePg()) {
    const res = await prisma().trainingContract.updateMany({ where: pgWhere(filter), data: pgSet(set) });
    if (!res.count) return null;
    // filter всегда содержит _id — безопасно перечитать по нему
    const id = filter._id || filter.id;
    return pgRowToDoc(await prisma().trainingContract.findUnique({ where: { id: String(id) } }));
  }
  return ContractMongo.findOneAndUpdate(filter, { $set: set }, { new: true, runValidators: true }).lean();
}

async function deleteOne(filter) {
  if (usePg()) {
    const res = await prisma().trainingContract.deleteMany({ where: pgWhere(filter) });
    return { deletedCount: res.count };
  }
  const res = await ContractMongo.deleteOne(filter);
  return { deletedCount: res.deletedCount };
}

// =====================================================================
//  Прикладные джойны (замена populate / $lookup)
// =====================================================================

// Батч-подстановка course по набору контрактов. fields — массив имён полей Course.
async function attachCourses(contracts, fields) {
  const ids = [...new Set(contracts.map((c) => String(c.course)).filter(Boolean))];
  if (!ids.length) return;
  const docs = await courseRepo.findByIds(ids);
  const byId = new Map(docs.map((d) => [String(d._id), project(d, fields)]));
  for (const c of contracts) c.course = byId.get(String(c.course)) || { _id: c.course };
}

async function attachGroups(contracts, fields) {
  const ids = [...new Set(contracts.map((c) => (c.group ? String(c.group) : null)).filter(Boolean))];
  const byId = new Map();
  if (ids.length) {
    const docs = await Group.find({ _id: { $in: ids } }).select(fields.join(' ')).lean();
    for (const d of docs) byId.set(String(d._id), project(d, fields));
  }
  for (const c of contracts) c.group = c.group ? (byId.get(String(c.group)) || { _id: c.group }) : null;
}

// Подставить student = публичная карточка пользователя.
async function attachStudents(contracts, fields) {
  const ids = [...new Set(contracts.map((c) => String(c.student)).filter(Boolean))];
  if (!ids.length) return;
  const users = await userRepo.findByIdList(ids);
  const byId = new Map(users.map((u) => [String(u._id), project(u, fields)]));
  for (const c of contracts) c.student = byId.get(String(c.student)) || { _id: c.student };
}

// Подставить coach = { _id, user:{...} } (coach.select('user').populate('user')).
async function attachCoachWithUser(contracts, userFields) {
  const coachIds = [...new Set(contracts.map((c) => String(c.coach)).filter(Boolean))];
  if (!coachIds.length) return;
  const coaches = await coachRepo.findByIds(coachIds); // [{_id, user}]
  const userIds = [...new Set(coaches.map((c) => String(c.user)).filter(Boolean))];
  const users = await userRepo.findByIdList(userIds);
  const userById = new Map(users.map((u) => [String(u._id), project(u, userFields)]));
  const coachById = new Map(coaches.map((c) => [String(c._id), { _id: c._id, user: userById.get(String(c.user)) || null }]));
  for (const c of contracts) c.coach = coachById.get(String(c.coach)) || { _id: c.coach, user: null };
}

const project = (obj, fields) => {
  const out = { _id: obj._id };
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
};

// enrollment.getMyContracts: контракты студента + course + coach.user
async function findForStudentWithRefs(studentId, clubId) {
  const contracts = await findMany(
    { student: studentId, ...(clubId ? { club: clubId } : {}) }, { sort: { createdAt: -1 } },
  );
  await attachCourses(contracts, ['title', 'description', 'thumbnailUrl', 'language']);
  await attachCoachWithUser(contracts, ['firstName', 'lastName', 'uuid']);
  return contracts;
}

// enrollment.getMyStudents: контракты тренера + student + course(title)
async function findForCoachWithRefs(coachId, clubId) {
  const contracts = await findMany(
    { coach: coachId, ...(clubId ? { club: clubId } : {}) }, { sort: { createdAt: -1 } },
  );
  await attachStudents(contracts, ['uuid', 'firstName', 'lastName', 'email', 'avatarUrl']);
  await attachCourses(contracts, ['title']);
  return contracts;
}

// student.getStudent: контракты студента (+coachFilter) + course(title,level,language) + group(name)
async function findStudentEnrollments(studentId, coachId) {
  const contracts = await findMany(
    { student: studentId, ...(coachId ? { coach: coachId } : {}) }, { sort: { createdAt: -1 } },
  );
  await attachCourses(contracts, ['title', 'level', 'language']);
  await attachGroups(contracts, ['name']);
  return contracts;
}

// payment: один контракт по фильтру + course (populate('course') целиком).
async function findOneWithCourse(filter) {
  const contract = await findOne(filter);
  if (!contract) return null;
  const course = await courseRepo.findById(contract.course);
  contract.course = course || null;
  return contract;
}

// =====================================================================
//  Аггрегация listStudents — прикладная замена $lookup(payments)+$lookup(users)
//  match: { coach?, status?, course?, group? } (строковые id). -> { items, total }
//  items: [{ _id:studentId, user:{uuid,firstName,lastName,email,phone,avatarUrl,_id},
//            enrollments:[{_id,status,course(id),group(id),coach(id),progress:{percentage},
//            startDate,endDate,payment:{paid,amountPaid},createdAt}], lastEnrolledAt }]
// =====================================================================
async function listStudentsForScope(match, { skip = 0, limit = 10, search } = {}) {
  const contracts = await findMany(match, { sort: { createdAt: -1 } });
  if (!contracts.length) return { items: [], total: 0 };

  // Оплаты (succeeded) по контрактам — замена $lookup from payments
  const payByContract = new Map();
  const payments = await paymentRepo.findByContracts(contracts.map((c) => c._id));
  for (const p of payments) {
    if (p.status !== 'succeeded') continue;
    const k = String(p.contract);
    const cur = payByContract.get(k) || { paid: false, amountPaid: 0 };
    cur.paid = true;
    cur.amountPaid += p.amount || 0;
    payByContract.set(k, cur);
  }

  // Группировка по студенту
  const byStudent = new Map();
  for (const c of contracts) {
    const sid = String(c.student);
    if (!byStudent.has(sid)) byStudent.set(sid, { _id: sid, enrollments: [], lastEnrolledAt: null });
    const g = byStudent.get(sid);
    const pay = payByContract.get(String(c._id)) || { paid: false, amountPaid: 0 };
    g.enrollments.push({
      _id: c._id, status: c.status, course: c.course, group: c.group ?? null, coach: c.coach,
      progress: { percentage: c.progress?.percentage ?? 0 },
      startDate: c.startDate, endDate: c.endDate,
      payment: { paid: pay.paid, amountPaid: pay.amountPaid },
      createdAt: c.createdAt,
    });
    if (!g.lastEnrolledAt || c.createdAt > g.lastEnrolledAt) g.lastEnrolledAt = c.createdAt;
  }

  // Пользователи — замена $lookup from users + $unwind (без пользователя контракт отбрасываем)
  const users = await userRepo.findByIdList([...byStudent.keys()]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  let rows = [];
  for (const [sid, g] of byStudent) {
    const u = userById.get(sid);
    if (!u) continue;
    rows.push({
      _id: sid,
      user: { _id: u._id, uuid: u.uuid, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone, avatarUrl: u.avatarUrl },
      enrollments: g.enrollments,
      lastEnrolledAt: g.lastEnrolledAt,
    });
  }

  // Поиск по имени/фамилии/email
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    rows = rows.filter((r) => re.test(r.user.firstName || '') || re.test(r.user.lastName || '') || re.test(r.user.email || ''));
  }

  // Сортировка по фамилии, имени, _id
  rows.sort((a, b) =>
    (a.user.lastName || '').localeCompare(b.user.lastName || '')
    || (a.user.firstName || '').localeCompare(b.user.firstName || '')
    || String(a._id).localeCompare(String(b._id)));

  const total = rows.length;
  const items = rows.slice(skip, skip + limit);
  return { items, total };
}

module.exports = {
  findOne, findById, findMany, exists, count, distinct,
  create, updateOne, updateMany, findOneAndUpdate, deleteOne,
  findForStudentWithRefs, findForCoachWithRefs, findStudentEnrollments, findOneWithCourse,
  listStudentsForScope,
  usePg,
  _pgRowToDoc: pgRowToDoc,
};
