// v2/models/CoachApplication.js
//
// Заявка пользователя на роль тренера. Обычный USER подаёт кандидатуру со страницы «Тренеры»,
// админ её рассматривает (может списаться с кандидатом через чат) и одобряет или отклоняет.
// При одобрении пользователю выдаётся роль COACH и создаётся профиль Coach (черновик),
// который кандидат дополняет на странице «Тренеры».
// Одновременно у пользователя может быть только одна заявка на рассмотрении.

const mongoose = require('mongoose');
const { Schema } = mongoose;

const APPLICATION_STATUSES = ['pending', 'approved', 'rejected'];
const FIDE_TITLES = ['GM', 'IM', 'FM', 'CM', 'WGM', 'WIM', 'WFM', 'WCM', 'NM', 'None'];
const MOTIVATION_MAX = 2000;
const EXPERIENCE_MAX = 2000;

const CoachApplicationSchema = new Schema({
    // Клуб-владелец (мульти-арендность #7). Проставляется при создании из req.club.
    club: { type: Schema.Types.ObjectId, ref: 'Club', index: true },
    applicant: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },

    // --- Данные, которые видит админ при рассмотрении ---
    headline: { type: String, trim: true, maxlength: 200, default: '' },
    motivation: { type: String, trim: true, maxlength: MOTIVATION_MAX, required: true },
    experience: { type: String, trim: true, maxlength: EXPERIENCE_MAX, default: '' },
    specializations: { type: [String], default: [] },
    contact: { type: String, trim: true, maxlength: 200, default: '' },

    // --- Официальные данные FIDE (переносятся в профиль Coach при одобрении) ---
    fideProfile: {
        fideId: { type: String, trim: true },
        title: { type: String, enum: FIDE_TITLES, default: 'None' },
        rating: {
            standard: Number,
            rapid: Number,
            blitz: Number,
        },
        profileUrl: { type: String, trim: true },
    },

    // Язык, на котором кандидат заполнил анкету — для локализации профиля Coach
    sourceLang: { type: String, default: 'en' },

    // --- Решение админа ---
    status: { type: String, enum: APPLICATION_STATUSES, default: 'pending' },
    adminNote: { type: String, trim: true, maxlength: 2000, default: '' },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'TestUser', default: null },
}, { timestamps: true });

// Не больше одной заявки на рассмотрении у пользователя (гонка двух кликов -> 11000 -> 409)
CoachApplicationSchema.index({ applicant: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
// Список заявок для админа: сначала новые
CoachApplicationSchema.index({ status: 1, createdAt: -1 });

const CoachApplication = mongoose.model('CoachApplication', CoachApplicationSchema);
CoachApplication.APPLICATION_STATUSES = APPLICATION_STATUSES;
CoachApplication.FIDE_TITLES = FIDE_TITLES;
CoachApplication.MOTIVATION_MAX = MOTIVATION_MAX;
CoachApplication.EXPERIENCE_MAX = EXPERIENCE_MAX;

module.exports = CoachApplication;
