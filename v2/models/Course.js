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
    // Клуб-владелец (мульти-арендность #7). Проставляется при создании из req.club.
    club: { type: Schema.Types.ObjectId, ref: 'Club', index: true },
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
        enum: ['draft', 'published', 'archived'], // Устаревший статус публикации (оставлен для обратной совместимости каталога)
        default: 'draft',
    },

    // --- Область видимости и управление доступом (Module 1) ---
    // draft    — виден только автору и админу (черновик);
    // private  — виден автору/админу и ученикам из allowedUsers;
    // group    — виден автору/админу и ученикам из групп allowedGroups;
    // public   — виден всем (каталог).
    visibility: {
        type: String,
        enum: ['draft', 'private', 'group', 'public'],
        default: 'draft',
    },
    // Индивидуальный доступ ученикам (ref на модель пользователя v2 — зарегистрирована как 'TestUser')
    allowedUsers: [{
        type: Schema.Types.ObjectId,
        ref: 'TestUser',
    }],
    // Доступ целым группам учеников
    allowedGroups: [{
        type: Schema.Types.ObjectId,
        ref: 'Group',
    }],
    // Мягкое архивирование: архивные курсы скрыты из каталога, но доступны автору/админу
    isArchived: {
        type: Boolean,
        default: false,
    },

    // --- Категоризация и метаданные ---
    level: { // Уровень сложности
        type: String,
        enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    },
    tags: [String], // Теги для поиска: ['sicilian_defense', 'middlegame', ...]
    // Язык курса: createCourse и фильтр каталога ?language= уже использовали поле, но его не было в схеме
    language: {
        type: String,
        enum: ['en', 'uk', 'pl'],
        default: 'en',
    },

}, { timestamps: true });

// Курсы тренера (кабинет тренера, проверка авторства при записи студента)
CourseSchema.index({ authors: 1 });
// Фильтрация каталога/доступа по области видимости (Module 1)
CourseSchema.index({ visibility: 1, isArchived: 1 });
CourseSchema.index({ allowedUsers: 1 });
CourseSchema.index({ allowedGroups: 1 });


// Индекс для текстового поиска по названию и описанию
CourseSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Course', CourseSchema);