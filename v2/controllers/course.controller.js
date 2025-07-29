// v2/controllers/course.controller.js

const Course = require('../models/Course');
const Coach = require('../models/Coach');
const mongoose = require('mongoose');

// =================================================================
//                 ПРИВАТНЫЕ ЭКШЕНЫ ДЛЯ ТРЕНЕРОВ
// =================================================================

/**
 * @desc    Создание нового курса (в статусе 'draft')
 * @route   POST /api/v2/courses
 * @access  Private (role: COACH)
 */
const createCourse = async (req, res) => {
    const { title, description, price, level, tags, modules, language } = req.body;
    
    const coachProfile = await Coach.findOne({ user: req.user.id });
    if (!coachProfile) {
        return res.status(403).json({ msg: 'You must have a coach profile to create courses.' });
    }

    const course = new Course({
        title,
        description,
        price,
        level,
        tags,
        modules,
        language: language || 'en',
        authors: [coachProfile._id]
    });

    await course.save();
    res.status(201).json(course);
};


/**
 * @desc    Получение списка курсов, созданных текущим тренером (включая черновики)
 * @route   GET /api/v2/coaches/me/courses
 * @access  Private (role: COACH)
 */
const getMyCourses = async (req, res) => {
    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');
    if (!coachProfile) {
        return res.json({ data: [] }); 
    }
    
    const courses = await Course.find({ authors: coachProfile._id })
                                .sort({ createdAt: -1 });
    
    res.json({ data: courses });
};


/**
 * @desc    Обновление существующего курса по его _id
 * @route   PUT /api/v2/courses/:courseId
 * @access  Private (role: COACH)
 */
const updateCourse = async (req, res) => {
    const { courseId } = req.params;
    const updateData = req.body; // Получаем все поля для обновления

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ msg: 'Invalid course ID format' });
    }
    
    // Находим курс и проверяем, является ли текущий пользователь его автором
    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).json({ msg: 'Course not found.' });
    }

    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');
    if (!course.authors.includes(coachProfile._id)) {
        return res.status(403).json({ msg: 'Forbidden: You are not an author of this course.' });
    }

    // Обновляем курс данными из запроса
    const updatedCourse = await Course.findByIdAndUpdate(courseId, { $set: updateData }, { new: true });

    res.json(updatedCourse);
};


/**
 * @desc    Изменение статуса курса (например, 'draft' -> 'published')
 * @route   PATCH /api/v2/courses/:courseId/status
 * @access  Private (role: COACH)
 */
const updateCourseStatus = async (req, res) => {
    const { courseId } = req.params;
    const { status } = req.body;

    if (!['draft', 'published', 'archived'].includes(status)) {
        return res.status(400).json({ msg: "Invalid status. Must be one of 'draft', 'published', 'archived'." });
    }

    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');

    const course = await Course.findOneAndUpdate(
        { _id: courseId, authors: coachProfile._id },
        { status },
        { new: true }
    );

    if (!course) {
        return res.status(404).json({ msg: 'Course not found or you do not have permission to change its status.' });
    }
    
    res.json({ msg: `Course status successfully updated to '${status}'.`, course });
};

// =================================================================
//                     ПУБЛИЧНЫЕ ЭКШЕНЫ ДЛЯ ВСЕХ
// =================================================================

/**
 * @desc    Получить публичный список курсов (каталог) или один курс по _id.
 * @route   GET /api/v2/courses
 * @access  Public
 */
const getPublicCourses = async (req, res) => {
    // Используем `courseId` для получения одного курса
    const { courseId, page = 1, limit = 10, level, tag, language } = req.query;

    const query = { status: 'published' }; // Основной фильтр: только опубликованные курсы
    
    // Динамически строим фильтры
    if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) return res.status(400).json({ msg: 'Invalid courseId format.' });
        query._id = courseId;
    }
    if (level) query.level = level;
    if (tag) query.tags = tag; // Ищет курсы, у которых есть указанный тег в массиве
    if (language) query.language = language;
    
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    
    const coursesFromDB = await Course.find(query)
        .populate({
            path: 'authors',
            select: '-payoutInfo -__v -user', // Убираем ненужные поля
            populate: {
                path: 'user',
                select: 'uuid firstName lastName avatarUrl' // Данные автора курса
            }
        })
        .select('-__v')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10));

    // Если запрашивали один курс по courseId, возвращаем его как объект
    if (courseId) {
        return res.json(coursesFromDB[0] || null);
    }
    
    // Для списка возвращаем данные с пагинацией
    const totalCourses = await Course.countDocuments(query);
    
    res.json({
        data: coursesFromDB,
        pagination: {
            currentPage: parseInt(page, 10),
            totalPages: Math.ceil(totalCourses / parseInt(limit, 10)),
            totalCourses
        }
    });
};


module.exports = {
    createCourse,
    getMyCourses,
    updateCourse,
    updateCourseStatus,
    getPublicCourses
};