// v2/services/student.service.js
//
// Модуль студентов поверх учебного модуля v2. Отдельной сущности «студент» нет:
// студент — это пользователь (TestUser), записанный на курс через TrainingContract.
// Связи: TrainingContract -> Course / Coach / Group, Payment -> TrainingContract,
// Group.members -> TestUser, Submission -> Assignment (успеваемость), Schedule (занятия).
//
// Права (scope):
//   ADMIN — все студенты и все записи;
//   COACH — только студенты по своим контрактам (TrainingContract.coach = его профиль Coach);
//   студент — только своя карточка (GET /students/me).

const mongoose = require('mongoose');
const User = require('../models/User');
const Coach = require('../models/Coach');
const Course = require('../models/Course');
const Group = require('../models/Group');
const TrainingContract = require('../models/TrainingContract');
const Payment = require('../models/Payment');
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const Schedule = require('../models/Schedule');
const { badRequest, forbidden, notFound, conflict, unprocessable } = require('../utils/apiError');

const { ObjectId } = mongoose.Types;

// Публичные поля пользователя в ответах модуля (без пароля, токенов и т.п.)
const STUDENT_FIELDS = 'uuid firstName lastName email phone avatarUrl createdAt';

const ENROLLMENT_STATUSES = ['pending_payment', 'pending_approval', 'active', 'completed', 'cancelled', 'refunded'];
const INITIAL_STATUSES = ['pending_payment', 'pending_approval', 'active'];

// Допустимые переходы статуса записи. refunded выставляет только ADMIN (это деньги).
const STATUS_TRANSITIONS = {
    pending_payment: ['pending_approval', 'active', 'cancelled'],
    pending_approval: ['active', 'cancelled'],
    active: ['completed', 'cancelled', 'refunded'],
    completed: ['active', 'refunded'],
    cancelled: ['active', 'refunded'],
    refunded: [],
};

// =================================================================
//                         ПРАВА ДОСТУПА
// =================================================================

/** Кто делает запрос: { userId, isAdmin, isCoach, coachId } */
const resolveScope = async (user) => {
    const isAdmin = user.roles.includes('ADMIN');
    const isCoach = user.roles.includes('COACH');
    let coachId = null;
    if (isCoach) {
        const coach = await Coach.findOne({ user: user.id }).select('_id').lean();
        coachId = coach ? coach._id : null;
    }
    return { userId: user.id, isAdmin, isCoach, coachId };
};

/** Тренеру без профиля Coach работать со студентами нельзя — профиль задаёт связь с курсами */
const requireCoachProfile = (scope) => {
    if (!scope.isAdmin && !scope.coachId) {
        throw forbidden('Create your coach profile (PUT /api/v2/coaches/me) before managing students.', 'COACH_PROFILE_REQUIRED');
    }
};

const findStudentByUuid = async (uuid) => {
    const user = await User.findOne({ uuid }).select(STUDENT_FIELDS).lean();
    if (!user) throw notFound('Student not found.', 'STUDENT_NOT_FOUND');
    return user;
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// =================================================================
//                         ПРЕДСТАВЛЕНИЕ
// =================================================================

const toEnrollmentDto = (contract, payments = []) => ({
    _id: contract._id,
    status: contract.status,
    course: contract.course && contract.course._id ? { _id: contract.course._id, title: contract.course.title } : contract.course,
    group: contract.group && contract.group._id ? { _id: contract.group._id, name: contract.group.name } : contract.group || null,
    coach: contract.coach,
    priceAtPurchase: contract.priceAtPurchase,
    progress: {
        percentage: contract.progress?.percentage ?? 0,
        lessonsCompletedCount: contract.progress?.lessonsCompletedCount ?? 0,
    },
    startDate: contract.startDate || null,
    endDate: contract.endDate || null,
    payment: {
        paid: payments.some((p) => p.status === 'succeeded'),
        amountPaid: payments.filter((p) => p.status === 'succeeded').reduce((sum, p) => sum + p.amount, 0),
    },
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
});

// =================================================================
//                         СПИСОК СТУДЕНТОВ
// =================================================================

/**
 * Список студентов с их записями на курсы. Один aggregation-запрос + 2 запроса за названиями
 * курсов и групп на всю страницу — без N+1.
 * filters: { status, courseId, groupId, coachId (только ADMIN), search, page, limit }
 */
const listStudents = async (scope, filters) => {
    if (!scope.isAdmin && !scope.coachId) {
        return { data: [], pagination: { page: filters.page, limit: filters.limit, total: 0, totalPages: 0 } };
    }

    const match = {};
    if (!scope.isAdmin) match.coach = scope.coachId;
    else if (filters.coachId) match.coach = new ObjectId(filters.coachId);
    if (filters.status) match.status = filters.status;
    if (filters.courseId) match.course = new ObjectId(filters.courseId);
    if (filters.groupId) match.group = new ObjectId(filters.groupId);

    const userMatch = {};
    if (filters.search) {
        const re = new RegExp(escapeRegex(filters.search), 'i');
        userMatch.$or = [{ 'user.firstName': re }, { 'user.lastName': re }, { 'user.email': re }];
    }

    const skip = (filters.page - 1) * filters.limit;
    const [result] = await TrainingContract.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
            // Оплаты по контракту (индекс Payment.contract)
            $lookup: {
                from: Payment.collection.name,
                localField: '_id',
                foreignField: 'contract',
                pipeline: [{ $match: { status: 'succeeded' } }, { $project: { amount: 1 } }],
                as: 'payments',
            },
        },
        {
            $group: {
                _id: '$student',
                enrollments: {
                    $push: {
                        _id: '$_id',
                        status: '$status',
                        course: '$course',
                        group: '$group',
                        coach: '$coach',
                        progress: { percentage: { $ifNull: ['$progress.percentage', 0] } },
                        startDate: '$startDate',
                        endDate: '$endDate',
                        payment: { paid: { $gt: [{ $size: '$payments' }, 0] }, amountPaid: { $sum: '$payments.amount' } },
                        createdAt: '$createdAt',
                    },
                },
                lastEnrolledAt: { $max: '$createdAt' },
            },
        },
        {
            $lookup: {
                from: User.collection.name,
                localField: '_id',
                foreignField: '_id',
                pipeline: [{ $project: { uuid: 1, firstName: 1, lastName: 1, email: 1, phone: 1, avatarUrl: 1 } }],
                as: 'user',
            },
        },
        // Контракт без пользователя (пользователь удалён) не показываем — это битая ссылка
        { $unwind: '$user' },
        ...(filters.search ? [{ $match: userMatch }] : []),
        { $sort: { 'user.lastName': 1, 'user.firstName': 1, _id: 1 } },
        {
            $facet: {
                items: [{ $skip: skip }, { $limit: filters.limit }],
                total: [{ $count: 'count' }],
            },
        },
    ]);

    const items = result.items;
    const total = result.total[0]?.count ?? 0;

    // Названия курсов и групп для всей страницы — двумя запросами
    const courseIds = new Set();
    const groupIds = new Set();
    items.forEach((item) => item.enrollments.forEach((e) => {
        courseIds.add(String(e.course));
        if (e.group) groupIds.add(String(e.group));
    }));
    const [courses, groups] = await Promise.all([
        Course.find({ _id: { $in: [...courseIds] } }).select('title').lean(),
        Group.find({ _id: { $in: [...groupIds] } }).select('name').lean(),
    ]);
    const courseById = new Map(courses.map((c) => [String(c._id), { _id: c._id, title: c.title }]));
    const groupById = new Map(groups.map((g) => [String(g._id), { _id: g._id, name: g.name }]));

    return {
        data: items.map((item) => ({
            ...item.user,
            enrollments: item.enrollments.map((e) => ({
                ...e,
                course: courseById.get(String(e.course)) || { _id: e.course, title: null },
                group: e.group ? groupById.get(String(e.group)) || { _id: e.group, name: null } : null,
            })),
            lastEnrolledAt: item.lastEnrolledAt,
        })),
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
};

// =================================================================
//                         КАРТОЧКА СТУДЕНТА
// =================================================================

/**
 * Профиль, записи (с оплатой), группы, ближайшие занятия и успеваемость по ДЗ.
 * Тренер видит только то, что относится к нему; чужого студента — как будто его нет (404).
 */
const getStudent = async (scope, uuid) => {
    const student = await findStudentByUuid(uuid);
    const isSelf = String(student._id) === String(scope.userId);
    if (!scope.isAdmin && !isSelf && !scope.coachId) {
        throw forbidden('Only coaches and administrators can view other students.');
    }
    // Себя студент видит целиком; тренер — только свою часть
    const coachFilter = !scope.isAdmin && !isSelf ? { coach: scope.coachId } : {};

    const contracts = await TrainingContract.find({ student: student._id, ...coachFilter })
        .populate('course', 'title level language')
        .populate('group', 'name')
        .sort({ createdAt: -1 })
        .lean();
    if (!scope.isAdmin && !isSelf && contracts.length === 0) {
        throw notFound('Student not found.', 'STUDENT_NOT_FOUND');
    }

    const contractIds = contracts.map((c) => c._id);
    const groupsFilter = { members: student._id, ...(coachFilter.coach ? { coach: coachFilter.coach } : {}) };
    const assignmentFilter = coachFilter.coach ? { author: coachFilter.coach } : null;

    const [payments, groups, assignmentIds] = await Promise.all([
        Payment.find({ contract: { $in: contractIds } }).select('contract amount currency status createdAt').lean(),
        Group.find(groupsFilter).select('name status coach').lean(),
        assignmentFilter ? Assignment.find(assignmentFilter).distinct('_id') : Promise.resolve(null),
    ]);
    const groupIds = groups.map((g) => g._id);

    const submissionMatch = { student: student._id, ...(assignmentIds ? { assignment: { $in: assignmentIds } } : {}) };
    const [submissionStats, upcoming] = await Promise.all([
        Submission.aggregate([{ $match: submissionMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        Schedule.find({
            ...coachFilter,
            status: 'scheduled',
            date: { $gte: new Date() },
            $or: [
                { 'context.type': 'individual', 'context.refId': student._id },
                { 'context.type': 'group', 'context.refId': { $in: groupIds } },
            ],
        }).select('title date durationMinutes link context').sort({ date: 1 }).limit(5).lean(),
    ]);

    const paymentsByContract = new Map();
    payments.forEach((p) => {
        const key = String(p.contract);
        if (!paymentsByContract.has(key)) paymentsByContract.set(key, []);
        paymentsByContract.get(key).push(p);
    });
    const submissions = Object.fromEntries(['submitted', 'needs_revision', 'approved'].map((s) => [s, 0]));
    submissionStats.forEach((s) => { submissions[s._id] = s.count; });
    const totalSubmissions = Object.values(submissions).reduce((a, b) => a + b, 0);

    const activeContracts = contracts.filter((c) => c.status === 'active');
    return {
        ...student,
        enrollments: contracts.map((c) => toEnrollmentDto(c, paymentsByContract.get(String(c._id)))),
        groups: groups.map((g) => ({ _id: g._id, name: g.name, status: g.status })),
        upcomingLessons: upcoming,
        performance: {
            averageCourseProgress: activeContracts.length
                ? Math.round(activeContracts.reduce((s, c) => s + (c.progress?.percentage || 0), 0) / activeContracts.length)
                : 0,
            submissions: { ...submissions, total: totalSubmissions },
            approvalRate: totalSubmissions ? Math.round((submissions.approved / totalSubmissions) * 100) : null,
        },
    };
};

// =================================================================
//                     ЗАПИСЬ СТУДЕНТА НА КУРС (CREATE)
// =================================================================

/** Группа должна принадлежать тренеру записи и быть активной */
const loadGroupForCoach = async (groupId, coachId) => {
    const group = await Group.findById(groupId).select('coach status name').lean();
    if (!group) throw notFound('Group not found.', 'GROUP_NOT_FOUND');
    if (String(group.coach) !== String(coachId)) {
        throw unprocessable("The group must belong to the enrollment's coach.", 'GROUP_COACH_MISMATCH');
    }
    if (group.status !== 'active') throw unprocessable('The group is archived.', 'GROUP_ARCHIVED');
    return group;
};

/** Убирает студента из группы, только если его больше не связывает с ней ни один контракт */
const releaseGroupMembership = async (studentId, groupId) => {
    if (!groupId) return;
    const stillLinked = await TrainingContract.exists({ student: studentId, group: groupId });
    if (!stillLinked) await Group.updateOne({ _id: groupId }, { $pull: { members: studentId } });
};

const assertDateOrder = (startDate, endDate) => {
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
        throw unprocessable('endDate must not be earlier than startDate.', 'VALIDATION_ERROR',
            [{ field: 'endDate', message: 'endDate must not be earlier than startDate.' }]);
    }
};

/**
 * Записывает существующего пользователя на курс (создаёт TrainingContract).
 * payload: { email | userUuid, courseId, groupId?, status?, startDate?, endDate?, coachId? (только ADMIN) }
 */
const enrollStudent = async (scope, payload) => {
    requireCoachProfile(scope);

    const student = payload.userUuid
        ? await User.findOne({ uuid: payload.userUuid }).select('_id uuid').lean()
        : await User.findOne({ email: payload.email.toLowerCase() }).select('_id uuid').lean();
    if (!student) {
        throw notFound('User not found. The student must register on the site first.', 'USER_NOT_FOUND');
    }

    const course = await Course.findById(payload.courseId).select('authors price status title').lean();
    if (!course) throw notFound('Course not found.', 'COURSE_NOT_FOUND');
    if (course.status === 'archived') throw unprocessable('Cannot enroll into an archived course.', 'COURSE_ARCHIVED');

    // Тренер записи: сам тренер (только на свой курс) или, для админа, указанный/первый автор курса
    let coachId;
    if (scope.isAdmin) {
        coachId = payload.coachId ? new ObjectId(payload.coachId) : course.authors[0];
        if (!coachId) throw unprocessable('The course has no authors; pass coachId.', 'COACH_REQUIRED');
        if (!(await Coach.exists({ _id: coachId }))) throw notFound('Coach not found.', 'COACH_NOT_FOUND');
    } else {
        if (!course.authors.some((a) => String(a) === String(scope.coachId))) {
            throw forbidden('You can enroll students only into your own courses.', 'NOT_COURSE_AUTHOR');
        }
        coachId = scope.coachId;
    }

    const coachUser = await Coach.findById(coachId).select('user').lean();
    if (coachUser && String(coachUser.user) === String(student._id)) {
        throw unprocessable('A coach cannot be enrolled as their own student.', 'SELF_ENROLLMENT');
    }

    const group = payload.groupId ? await loadGroupForCoach(payload.groupId, coachId) : null;
    assertDateOrder(payload.startDate, payload.endDate);

    const status = payload.status || (course.price?.amount > 0 ? 'pending_payment' : 'active');
    let contract;
    try {
        contract = await TrainingContract.create({
            student: student._id,
            course: course._id,
            coach: coachId,
            group: group ? group._id : null,
            status,
            priceAtPurchase: { amount: course.price?.amount ?? 0, currency: course.price?.currency ?? 'USD' },
            startDate: payload.startDate,
            endDate: payload.endDate,
        });
    } catch (e) {
        if (e.code === 11000) throw conflict('The student is already enrolled in this course.', 'ALREADY_ENROLLED');
        throw e;
    }
    if (group) await Group.updateOne({ _id: group._id }, { $addToSet: { members: student._id } });

    return getStudent(scope, student.uuid);
};

// =================================================================
//                   ИЗМЕНЕНИЕ / УДАЛЕНИЕ ЗАПИСИ
// =================================================================

const loadContractInScope = async (scope, uuid, contractId) => {
    const student = await findStudentByUuid(uuid);
    const contract = await TrainingContract.findOne({ _id: contractId, student: student._id }).lean();
    if (!contract || (!scope.isAdmin && String(contract.coach) !== String(scope.coachId))) {
        throw notFound('Enrollment not found.', 'ENROLLMENT_NOT_FOUND');
    }
    return { student, contract };
};

/**
 * payload: { status?, groupId? (null — убрать из группы), startDate?, endDate?, progressPercentage? }
 */
const updateEnrollment = async (scope, uuid, contractId, payload) => {
    requireCoachProfile(scope);
    const { student, contract } = await loadContractInScope(scope, uuid, contractId);
    const set = {};

    if (payload.status !== undefined && payload.status !== contract.status) {
        if (!STATUS_TRANSITIONS[contract.status].includes(payload.status)) {
            throw unprocessable(`Status cannot change from '${contract.status}' to '${payload.status}'.`, 'INVALID_STATUS_TRANSITION');
        }
        if (payload.status === 'refunded' && !scope.isAdmin) {
            throw forbidden('Only an administrator can mark an enrollment as refunded.', 'ADMIN_ONLY');
        }
        set.status = payload.status;
    }

    let newGroupId = contract.group;
    if (payload.groupId !== undefined) {
        newGroupId = payload.groupId ? (await loadGroupForCoach(payload.groupId, contract.coach))._id : null;
        set.group = newGroupId;
    }

    const startDate = payload.startDate !== undefined ? payload.startDate : contract.startDate;
    const endDate = payload.endDate !== undefined ? payload.endDate : contract.endDate;
    assertDateOrder(startDate, endDate);
    if (payload.startDate !== undefined) set.startDate = payload.startDate;
    if (payload.endDate !== undefined) set.endDate = payload.endDate;
    if (payload.progressPercentage !== undefined) set['progress.percentage'] = payload.progressPercentage;

    if (Object.keys(set).length === 0) return getStudent(scope, uuid);

    // Оптимистичная блокировка по статусу: параллельное изменение статуса не перетрётся молча
    const updated = await TrainingContract.findOneAndUpdate(
        { _id: contract._id, status: contract.status },
        { $set: set },
        { new: true, runValidators: true },
    );
    if (!updated) throw conflict('The enrollment was changed by someone else. Reload and try again.', 'CONCURRENT_UPDATE');

    // Синхронизация Group.members с контрактом
    if (String(newGroupId) !== String(contract.group)) {
        if (newGroupId) await Group.updateOne({ _id: newGroupId }, { $addToSet: { members: student._id } });
        await releaseGroupMembership(student._id, contract.group);
    }
    return getStudent(scope, uuid);
};

/**
 * Удаляет запись студента на курс. Оплаченную запись удалять нельзя (финансовая история) —
 * её переводят в cancelled/refunded. Вместе с записью удаляются её неоплаченные платежи и
 * будущие индивидуальные занятия по ней; членство в группе снимается.
 */
const deleteEnrollment = async (scope, uuid, contractId) => {
    requireCoachProfile(scope);
    const { student, contract } = await loadContractInScope(scope, uuid, contractId);

    if (await Payment.exists({ contract: contract._id, status: 'succeeded' })) {
        throw conflict('The enrollment has a successful payment. Set its status to cancelled or refunded instead.', 'HAS_PAYMENTS');
    }

    await TrainingContract.deleteOne({ _id: contract._id });
    const futureLessons = await Schedule.find({ contract: contract._id, status: 'scheduled', date: { $gte: new Date() } }).distinct('_id');
    await Promise.all([
        Payment.deleteMany({ contract: contract._id, status: { $ne: 'succeeded' } }),
        Schedule.deleteMany({ _id: { $in: futureLessons } }),
        // ДЗ к удалённым занятиям остаются (могли быть сдачи), но без ссылки на занятие
        Assignment.updateMany({ schedule: { $in: futureLessons } }, { $unset: { schedule: 1 } }),
        releaseGroupMembership(student._id, contract.group),
    ]);
};

// =================================================================
//                    ПРОФИЛЬ СТУДЕНТА (ADMIN)
// =================================================================

/** payload: { firstName?, lastName?, phone? (null — удалить) } */
const updateStudentProfile = async (uuid, payload) => {
    const set = {};
    const unset = {};
    if (payload.firstName !== undefined) set.firstName = payload.firstName;
    if (payload.lastName !== undefined) set.lastName = payload.lastName;
    if (payload.phone !== undefined) {
        if (payload.phone === null || payload.phone === '') unset.phone = 1;
        else set.phone = payload.phone;
    }
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
        throw badRequest('Nothing to update.', 'EMPTY_UPDATE');
    }
    const user = await User.findOneAndUpdate(
        { uuid },
        { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        { new: true, runValidators: true },
    ).select(STUDENT_FIELDS).lean();
    if (!user) throw notFound('Student not found.', 'STUDENT_NOT_FOUND');
    return user;
};

module.exports = {
    ENROLLMENT_STATUSES,
    INITIAL_STATUSES,
    STATUS_TRANSITIONS,
    resolveScope,
    listStudents,
    getStudent,
    enrollStudent,
    updateEnrollment,
    deleteEnrollment,
    updateStudentProfile,
};
