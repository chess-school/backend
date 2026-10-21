// v2/models/PuzzleBook.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Одно упражнение задачника: стартовая позиция + эталонное решение в виде PGN-movetext
const ExerciseSchema = new Schema({
    number: { type: Number },               // номер задания в книге («Задание 870»)
    title: { type: String, required: true, trim: true },
    fen: { type: String, required: true, trim: true },
    comment: { type: String, default: '' }, // условие / комментарий к позиции
    hint: { type: String, default: '' },
    // Ходы решения с вариантами, NAG и {комментариями}, начиная от fen: «14. Bf5 $1 (14. Bb5) 14... g6 ...»
    solution: { type: String, default: '' },
    chapter: { type: String },              // PGN-глава оцифровщика, из которой взято упражнение
    meta: {
        white: String,
        black: String,
        site: String,
        year: String,
        opening: String,
        source: String,                     // «book.pdf, p. 39»
    },
});

// Задачник, созданный из оцифрованной PDF-книги
const PuzzleBookSchema = new Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },
    status: {
        type: String,
        enum: ['draft', 'published'],       // ученики видят только опубликованные
        default: 'draft',
    },
    source: {
        // Задача оцифровщика, из которой создан задачник: не больше одного задачника на задачу
        taskId: { type: String, index: { unique: true, sparse: true } },
        importedChapters: { type: [String], default: [] }, // главы, уже добавленные в задачник
    },
    exercises: [ExerciseSchema],
}, { timestamps: true });

module.exports = mongoose.model('PuzzleBook', PuzzleBookSchema);
