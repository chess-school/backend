const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 1. ВАША СХЕМА (она была правильной)
const PuzzleSchema = new Schema({
    _id: {
        type: String,
        required: true,
    },
    fen: {
        type: String,
        required: true,
    },
    moves: {
        type: [String],
        required: true,
    },
    rating: {
        type: Number,
        required: true,
        index: true,
    },
    themes: {
        type: [String],
        default: [],
        index: true,
    },
    popularity: {
        type: Number,
    },
    nbPlays: {
        type: Number,
    },
}, {
    _id: false,
    versionKey: false
});

// 2. СОЗДАНИЕ МОДЕЛИ (ЭТА СТРОКА, СКОРЕЕ ВСЕГО, ОТСУТСТВОВАЛА)
// Mongoose берет название 'Puzzle', делает его 'puzzles' и ищет такую коллекцию в БД.
const Puzzle = mongoose.model('Puzzle', PuzzleSchema);

// 3. ЭКСПОРТ ГОТОВОЙ МОДЕЛИ (ЭТА СТРОКА ТОЖЕ МОГЛА БЫТЬ НЕВЕРНОЙ)
// Мы экспортируем саму модель, а не схему.
module.exports = Puzzle;