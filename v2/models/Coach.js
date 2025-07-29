// models/Coach.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Вспомогательная схема для хранения текстовых полей на нескольких языках.
 * `required: true` для `en`, так как английский будет языком по умолчанию (fallback).
 */
const LocalizedStringSchema = new Schema({
    en: { type: String, trim: true, required: true },
    uk: { type: String, trim: true },
    pl: { type: String, trim: true }
}, { _id: false }); // _id: false, так как это вложенный документ, ему не нужен свой ID

/**
 * Аналогичная схема для массива строк (для специализаций).
 */
const LocalizedStringArraySchema = new Schema({
    en: { type: [String], default: [] },
    uk: { type: [String], default: [] },
    pl: { type: [String], default: [] }
}, { _id: false });


// --- ОСНОВНАЯ СХЕМА ТРЕНЕРА ---
const CoachSchema = new Schema({
    // --- КЛЮЧЕВАЯ СВЯЗЬ ---
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User', // Теперь наша основная модель 'User' из v2
        required: true,
        unique: true,
    },

    // --- ПУБЛИЧНЫЙ ПРОФЕССИОНАЛЬНЫЙ ПРОФИЛЬ (теперь многоязычный) ---
    headline: LocalizedStringSchema,
    bio: LocalizedStringSchema,
    specializations: LocalizedStringArraySchema,
    
    // --- ОФИЦИАЛЬНЫЕ ДАННЫЕ FIDE (не переводятся) ---
    fideProfile: {
        fideId: String,
        title: {
            type: String,
            enum: ['GM', 'IM', 'FM', 'CM', 'WGM', 'WIM', 'WFM', 'WCM', 'NM', 'None'],
            default: 'None'
        },
        rating: {
            standard: Number,
            rapid: Number,
            blitz: Number,
        },
        profileUrl: String
    },
    
    // --- ВНУТРЕННИЕ ДАННЫЕ СИСТЕМЫ (не переводятся) ---
    isVerified: {
        type: Boolean,
        default: false,
    },
    platformRating: {
        average: { type: Number, default: 0 },
        count: { type: Number, default: 0 },
    },
    
    // --- ФИНАНСОВАЯ ИНФОРМАЦИЯ (не переводится) ---
    payoutInfo: {
        provider: String,
        accountId: String,
        status: String,
    },

}, { timestamps: true });


CoachSchema.index({ user: 1 });

module.exports = mongoose.model('Coach', CoachSchema);