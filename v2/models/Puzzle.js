// models/Puzzle.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PuzzleSchema = new Schema({
    // --- ОСНОВНАЯ ИНФОРМАЦИЯ О ЗАДАЧЕ ---
    fen: { // Начальная позиция задачи в FEN. Это важнее, чем PGN.
        type: String,
        required: true,
    },
    solution: { // Последовательность ходов решения в SAN
        type: [String],
        required: true,
    },
    
    // --- МЕТАДАННЫЕ ДЛЯ КАТАЛОГИЗАЦИИ И ПОИСКА ---
    rating: { // Уровень сложности задачи (в стиле Lichess/Chess.com)
        type: Number,
        default: 1500
    },
    themes: { // Тактические темы задачи
        type: [String],
        // ['fork', 'pin', 'skewer', 'discovered_attack', 'mating_net']
        default: [],
        index: true, // Индексируем для быстрого поиска по темам
    },
    pgn: { // Полный PGN партии, из которой взята задача (опционально)
        type: String,
    },
    
    // --- ИСТОЧНИК И АВТОРСТВО ---
    source: { // Откуда взята задача (напр., "Партия Карпов-Каспаров, 1985")
        type: String,
    },
    createdBy: { // Пользователь (админ или тренер), который добавил задачу
        type: Schema.Types.ObjectId,
        ref: 'TestUser',
        required: true,
    },
}, { timestamps: true });


// Отдельная модель для коллекций пазлов. Ваша была идеальной.
const PuzzleCollectionSchema = new Schema({
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },
    puzzles: [{ // Массив ссылок на задачи
        type: Schema.Types.ObjectId,
        ref: 'Puzzle',
    }],
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'TestUser', // Может быть создан как тренером, так и админом
        required: true,
    },
}, { timestamps: true });

module.exports = {
    Puzzle: mongoose.model('Puzzle', PuzzleSchema),
    PuzzleCollection: mongoose.model('PuzzleCollection', PuzzleCollectionSchema),
};