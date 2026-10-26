// v2/models/CoachRequest.js
//
// Заявка ученика тренеру со страницы «Тренеры». Тренер одобряет её, записывая ученика на свой курс
// (создаётся TrainingContract — так ученик появляется в «Моих учениках» и может писать в чат),
// или отклоняет. Одновременно у пары может быть только одна заявка на рассмотрении.

const mongoose = require('mongoose');
const { Schema } = mongoose;

const EXPERIENCE_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const REQUEST_STATUSES = ['pending', 'approved', 'rejected'];
const GOALS_MAX = 1000;

const CoachRequestSchema = new Schema({
    // Клуб-владелец (мульти-арендность #7). Проставляется при создании из req.club.
    club: { type: Schema.Types.ObjectId, ref: 'Club', index: true },
    student: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },
    coach: { type: Schema.Types.ObjectId, ref: 'Coach', required: true },
    experience: { type: String, enum: EXPERIENCE_LEVELS, required: true },
    goals: { type: String, trim: true, maxlength: GOALS_MAX, default: '' },
    status: { type: String, enum: REQUEST_STATUSES, default: 'pending' },
    decidedAt: { type: Date, default: null },
    /** Запись на курс, созданная при одобрении */
    enrollment: { type: Schema.Types.ObjectId, ref: 'TrainingContract', default: null },
}, { timestamps: true });

// Не больше одной заявки на рассмотрении у пары ученик–тренер (гонка двух кликов -> 11000 -> 409)
CoachRequestSchema.index({ student: 1, coach: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
// Список заявок тренера: сначала новые
CoachRequestSchema.index({ coach: 1, status: 1, createdAt: -1 });

const CoachRequest = mongoose.model('CoachRequest', CoachRequestSchema);
CoachRequest.EXPERIENCE_LEVELS = EXPERIENCE_LEVELS;
CoachRequest.REQUEST_STATUSES = REQUEST_STATUSES;
CoachRequest.GOALS_MAX = GOALS_MAX;

module.exports = CoachRequest;
