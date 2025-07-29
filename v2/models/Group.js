// models/Group.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const GroupSchema = new Schema({
    // --- Основная информация о группе ---
    name: {
        type: String,
        required: [true, 'Group name is required'],
        trim: true,
    },
    description: {
        type: String,
        trim: true,
    },
    
    // --- Связи с участниками ---
    coach: { // Тренер, который управляет этой группой
        type: Schema.Types.ObjectId,
        ref: 'Coach',
        required: true,
    },
    members: [{ // Список студентов, состоящих в группе
        type: Schema.Types.ObjectId,
        ref: 'TestUser', // Ссылаемся на наших тестовых пользователей
    }],
    
    // --- Статус группы ---
    status: {
        type: String,
        enum: ['active', 'archived'], // Активная группа или архивная
        default: 'active'
    }
    
    // Опциональное поле `courseContext`, которое мы обсуждали, 
    // можно добавить позже, если возникнет необходимость жестко связывать
    // группу с прохождением конкретного курса. 
    // Начнем без него для большей гибкости.

}, { timestamps: true });

// Создаем индекс для быстрого поиска всех групп конкретного тренера
GroupSchema.index({ coach: 1 });

module.exports = mongoose.model('Group', GroupSchema);