// v2/controllers/course.controller.js

const Course = require('../models/Course');
const Coach = require('../models/Coach');
const Group = require('../models/Group');
const mongoose = require('mongoose');

const VISIBILITIES = ['draft', 'private', 'group', 'public'];

// =================================================================
//        ФИЛЬТР ДОСТУПА ПО ОБЛАСТИ ВИДИМОСТИ (Module 1)
// =================================================================

/**
 * Строит mongo-фильтр, ограничивающий выборку курсов тем, что доступно текущему запросу.
 *  - ADMIN            → {} (видит всё, включая черновики и приватные);
 *  - COACH            → публичные + свои (в любом статусе/архиве) + где он в allowedUsers;
 *  - USER / гость     → публичные + приватные (в allowedUsers) + групповые (его группы).
 * Легаси-курсы без поля visibility считаются публичными, если status === 'published'.
 * @returns {Promise<object>} фрагмент фильтра (возможно с $or); {} означает «без ограничений».
 */
async function buildVisibilityFilter(req) {
    const roles = (req.user && req.user.roles) || [];

    // Админ видит абсолютно всё
    if (roles.includes('ADMIN')) return {};

    const userId = req.user && req.user.id ? new mongoose.Types.ObjectId(req.user.id) : null;
    const notArchived = { isArchived: { $ne: true } };

    // Легаси-совместимость: старые курсы без visibility, но опубликованные по status
    const legacyPublic = { visibility: { $exists: false }, status: 'published', ...notArchived };

    const or = [
        { visibility: 'public', ...notArchived },
        legacyPublic,
    ];

    // Тренер: плюс свои курсы (любые) и курсы, куда его добавили персонально
    if (roles.includes('COACH')) {
        const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id').lean();
        if (coachProfile) or.push({ authors: coachProfile._id }); // свои — в любом статусе/видимости, включая архив
        if (userId) or.push({ allowedUsers: userId, visibility: { $ne: 'draft' }, ...notArchived });
        return { $or: or };
    }

    // Ученик (USER) / гость
    if (userId) {
        or.push({ allowedUsers: userId, visibility: { $ne: 'draft' }, ...notArchived });
        const groups = await Group.find({ members: userId }).select('_id').lean();
        const groupIds = groups.map((g) => g._id);
        if (groupIds.length) {
            or.push({ allowedGroups: { $in: groupIds }, visibility: { $ne: 'draft' }, ...notArchived });
        }
    }

    return { $or: or };
}

// =================================================================
//                 ПРИВАТНЫЕ ЭКШЕНЫ ДЛЯ ТРЕНЕРОВ
// =================================================================

/**
 * @desc    Создание нового курса (в статусе 'draft')
 * @route   POST /api/v2/courses
 * @access  Private (role: COACH)
 */
const createCourse = async (req, res) => {
    const { title, description, price, level, tags, modules, language,
        visibility, allowedUsers, allowedGroups } = req.body;

    const coachProfile = await Coach.findOne({ user: req.user.id });
    if (!coachProfile) {
        return res.status(403).json({ msg: 'You must have a coach profile to create courses.' });
    }

    if (visibility !== undefined && !VISIBILITIES.includes(visibility)) {
        return res.status(400).json({ msg: `Invalid visibility. Must be one of: ${VISIBILITIES.join(', ')}.`, code: 'INVALID_VISIBILITY' });
    }

    const course = new Course({
        title,
        description,
        price,
        level,
        tags,
        modules,
        language: language || 'en',
        visibility: visibility || 'draft',
        allowedUsers: Array.isArray(allowedUsers) ? allowedUsers : [],
        allowedGroups: Array.isArray(allowedGroups) ? allowedGroups : [],
        authors: [coachProfile._id],
        ...(req.club ? { club: req.club } : {}),
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

    // Изоляция по клубу (#7): если активный клуб определён — только его курсы
    const courses = await Course.find({ authors: coachProfile._id, ...(req.club ? { club: req.club } : {}) })
                                .sort({ createdAt: -1 });

    res.json({ data: courses });
};


/**
 * @desc    Обновление существующего курса по его _id
 * @route   PUT /api/v2/courses/:courseId
 * @access  Private (role: COACH)
 */
// Поля, которые автор может менять через PUT. authors и status сюда не входят:
// соавторы не должны исчезать из-за PUT, а статус меняется через PATCH /:courseId/status.
// visibility/allowedUsers/allowedGroups/isArchived — управление доступом (Module 1).
const UPDATABLE_COURSE_FIELDS = ['title', 'description', 'thumbnailUrl', 'modules', 'price', 'level', 'tags', 'language', 'isSchoolCourse',
    'visibility', 'allowedUsers', 'allowedGroups', 'isArchived'];

const updateCourse = async (req, res) => {
    const { courseId } = req.params;
    const updateData = {};
    for (const field of UPDATABLE_COURSE_FIELDS) {
        if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }
    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ msg: `Nothing to update. Allowed fields: ${UPDATABLE_COURSE_FIELDS.join(', ')}`, code: 'EMPTY_UPDATE' });
    }

    if (updateData.visibility !== undefined && !VISIBILITIES.includes(updateData.visibility)) {
        return res.status(400).json({ msg: `Invalid visibility. Must be one of: ${VISIBILITIES.join(', ')}.`, code: 'INVALID_VISIBILITY' });
    }

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ msg: 'Invalid course ID format' });
    }

    // Находим курс и проверяем, является ли текущий пользователь его автором
    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).json({ msg: 'Course not found.' });
    }

    const isAdmin = (req.user.roles || []).includes('ADMIN');
    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');
    const isAuthor = coachProfile && course.authors.some((a) => String(a) === String(coachProfile._id));
    if (!isAdmin && !isAuthor) {
        return res.status(403).json({ msg: 'Forbidden: You are not an author of this course.' });
    }

    // Обновляем курс данными из запроса
    // runValidators: enum уровня/языка/видимости и минимальная цена проверяются и при обновлении
    const updatedCourse = await Course.findByIdAndUpdate(courseId, { $set: updateData }, { new: true, runValidators: true });

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
    if (!coachProfile) {
        return res.status(403).json({ msg: 'You must have a coach profile to manage courses.', code: 'COACH_PROFILE_REQUIRED' });
    }

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

const AUTHOR_POPULATE = {
    path: 'authors',
    select: '-payoutInfo -__v -user', // Убираем ненужные поля
    populate: {
        path: 'user',
        select: 'uuid firstName lastName avatarUrl' // Данные автора курса
    }
};

/**
 * @desc    Получить список курсов (каталог) с учётом области видимости и роли, либо один курс по ?courseId.
 * @route   GET /api/v2/courses
 * @access  Public (optionalAuth: роль влияет на выдачу)
 */
const getPublicCourses = async (req, res) => {
    const { courseId, page = 1, limit = 10, level, tag, language } = req.query;

    // Базовый фильтр доступа по роли/видимости (Module 1)
    const query = await buildVisibilityFilter(req);

    // Изоляция по клубу (#7): каталог ограничиваем клубом ТОЛЬКО если активный клуб определён
    if (req.club) query.club = req.club;

    if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) return res.status(400).json({ msg: 'Invalid courseId format.' });
        query._id = courseId;
    }
    if (level) query.level = level;
    if (tag) query.tags = tag; // Ищет курсы, у которых есть указанный тег в массиве
    if (language) query.language = language;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const coursesFromDB = await Course.find(query)
        .populate(AUTHOR_POPULATE)
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


/**
 * @desc    Получить один курс по :courseId с проверкой доступа.
 *          Приватные/черновые курсы для неавторизованных/посторонних → 403 Forbidden.
 * @route   GET /api/v2/courses/:courseId
 * @access  Public (optionalAuth)
 */
const getCourseById = async (req, res) => {
    const { courseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ msg: 'Invalid course ID format' });
    }

    // Отличаем 404 (нет такого курса) от 403 (есть, но доступ запрещён)
    const exists = await Course.exists({ _id: courseId });
    if (!exists) {
        return res.status(404).json({ msg: 'Course not found.', code: 'COURSE_NOT_FOUND' });
    }

    const accessFilter = await buildVisibilityFilter(req);
    const course = await Course.findOne({ _id: courseId, ...accessFilter })
        .populate(AUTHOR_POPULATE)
        .select('-__v');

    if (!course) {
        return res.status(403).json({ msg: 'Forbidden: this course is private.', code: 'COURSE_FORBIDDEN' });
    }

    res.json(course);
};


module.exports = {
    createCourse,
    getMyCourses,
    updateCourse,
    updateCourseStatus,
    getPublicCourses,
    getCourseById,
    buildVisibilityFilter, // экспортируем для переиспользования/тестов
};
