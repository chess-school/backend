// models/Lead.js — заявка на пробное занятие с публичного сайта клуба (debiut, этап Leads).
// Персональные данные посетителя: доступ только у владельца клуба (и назначенного тренера — позже).
// НИКАКОГО сырого HTML; строки чистятся/ограничиваются в контроллере перед записью.

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LeadSchema = new Schema({
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
    source: { type: String, enum: ['site', 'manual'], default: 'site' },
    pagePath: { type: String, maxlength: 300 },

    who: { type: String, enum: ['self', 'child'], default: 'self' },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    childAge: { type: Number, min: 3, max: 99 },
    email: { type: String, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 40 },
    level: { type: String, enum: ['new', 'rules', 'tournaments', ''], default: '' },
    format: { type: String, enum: ['offline', 'online', ''], default: '' },
    preferredTime: { type: String, trim: true, maxlength: 120 },

    coach: { type: Schema.Types.ObjectId, ref: 'Coach' },   // если пришли с профиля тренера
    group: { type: Schema.Types.ObjectId, ref: 'Group' },

    status: { type: String, enum: ['new', 'contacted', 'trial_scheduled', 'trial_done', 'converted', 'lost'], default: 'new', index: true },
    lostReason: { type: String, maxlength: 300 },
    assignee: { type: Schema.Types.ObjectId, ref: 'TestUser' },
    note: { type: String, maxlength: 2000 },

    consent: { at: Date, ip: String },
}, { timestamps: true });

LeadSchema.index({ club: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Lead', LeadSchema);
