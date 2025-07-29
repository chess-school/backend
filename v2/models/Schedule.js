// models/Schedule.js (перепроектированная)

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ScheduleSchema = new Schema({
    // --- ОБЩАЯ ИНФОРМАЦИЯ О СОБЫТИИ ---
    title: { type: String, required: true },
    description: { type: String, default: '' },
    date: { type: Date, required: true },
    durationMinutes: { type: Number },
    link: { type: String, default: '' }, // Ссылка на Zoom, Google Meet и т.д.
    status: {
        type: String,
        enum: ['scheduled', 'completed', 'cancelled', 'missed'],
        default: 'scheduled'
    },
    coach: { // Тренер, проводящий занятие. Теперь ссылается на Coach.
        type: Schema.Types.ObjectId,
        ref: 'Coach',
        required: true,
    },
    
    // --- КЛЮЧЕВОЕ УЛУЧШЕНИЕ: КОНТЕКСТ СОБЫТИЯ ---
    // Для кого это событие? Определяется одним из полей ниже.
    context: {
        type: { // Тип контекста
            type: String,
            required: true,
            enum: ['individual', 'group', 'course_wide'], // Индивидуальное, для группы, для всего курса
        },
        refId: { // ID связанной сущности
            type: Schema.Types.ObjectId,
            required: true,
            // 'refPath' позволяет Mongoose динамически ссылаться на разные коллекции
            // в зависимости от значения поля 'context.type'.
            // К сожалению, для enum это работает криво, поэтому мы просто храним ID,
            // а populate будем делать в коде. Давайте упростим, убрав refPath для ясности.
            // Но логика такова: если type='individual', refId=userId; если type='group', refId=groupId
        }
    },

    // Опциональная ссылка на контракт. Полезна для аналитики.
    // Например, чтобы понять, сколько уроков из пакета было потрачено.
    contract: { 
        type: Schema.Types.ObjectId,
        ref: 'TrainingContract',
    }

}, { timestamps: true });

// Индексы для быстрого поиска
ScheduleSchema.index({ coach: 1, date: 1 }); // Календарь тренера
ScheduleSchema.index({ "context.refId": 1, date: 1 }); // Календарь для студента/группы

module.exports = mongoose.model('ScheduleV2', ScheduleSchema);