// models/TestUser.js

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');

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

}, { 
    timestamps: true // Заменяем registrationDate на createdAt и updatedAt
});

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