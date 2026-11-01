// v2/controllers/course.controller.js

const courseRepo = require('../repositories/course.repo'); // шов content (mongo|pg по CONTENT_DB)
const coachRepo = require('../repositories/coach.repo'); // шов coaching (mongo|pg по COACHING_DB)
const Group = require('../models/Group');
const mongoose = require('mongoose');

const VISIBILITIES = ['draft', 'private', 'group', 'public'];

// =================================================================
//        ДОСТУП ПО ОБЛАСТИ ВИДИМОСТИ (Module 1)
// =================================================================

/**
 * Семантический дескриптор доступа текущего запроса — его шов course.repo превращает в mongo/pg-запрос.
 *  - ADMIN            → видит всё (включая черновики и приватные);
 *  - COACH            → публичные + свои (в любом статусе/архиве) + где он в allowedUsers;
 *  - USER / гость     → публичные + приватные (в allowedUsers) + групповые (его группы).
 * @returns {Promise<{isAdmin:boolean, userId:?string, coachId:?string, groupIds:string[]}>}
 */
async function buildAccess(req) {
    const roles = (req.user && req.user.roles) || [];
    if (roles.includes('ADMIN')) return { isAdmin: true, userId: null, coachId: null, groupIds: [] };

    const userId = req.user && req.user.id ? req.user.id : null;

    // Тренер: + свои курсы (любые) + где он в allowedUsers (групповые НЕ добавляем — как было).
    if (roles.includes('COACH')) {
        const coachProfile = await coachRepo.findByUser(req.user.id);
        return { isAdmin: false, userId, coachId: coachProfile ? String(coachProfile._id) : null, groupIds: [] };
    }

    // Ученик (USER) / гость: + allowedUsers + групповые
    let groupIds = [];
    if (userId) {
        const groups = await Group.find({ members: userId }).select('_id').lean();
        groupIds = groups.map((g) => String(g._id));
    }
    return { isAdmin: false, userId, coachId: null, groupIds };
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

    const coachProfile = await coachRepo.findByUser(req.user.id);
    if (!coachProfile) {
        return res.status(403).json({ msg: 'You must have a coach profile to create courses.' });
    }

    if (visibility !== undefined && !VISIBILITIES.includes(visibility)) {
        return res.status(400).json({ msg: `Invalid visibility. Must be one of: ${VISIBILITIES.join(', ')}.`, code: 'INVALID_VISIBILITY' });
    }

    const course = await courseRepo.create({
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

    res.status(201).json(course);
};


/**
 * @desc    Получение списка курсов, созданных текущим тренером (включая черновики)
 * @route   GET /api/v2/coaches/me/courses
 * @access  Private (role: COACH)
 */
const getMyCourses = async (req, res) => {
    const coachProfile = await coachRepo.findByUser(req.user.id);
    if (!coachProfile) {
        return res.json({ data: [] });
    }

    // Изоляция по клубу (#7): если активный клуб определён — только его курсы
    const courses = await courseRepo.findByAuthor(coachProfile._id, { club: req.club });

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
    const course = await courseRepo.findById(courseId);
    if (!course) {
        return res.status(404).json({ msg: 'Course not found.' });
    }

    const isAdmin = (req.user.roles || []).includes('ADMIN');
    const coachProfile = await coachRepo.findByUser(req.user.id);
    const isAuthor = coachProfile && course.authors.some((a) => String(a) === String(coachProfile._id));
    if (!isAdmin && !isAuthor) {
        return res.status(403).json({ msg: 'Forbidden: You are not an author of this course.' });
    }

    // Обновляем курс данными из запроса
    // runValidators: enum уровня/языка/видимости и минимальная цена проверяются и при обновлении
    const updatedCourse = await courseRepo.updateById(courseId, updateData, { runValidators: true });

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

    const coachProfile = await coachRepo.findByUser(req.user.id);
    if (!coachProfile) {
        return res.status(403).json({ msg: 'You must have a coach profile to manage courses.', code: 'COACH_PROFILE_REQUIRED' });
    }

    const course = await courseRepo.updateStatusByAuthor(courseId, coachProfile._id, status);

    if (!course) {
        return res.status(404).json({ msg: 'Course not found or you do not have permission to change its status.' });
    }

    res.json({ msg: `Course status successfully updated to '${status}'.`, course });
};

// =================================================================
//                     ПУБЛИЧНЫЕ ЭКШЕНЫ ДЛЯ ВСЕХ
// =================================================================

// authors[] (ссылки на Coach) → coach-доки с user-карточкой — app-level джойн через швы
// (замена Mongoose populate('authors'→'user')). payoutInfo НЕ отдаём (как было select '-payoutInfo').
const attachAuthors = async (courses) => {
    const list = (Array.isArray(courses) ? courses : [courses]).filter(Boolean);
    const ids = [...new Set(list.flatMap((c) => (c.authors || []).map(String)))];
    if (!ids.length) { for (const c of list) c.authors = []; return courses; }
    const coaches = await coachRepo.findManyByIds(ids);
    await coachRepo.attachUsers(coaches); // coach.user = карточка {uuid,firstName,lastName,avatarUrl}
    const byId = new Map(coaches.map((c) => { delete c.payoutInfo; delete c.__v; return [String(c._id), c]; }));
    for (const c of list) c.authors = (c.authors || []).map((id) => byId.get(String(id)) || null).filter(Boolean);
    return courses;
};

/**
 * @desc    Получить список курсов (каталог) с учётом области видимости и роли, либо один курс по ?courseId.
 * @route   GET /api/v2/courses
 * @access  Public (optionalAuth: роль влияет на выдачу)
 */
const getPublicCourses = async (req, res) => {
    const { courseId, page = 1, limit = 10, level, tag, language } = req.query;

    if (courseId && !mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ msg: 'Invalid courseId format.' });
    }

    // Доступ по роли/видимости (Module 1) + доп. фильтры + изоляция по клубу (#7).
    const access = await buildAccess(req);
    const filters = { club: req.club, courseId, level, tag, language };
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const coursesFromDB = await courseRepo.findCatalog(access, filters, { skip, limit: parseInt(limit, 10) });
    await attachAuthors(coursesFromDB); // джойн авторов — app-level через швы

    // Если запрашивали один курс по courseId, возвращаем его как объект
    if (courseId) {
        return res.json(coursesFromDB[0] || null);
    }

    // Для списка возвращаем данные с пагинацией
    const totalCourses = await courseRepo.countCatalog(access, filters);

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
    const exists = await courseRepo.existsById(courseId);
    if (!exists) {
        return res.status(404).json({ msg: 'Course not found.', code: 'COURSE_NOT_FOUND' });
    }

    const access = await buildAccess(req);
    const course = await courseRepo.findOneWithAccess(courseId, access);

    if (!course) {
        return res.status(403).json({ msg: 'Forbidden: this course is private.', code: 'COURSE_FORBIDDEN' });
    }

    await attachAuthors(course); // джойн авторов — app-level через швы
    res.json(course);
};


module.exports = {
    createCourse,
    getMyCourses,
    updateCourse,
    updateCourseStatus,
    getPublicCourses,
    getCourseById,
    buildAccess, // экспортируем для переиспользования/тестов
};
