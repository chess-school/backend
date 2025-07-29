// models/SavedGame.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Вспомогательная схема для комментариев или вариаций к ходу
const AnnotationSchema = new Schema({
    // ID хода в PGN или номер хода
    moveIdentifier: { type: String, required: true }, 
    comment: { type: String },
    // Стрелки и выделенные поля для визуализации на доске
    arrows: [{ from: String, to: String, color: String }],
    squares: [{ square: String, color: String }],
    // Автор аннотации
    author: { type: Schema.Types.ObjectId, ref: 'TestUser' }
}, { _id: false });

const SavedGameSchema = new Schema({
    // --- ОСНОВНОЙ КОНТЕНТ ---
    pgn: { // Полный PGN партии - это основа
        type: String,
        required: true,
    },
    title: {
        type: String,
        trim: true,
        default: 'Анализ партии'
    },
    description: {
        type: String,
        trim: true,
    },
    
    // --- АННОТАЦИИ И КОММЕНТАРИИ ---
    annotations: [AnnotationSchema],

    // --- КОНТЕКСТ И ДОСТУП ---
    // Кто имеет доступ к этому анализу?
    // Заменяем жесткую связь student+coach
    context: {
        type: {
            type: String,
            required: true,
            enum: ['personal_training', 'group_study'],
        },
        refId: {
            type: Schema.Types.ObjectId,
            required: true,
            // Ссылка на TrainingContract (для персонального анализа)
            // или на Group (для группового разбора)
        }
    },
    // Кто последний редактировал/добавил
    lastUpdatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'TestUser',
    }

}, { timestamps: true });

module.exports = mongoose.model('SavedGame', SavedGameSchema);