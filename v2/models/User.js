// models/TestUser.js

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');

// Рейтинг в одной категории: Glicko-2 (рейтинг, отклонение, волатильность) и число рейтинговых партий
const PerfSchema = new mongoose.Schema({
    rating: { type: Number, default: 1500 },
    rd: { type: Number, default: 350 },
    vol: { type: Number, default: 0.06 },
    games: { type: Number, default: 0 },
}, { _id: false });

// Я оставляю эту модель "легкой", как мы и решили. 
// Все связи (студенты, тренер, профиль тренера) УБРАНЫ.
const TestUserSchema = new mongoose.Schema({
     uuid: {
        type: String,
        required: true,
        unique: true,
        default: () => randomUUID(),
        index: true, 
    },
    // Идентификация
    firebaseUID: {
        type: String,
        unique: true,
        sparse: true,
    },
    firstName: {
        type: String,
        required: true,
    },
    lastName: {
        type: String,
        required: true,
    },
    avatarUrl: { // <-- ПЕРЕИМЕНОВЫВАЕМ И МЕНЯЕМ ТИП
        type: String,
        trim: true,
    },
    // Аутентификация и безопасность
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true, // регистрация и так приводит к нижнему регистру — фиксируем на уровне схемы
    },
    // Контактный телефон в формате E.164 (+380501234567); необязателен
    phone: {
        type: String,
        trim: true,
        match: [/^\+[1-9]\d{7,14}$/, 'Phone must be in international format, e.g. +380501234567'],
    },
    emailVerified: {
        type: Boolean, 
        default: true 
    }, 
    verificationToken: { 
        type: String,
    },
    password: {
        type: String,
        required: true,
    },
    
    // Авторизация
    roles: {
        type: [String], // Пока без enum, если вы предпочитаете так
        default: ['USER'],
    },
    
    // Управление сессией
    sessionTokenVersion: {
        type: Number,
        default: 0,
    },

    // Рейтинги онлайн-партий (Glicko-2, v2/utils/ratingCalculator.js) — по категориям контроля времени
    ratings: {
        bullet: { type: PerfSchema, default: () => ({}) },
        blitz: { type: PerfSchema, default: () => ({}) },
        rapid: { type: PerfSchema, default: () => ({}) },
        classical: { type: PerfSchema, default: () => ({}) },
    },

}, {
    timestamps: true // Заменяем registrationDate на createdAt и updatedAt
});

// Поиск студентов по имени (список студентов тренера/админа)
TestUserSchema.index({ lastName: 1, firstName: 1 });

// Хуки оставляем, они идеальны
TestUserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

TestUserSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
};

// Экспортируем как 'TestUser', чтобы не конфликтовать с вашей основной моделью
module.exports = mongoose.model('TestUser', TestUserSchema);