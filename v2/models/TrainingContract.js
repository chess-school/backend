// models/TrainingContract.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TrainingContractSchema = new Schema({
    // --- КЛЮЧЕВЫЕ УЧАСТНИКИ "СДЕЛКИ" ---
    student: {
        type: Schema.Types.ObjectId,
        ref: 'TestUser',
        required: true,
    },
    course: {
        type: Schema.Types.ObjectId,
        ref: 'Course',
        required: true,
    },
    coach: { // Основной ответственный тренер по этому контракту
        type: Schema.Types.ObjectId,
        ref: 'Coach',
        required: true,
    },

    // --- КОНТЕКСТ ОБУЧЕНИЯ ---
    group: { // Необязательная ссылка на группу
        type: Schema.Types.ObjectId,
        ref: 'Group',
        default: null,
    },
    
    // --- УСЛОВИЯ КОНТРАКТА (что было куплено) ---
    // Эти данные копируются из Course в момент создания, чтобы зафиксировать условия
    priceAtPurchase: {
        amount: { type: Number, required: true },
        currency: { type: String, required: true },
    },
    packageSnapshot: { // "Снимок" пакета услуг на момент покупки
        description: { type: String }, // Например, "Полный курс с 2 инд. занятиями"
        individualLessonsTotal: { type: Number, default: 0 },
        groupLessonsTotal: { type: Number, default: 0 },
        // Сюда можно добавить и другие ресурсы, например, количество проверок ДЗ
    },

    // --- ЖИЗНЕННЫЙ ЦИКЛ И ПРОГРЕСС ---
    status: {
        type: String,
        enum: [
            'pending_payment',  // Ожидает оплаты
            'pending_approval', // Ожидает подтверждения (если нужна ручная модерация)
            'active',           // Активен, обучение идет
            'completed',        // Успешно завершен
            'cancelled',        // Отменен студентом
            'refunded'          // Возвращен платеж
        ],
        required: true,
        default: 'pending_payment',
    },
    progress: { // Отслеживание прогресса по курсу
        completedLessons: [{ // Массив ID пройденных уроков
            type: Schema.Types.ObjectId, // Здесь могут быть ID из Course.modules.lessons
        }],
        lessonsCompletedCount: { type: Number, default: 0 },
        percentage: { type: Number, default: 0, min: 0, max: 100 },
    },
    
    // --- Даты ---
    startDate: { type: Date }, // Дата начала обучения (может быть в будущем)
    endDate: { type: Date },   // Дата окончания доступа

}, { timestamps: true });


// Индексы для ускорения частых запросов
TrainingContractSchema.index({ student: 1, course: 1 }, { unique: true }); // Студент не может дважды купить один и тот же курс
TrainingContractSchema.index({ coach: 1, status: 1 }); // Найти всех активных студентов тренера
TrainingContractSchema.index({ group: 1 }); // Найти всех участников группы (по контрактам)

module.exports = mongoose.model('TrainingContract', TrainingContractSchema);