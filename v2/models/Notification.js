// models/Notification.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NotificationSchema = new Schema({
    // --- Получатель ---
    recipient: {
        type: Schema.Types.ObjectId,
        ref: 'TestUser', // Обновляем ссылку на 'TestUser'
        required: true,
        index: true, // Индексируем для быстрого поиска всех уведомлений пользователя
    },

    // --- Содержимое уведомления ---
    // Короткий, человекочитаемый текст
    message: { 
        type: String,
        required: true,
    },
    // Более детальное описание, если нужно
    description: {
        type: String,
    },
    
    // --- ТИП И КОНТЕКСТ (Ключевое улучшение) ---
    // Систематизированный тип, отражающий новую архитектуру
    type: {
        type: String,
        required: true,
        enum: [
            // Связанные с обучением
            'NEW_ASSIGNMENT',           // Новое ДЗ
            'SUBMISSION_RECEIVED',      // Студент сдал ДЗ (уведомление для тренера)
            'SUBMISSION_REVIEWED',      // ДЗ проверено (уведомление для студента)
            'GROUP_INVITE',             // Приглашение в группу
            'NEW_GROUP_LESSON',         // Новое групповое занятие в расписании
            'NEW_LESSON',               // Новое индивидуальное занятие в расписании
            'LESSON_REMINDER',          // Напоминание о занятии
            
            // Связанные с оплатами и курсами
            'CONTRACT_APPROVED',        // Ваша заявка на курс одобрена
            'COACH_REQUEST',            // Новая заявка ученика (уведомление для тренера)
            'COACH_REQUEST_DECIDED',    // Тренер одобрил/отклонил заявку (для ученика)
            'PAYMENT_SUCCESSFUL',       // Платеж прошел успешно
            'PAYMENT_FAILED',           // Ошибка платежа

            // Заявки на роль тренера
            'COACH_APPLICATION',          // Новая заявка на роль тренера (уведомление для админов)
            'COACH_APPLICATION_DECIDED',  // Админ одобрил/отклонил заявку (для кандидата)

            // Социальные и системные
            'NEW_MESSAGE',              // Новое сообщение в чате
            'SYSTEM_ANNOUNCEMENT',      // Объявление от администрации
        ],
    },
    
    // Метаданные, позволяющие сделать уведомление кликабельным
    metadata: {
        // Прямая ссылка на связанный объект, чтобы пользователь мог перейти
        // Например: /courses/courseId/lessons/lessonId
        link: { type: String },
        
        // ID связанной сущности для внутренней логики
        // (Например, чтобы показать иконку группы или аватар пользователя)
        entity: {
            type: { type: String, enum: ['Course', 'Group', 'Assignment', 'User'] },
            id: { type: Schema.Types.ObjectId }
        }
    },
    
    // --- Статус ---
    read: {
        type: Boolean,
        default: false,
    },
    
}, { timestamps: true }); // Используем стандартные timestamps

module.exports = mongoose.model('NotificationV2', NotificationSchema);