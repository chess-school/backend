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
    // Динамический рейтинг задачи (Elo, Module 4): растёт, если её не решают, падает — если решают
    rating: { type: Number, default: 1500 },
    ratingAttempts: { type: Number, default: 0 },
    meta: {
        white: String,
        black: String,
        site: String,
        year: String,
        opening: String,
        source: String,                     // «book.pdf, p. 39»
    },
});

// Настройки режима решения задачника — тренер задаёт их при создании/редактировании.
// Пустой объект => применяются дефолты (строгий режим: без читов, подсказка с замком).
const SolveSettingsSchema = new Schema({
    hintsEnabled: { type: Boolean, default: true },          // доступны ли подсказки ученику
    hintUnlockMinutes: { type: Number, default: 10, min: 0, max: 180 },  // через сколько минут открыть подсказку
    hintUnlockMistakes: { type: Number, default: 5, min: 0, max: 50 },   // после скольких ошибок открыть подсказку
    allowShowSolution: { type: Boolean, default: false },    // можно ли «сдаться» и посмотреть решение
    showPlayerNames: { type: Boolean, default: true },       // показывать имена игроков у доски
}, { _id: false });

// Задачник, созданный из оцифрованной PDF-книги
const PuzzleBookSchema = new Schema({
    // Клуб-владелец (мульти-арендность #7). Проставляется при создании из req.club.
    club: { type: Schema.Types.ObjectId, ref: 'Club', index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },
    solveSettings: { type: SolveSettingsSchema, default: () => ({}) },
    status: {
        type: String,
        enum: ['draft', 'published'],       // устаревший флаг публикации (обратная совместимость каталога)
        default: 'draft',
    },

    // --- Область видимости и доступ (Module 1, по аналогии с Course) ---
    // draft — только staff; private — allowedUsers; group — allowedGroups; public — все.
    // Пустое значение трактуется по старому правилу (status === 'published' => видно ученикам).
    visibility: {
        type: String,
        enum: ['draft', 'private', 'group', 'public'],
        default: 'draft',
    },
    allowedUsers: [{ type: Schema.Types.ObjectId, ref: 'TestUser' }],
    allowedGroups: [{ type: Schema.Types.ObjectId, ref: 'Group' }],
    isArchived: { type: Boolean, default: false },
    source: {
        // Задача оцифровщика, из которой создан задачник: не больше одного задачника на задачу
        taskId: { type: String, index: { unique: true, sparse: true } },
        importedChapters: { type: [String], default: [] }, // главы, уже добавленные в задачник
    },
    exercises: [ExerciseSchema],
}, { timestamps: true });

module.exports = mongoose.model('PuzzleBook', PuzzleBookSchema);
