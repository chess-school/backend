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
    // Откуда задача. У задач из базы Lichess поля нет: их moves[0] — ход соперника, дальше решает игрок.
    // У задач из оцифрованных книг (kind: 'book') подготовительного хода нет — moves[0] уже ход игрока.
    source: {
        kind: { type: String, enum: ['book'] },
        book: { type: Schema.Types.ObjectId, ref: 'PuzzleBook' },
        bookTitle: String,
        exercise: { type: Schema.Types.ObjectId }, // PuzzleBook.exercises._id
        exerciseNumber: Number,                    // номер задания в книге
        title: String,                             // «Exercise 130»
        sideToMove: { type: String, enum: ['w', 'b'] },
        solutionSan: [String],                     // эталонная главная линия в SAN — для показа
        published: { type: Boolean, default: false }, // ученикам видны только задачи опубликованных книг
    },
}, {
    _id: false,
    versionKey: false
});

// Поток задач по источнику: «из книг» (только опубликованные) и задачи конкретной книги
PuzzleSchema.index({ 'source.kind': 1, 'source.published': 1, rating: 1 });
PuzzleSchema.index({ 'source.book': 1 });

// 2. СОЗДАНИЕ МОДЕЛИ (ЭТА СТРОКА, СКОРЕЕ ВСЕГО, ОТСУТСТВОВАЛА)
// Mongoose берет название 'Puzzle', делает его 'puzzles' и ищет такую коллекцию в БД.
const Puzzle = mongoose.model('Puzzle', PuzzleSchema);

// 3. ЭКСПОРТ ГОТОВОЙ МОДЕЛИ (ЭТА СТРОКА ТОЖЕ МОГЛА БЫТЬ НЕВЕРНОЙ)
// Мы экспортируем саму модель, а не схему.
module.exports = Puzzle;