// models/Club.js — арендатор (tenant) платформы: отдельный шахматный клуб/школа.
// Каждый клуб — изолированное пространство: группы, курсы, задачники, расписание,
// занятия и платежи одного клуба не видны другим. Пользователи — глобальные
// (TestUser), их принадлежность к клубу и роль хранит ClubMembership.

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Лимиты тарифов (enforcement — в биллинге #8). Держим и как справочник, и в документе клуба,
// чтобы смена тарифа фиксировала актуальные лимиты на момент перехода.
const PLAN_LIMITS = {
    start: { maxStudents: 30, maxTrainers: 1, maxLessonSize: 8 },
    club: { maxStudents: 150, maxTrainers: 10, maxLessonSize: 30 },
    academy: { maxStudents: null, maxTrainers: null, maxLessonSize: null }, // без лимита
};

const ClubSchema = new Schema({
    name: { type: String, required: [true, 'Club name is required'], trim: true },
    // Человекочитаемый идентификатор клуба (debiut.app/<slug>) — уникальный
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    city: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
    brand: {
        primaryColor: { type: String, default: '#2B50E0' },
    },
    // Владелец клуба (его membership.role === 'owner')
    owner: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true, index: true },
    plan: { type: String, enum: ['start', 'club', 'academy'], default: 'start' },
    limits: {
        maxStudents: { type: Number, default: PLAN_LIMITS.start.maxStudents },
        maxTrainers: { type: Number, default: PLAN_LIMITS.start.maxTrainers },
        maxLessonSize: { type: Number, default: PLAN_LIMITS.start.maxLessonSize },
    },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    // Биллинг (Stripe-подписка) — детали заполнит #8
    billing: {
        stripeCustomerId: { type: String },
        stripeSubscriptionId: { type: String },
        currentPeriodEnd: { type: Date },
    },
    // Конфиг ботов (привязки) — детали заполнит #8
    botConfig: {
        telegram: { enabled: { type: Boolean, default: false } },
        whatsapp: { enabled: { type: Boolean, default: false } },
    },
}, { timestamps: true });

// При смене тарифа подтягиваем его лимиты (если лимиты не заданы вручную)
ClubSchema.pre('save', function (next) {
    if (this.isModified('plan') && PLAN_LIMITS[this.plan]) {
        this.limits = { ...PLAN_LIMITS[this.plan] };
    }
    next();
});

ClubSchema.statics.PLAN_LIMITS = PLAN_LIMITS;
ClubSchema.statics.limitsForPlan = (plan) => ({ ...(PLAN_LIMITS[plan] || PLAN_LIMITS.start) });

module.exports = mongoose.model('Club', ClubSchema);
module.exports.PLAN_LIMITS = PLAN_LIMITS;
