// v2/services/coachRequest.service.js
//
// Заявки «хочу заниматься с этим тренером» со страницы «Тренеры».
//   ученик: отправить заявку верифицированному тренеру, посмотреть свои заявки;
//   тренер: список заявок, одобрить (запись ученика на свой курс через student.service.enrollStudent —
//           ученик сразу появляется в «Моих учениках» и в чате) или отклонить;
//   ADMIN: видит и решает заявки любого тренера.
// Ошибки — ApiError -> { msg, code, details? } (errorHandlerV2).

const User = require('../models/User');
const Coach = require('../models/Coach');
const Course = require('../models/Course');
const TrainingContract = require('../models/TrainingContract');
const CoachRequest = require('../models/CoachRequest');
const Notification = require('../models/Notification');
const studentService = require('./student.service');
const { conflict, forbidden, notFound, unprocessable } = require('../utils/apiError');

const PUBLIC_USER = 'uuid firstName lastName avatarUrl email';
// Ученик уже занимается с тренером — новая заявка не нужна
const LINKED_STATUSES = ['pending_payment', 'pending_approval', 'active'];

const isAdmin = (user) => (user.roles || []).includes('ADMIN');

const toDto = (r) => ({
    _id: r._id,
    status: r.status,
    experience: r.experience,
    goals: r.goals,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    enrollment: r.enrollment,
    student: r.student && r.student._id
        ? { _id: r.student._id, uuid: r.student.uuid, firstName: r.student.firstName, lastName: r.student.lastName, avatarUrl: r.student.avatarUrl || null, email: r.student.email }
        : r.student,
    coach: r.coach && r.coach._id
        ? { _id: r.coach._id, user: r.coach.user && r.coach.user._id ? { _id: r.coach.user._id, uuid: r.coach.user.uuid, firstName: r.coach.user.firstName, lastName: r.coach.user.lastName, avatarUrl: r.coach.user.avatarUrl || null } : r.coach.user }
        : r.coach,
});

const notify = (recipient, type, message, link) => Notification.create({ recipient, type, message, metadata: { link } })
    // Уведомление — не повод проваливать заявку
    .catch((e) => console.error('Coach request notification failed:', e.message));

/** Ученик отправляет заявку тренеру (coachId — id профиля Coach) */
const createRequest = async (user, coachId, { experience, goals }, club) => {
    const coach = await Coach.findOne({ _id: coachId, isVerified: true }).select('user').lean();
    if (!coach) throw notFound('Coach not found.', 'COACH_NOT_FOUND');
    if (String(coach.user) === String(user.id)) throw unprocessable('You cannot send a request to yourself.', 'SELF_REQUEST');

    const linked = await TrainingContract.exists({ student: user.id, coach: coach._id, status: { $in: LINKED_STATUSES } });
    if (linked) throw conflict('You are already a student of this coach.', 'ALREADY_STUDENT');
    if (await CoachRequest.exists({ student: user.id, coach: coach._id, status: 'pending' })) {
        throw conflict('You have already sent a request to this coach.', 'REQUEST_PENDING');
    }

    let request;
    try {
        request = await CoachRequest.create({ student: user.id, coach: coach._id, experience, goals: goals || '', ...(club ? { club } : {}) });
    } catch (e) {
        if (e.code === 11000) throw conflict('You have already sent a request to this coach.', 'REQUEST_PENDING');
        throw e;
    }
    const student = await User.findById(user.id).select('firstName lastName').lean();
    await notify(coach.user, 'COACH_REQUEST', `${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim() || 'New student request', '/inbox');
    return toDto(request.toObject());
};

/** Заявки, отправленные учеником (для статуса на карточках тренеров) */
const listSentRequests = async (user) => {
    const requests = await CoachRequest.find({ student: user.id })
        .sort({ createdAt: -1 })
        .populate({ path: 'coach', select: 'user', populate: { path: 'user', select: PUBLIC_USER } })
        .lean();
    return requests.map(toDto);
};

/** Профиль тренера текущего пользователя (ADMIN без профиля — null: видит всех) */
const coachScope = async (user) => {
    const coach = await Coach.findOne({ user: user.id }).select('_id').lean();
    if (!coach && !isAdmin(user)) {
        throw forbidden('Create your coach profile (PUT /api/v2/coaches/me) first.', 'COACH_PROFILE_REQUIRED');
    }
    return coach ? coach._id : null;
};

/** Заявки тренеру; status — фильтр (по умолчанию все, рассматриваемые — первыми) */
const listCoachRequests = async (user, { status } = {}, club) => {
    const coachId = await coachScope(user);
    // ADMIN видит заявки всех тренеров
    const filter = isAdmin(user) ? {} : { coach: coachId };
    // Изоляция по клубу (#7): если активный клуб определён — только его заявки
    if (club) filter.club = club;
    if (status) filter.status = status;
    const requests = await CoachRequest.find(filter)
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('student', PUBLIC_USER)
        .lean();
    const order = { pending: 0, approved: 1, rejected: 2 };
    return requests.sort((a, b) => order[a.status] - order[b.status]).map(toDto);
};

// Персональный курс тренера для заявок без явно выбранного курса.
// Один на тренера (находим по автору+маркеру), чтобы не плодить дубли при каждом одобрении.
const DEFAULT_COURSE_TITLE = 'Individual lessons';

/** courseId из запроса, либо персональный курс тренера (найти-или-создать). Возвращает id курса. */
const resolveCourseForApproval = async (coachId) => {
    const existing = await Course.findOne({ authors: coachId, title: DEFAULT_COURSE_TITLE }).select('_id').lean();
    if (existing) return existing._id;
    const created = await Course.create({
        title: DEFAULT_COURSE_TITLE,
        description: 'Individual training sessions with your coach.',
        authors: [coachId],
        price: { amount: 0, currency: 'USD' },
        status: 'draft',
    });
    return created._id;
};

/**
 * Решение по заявке. approved: ученик записывается на выбранный курс тренера, либо —
 * если courseId не передан — на его персональный курс (создаётся при первом одобрении).
 * enrollStudent проверяет, что курс — его, и не даёт записать дважды.
 */
const decideRequest = async (user, requestId, { status, courseId }) => {
    const coachId = await coachScope(user);
    const request = await CoachRequest.findById(requestId).populate('student', PUBLIC_USER).lean();
    if (!request || (!isAdmin(user) && String(request.coach) !== String(coachId))) {
        throw notFound('Request not found.', 'REQUEST_NOT_FOUND');
    }
    if (request.status !== 'pending') throw conflict('This request has already been decided.', 'REQUEST_ALREADY_DECIDED');

    let enrollment = null;
    if (status === 'approved') {
        const scope = await studentService.resolveScope(user);
        const effectiveCourseId = courseId || await resolveCourseForApproval(request.coach);
        // Админ одобряет от имени тренера заявки
        await studentService.enrollStudent(scope, { userUuid: request.student.uuid, courseId: effectiveCourseId, coachId: String(request.coach) });
        const contract = await TrainingContract.findOne({ student: request.student._id, course: effectiveCourseId }).select('_id').lean();
        enrollment = contract ? contract._id : null;
    }

    // Условие на status — защита от параллельного решения той же заявки
    const updated = await CoachRequest.findOneAndUpdate(
        { _id: request._id, status: 'pending' },
        { $set: { status, decidedAt: new Date(), enrollment } },
        { new: true },
    ).populate('student', PUBLIC_USER).lean();
    if (!updated) throw conflict('This request has already been decided.', 'REQUEST_ALREADY_DECIDED');

    await notify(
        request.student._id, 'COACH_REQUEST_DECIDED',
        status === 'approved' ? 'Your coach request was approved' : 'Your coach request was declined',
        status === 'approved' ? '/students-shedule' : '/coaches',
    );
    return toDto(updated);
};

module.exports = { createRequest, listSentRequests, listCoachRequests, decideRequest };
