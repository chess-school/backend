// models/Course.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Вложенная схема для урока. Делаем ее отдельной для читаемости.
const LessonSchema = new Schema({
    title: { type: String, required: true },
    description: { type: String },
    // Тип контента урока
    contentType: {
        type: String,
        enum: ['video', 'text', 'quiz', 'assignment'], // Урок может быть видео, статьей, тестом или заданием
    },
    // Сам контент
    content: {
        videoUrl: { type: String }, // URL на видео (Vimeo, YouTube и т.д.)
        textBody: { type: String }, // Текст урока
        // Можно добавить ссылки на другие модели
        // quizId: { type: Schema.Types.ObjectId, ref: 'Quiz' }, // Если у вас будет модель тестов
        // assignmentTemplateId: { type: Schema.Types.ObjectId, ref: 'AssignmentTemplate' } // Ссылка на шаблон ДЗ
    },
    durationMinutes: { type: Number } // Приблизительная длительность урока в минутах
});

// Вложенная схема для модуля курса
const ModuleSchema = new Schema({
    title: { type: String, required: true },
    description: { type: String },
    lessons: [LessonSchema], // Модуль состоит из уроков
});

// Основная схема курса
const CourseSchema = new Schema({
    // --- Основная информация о курсе ---
    title: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        required: true,
    },
    thumbnailUrl: { // URL на обложку курса
        type: String,
    },
    
    // --- Авторы и принадлежность ---
    authors: [{ // Ключевое поле для совместного ведения
        type: Schema.Types.ObjectId,
        ref: 'Coach',
    }],
    isSchoolCourse: { // Флаг для курсов, созданных школой, а не конкретным тренером
        type: Boolean,
        default: false,
    },

    // --- Структура и контент курса ---
    modules: [ModuleSchema],

    // --- Коммерческая информация ---
    price: {
        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, required: true, default: 'USD' },
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'], // Статус курса
        default: 'draft',
    },
    
    // --- Категоризация и метаданные ---
    level: { // Уровень сложности
        type: String,
        enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    },
    tags: [String], // Теги для поиска: ['sicilian_defense', 'middlegame', ...]

}, { timestamps: true });


// Индекс для текстового поиска по названию и описанию
CourseSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Course', CourseSchema);