// v2/services/coachApplication.service.js
//
// Заявки «хочу стать тренером» со страницы «Тренеры».
//   пользователь: подать заявку, посмотреть статус своей последней заявки;
//   ADMIN: список всех заявок, одобрить (выдать роль COACH + создать черновик профиля Coach) или отклонить.
// Списаться с кандидатом админ может через обычный чат (chat.service: ADMIN пишет любому).
// Ошибки — ApiError -> { msg, code, details? } (errorHandlerV2).

const userRepo = require('../repositories/user.repo'); // шов identity (mongo|pg по USER_DB)
const coachRepo = require('../repositories/coach.repo'); // шов coaching (mongo|pg по COACHING_DB)
const CoachApplication = require('../models/CoachApplication');
const { notify: emitNotification } = require('./notify');
const { conflict, forbidden, notFound } = require('../utils/apiError');

const SUPPORTED_LANGS = ['en', 'uk', 'pl'];
const PUBLIC_USER = 'uuid firstName lastName avatarUrl email phone';

// Через общий сервис (репозиторий-шов mongo|pg). Ошибки он уже глотает сам.
const notify = (recipient, type, message, link) => emitNotification({ recipient, type, message, link });

const toDto = (a) => ({
    _id: a._id,
    status: a.status,
    headline: a.headline,
    motivation: a.motivation,
    experience: a.experience,
    specializations: a.specializations || [],
    contact: a.contact,
    fideProfile: a.fideProfile || null,
    adminNote: a.adminNote || '',
    createdAt: a.createdAt,
    decidedAt: a.decidedAt,
    applicant: a.applicant && a.applicant._id
        ? {
            _id: a.applicant._id,
            uuid: a.applicant.uuid,
            firstName: a.applicant.firstName,
            lastName: a.applicant.lastName,
            avatarUrl: a.applicant.avatarUrl || null,
            email: a.applicant.email,
            phone: a.applicant.phone || null,
        }
        : a.applicant,
});

/** Пользователь подаёт заявку на роль тренера */
const submit = async (user, payload, club) => {
    const current = await userRepo.findById(user.id);
    if (!current) throw notFound('User not found.', 'USER_NOT_FOUND');
    if ((current.roles || []).includes('COACH')) {
        throw conflict('You are already a coach.', 'ALREADY_COACH');
    }
    if (await CoachApplication.exists({ applicant: user.id, status: 'pending' })) {
        throw conflict('You already have a pending application.', 'APPLICATION_PENDING');
    }

    const sourceLang = SUPPORTED_LANGS.includes(payload.sourceLang) ? payload.sourceLang : 'en';
    let application;
    try {
        application = await CoachApplication.create({
            applicant: user.id,
            headline: payload.headline || '',
            motivation: payload.motivation,
            experience: payload.experience || '',
            specializations: Array.isArray(payload.specializations) ? payload.specializations.filter(Boolean) : [],
            contact: payload.contact || '',
            fideProfile: payload.fideProfile || undefined,
            sourceLang,
            ...(club ? { club } : {}),
        });
    } catch (e) {
        if (e.code === 11000) throw conflict('You already have a pending application.', 'APPLICATION_PENDING');
        throw e;
    }

    // Оповестить всех админов — им в «Заявки тренеров» на рассмотрение
    const admins = await userRepo.findAdmins();
    const applicant = await userRepo.findById(user.id);
    const who = `${applicant?.firstName ?? ''} ${applicant?.lastName ?? ''}`.trim() || 'A user';
    await Promise.all(admins.map((a) => notify(a._id, 'COACH_APPLICATION', `${who} applied to become a coach`, '/coach-applications')));

    return toDto(application.toObject());
};

/** Последняя заявка текущего пользователя (или null) */
const getMine = async (user) => {
    const application = await CoachApplication.findOne({ applicant: user.id }).sort({ createdAt: -1 }).lean();
    return application ? toDto(application) : null;
};

/** Список заявок для админа; status — фильтр, рассматриваемые первыми */
const list = async (user, { status } = {}, club) => {
    if (!(user.roles || []).includes('ADMIN')) throw forbidden();
    // Изоляция по клубу (#7): если активный клуб определён — только его заявки
    const filter = { ...(club ? { club } : {}) };
    if (status) filter.status = status;
    const applications = await CoachApplication.find(filter)
        .sort({ createdAt: -1 })
        .limit(300)
        .populate('applicant', PUBLIC_USER)
        .lean();
    const order = { pending: 0, approved: 1, rejected: 2 };
    return applications.sort((a, b) => order[a.status] - order[b.status]).map(toDto);
};

/** Профиль Coach-черновик из данных заявки (en обязателен в схеме Coach) */
const seedFields = (application) => {
    const lang = SUPPORTED_LANGS.includes(application.sourceLang) ? application.sourceLang : 'en';
    const fields = {};
    const localized = (text) => (lang === 'en' ? { en: text } : { en: text, [lang]: text });
    if (application.headline) fields.headline = localized(application.headline);
    if (application.motivation) fields.bio = localized(application.motivation);
    if (application.specializations && application.specializations.length) {
        fields.specializations = lang === 'en'
            ? { en: application.specializations }
            : { en: application.specializations, [lang]: application.specializations };
    }
    if (application.fideProfile) fields.fideProfile = application.fideProfile;
    return fields;
};

/**
 * Решение по заявке (только ADMIN).
 * approved: пользователю выдаётся роль COACH и создаётся черновик профиля Coach из данных заявки;
 * rejected: кандидат получает уведомление (с опциональным комментарием).
 */
const decide = async (user, applicationId, { status, adminNote }) => {
    if (!(user.roles || []).includes('ADMIN')) throw forbidden();

    const application = await CoachApplication.findById(applicationId);
    if (!application) throw notFound('Application not found.', 'APPLICATION_NOT_FOUND');
    if (application.status !== 'pending') throw conflict('This application has already been decided.', 'APPLICATION_ALREADY_DECIDED');

    if (status === 'approved') {
        const applicant = await userRepo.findById(application.applicant);
        if (!applicant) throw notFound('Applicant not found.', 'USER_NOT_FOUND');
        if (!applicant.roles.includes('COACH')) {
            await userRepo.addRole(applicant._id, 'COACH');
        }
        // Профиль заполнен данными заявки и сразу виден в каталоге:
        // одобрение заявки админом и есть проверка кандидата, отдельная верификация не нужна.
        await coachRepo.upsertByUser(applicant._id, { set: { ...seedFields(application), isVerified: true } });
    }

    application.status = status;
    application.adminNote = adminNote || '';
    application.decidedAt = new Date();
    application.decidedBy = user.id;
    await application.save();

    await notify(
        application.applicant, 'COACH_APPLICATION_DECIDED',
        status === 'approved'
            ? 'You are now a coach — set up your public profile'
            : 'Your coach application was declined',
        '/coaches',
    );

    return toDto(application.toObject());
};

module.exports = { submit, getMine, list, decide };
