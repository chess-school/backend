const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const optionalAuthMiddleware = require('../middleware/optionalAuthV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const courseController = require('../controllers/course.controller');
const courseProgressController = require('../controllers/courseProgress.controller');

// =================================================================
//                         ПУБЛИЧНЫЕ РОУТЫ
// =================================================================

/**
 * @route   GET /api/v2/courses
 * @desc    Получить список курсов или один курс по ID.
 *          Примеры: /courses?level=beginner, /courses?courseId=...
 *          optionalAuth: выдача зависит от роли (админ/тренер/ученик/гость).
 */
router.get('/', optionalAuthMiddleware, require('../middleware/resolveClubV2.middleware'), courseController.getPublicCourses);

/**
 * @route   GET /api/v2/courses/enrolled
 * @desc    Курсы, на которые зачислен текущий ученик (раздел «My courses»). ДО /:courseId.
 */
router.get('/enrolled', authMiddleware, courseController.getEnrolledCourses);

/**
 * @route   GET /api/v2/courses/:courseId
 * @desc    Получить один курс. Приватные/черновые курсы для посторонних → 403.
 *          optionalAuth: роль влияет на доступ.
 */
router.get('/:courseId', optionalAuthMiddleware, courseController.getCourseById);


// =================================================================
//          ПРОГРЕСС УЧЕНИКА ПО КУРСУ (Фаза A5)
// =================================================================

/** @route GET /api/v2/courses/:courseId/progress — свой прогресс (пройденные блоки). */
router.get('/:courseId/progress', authMiddleware, courseProgressController.getMyProgress);

/** @route POST /api/v2/courses/:courseId/progress {blockId,chapterId?} — отметить блок пройденным. */
router.post('/:courseId/progress', authMiddleware, courseProgressController.markProgress);

/** @route GET /api/v2/courses/:courseId/progress/summary — сводка по ученикам (COACH/ADMIN). */
router.get(
    '/:courseId/progress/summary',
    authMiddleware,
    roleMiddleware(['COACH', 'ADMIN']),
    courseProgressController.getProgressSummary
);


// =================================================================
//          ПРИВАТНЫЕ РОУТЫ ДЛЯ УПРАВЛЕНИЯ КУРСАМИ
// =================================================================

// Список своих курсов: GET /api/v2/coaches/me/courses — объявлен в coach.routes.js
// (здесь он оказывался по адресу /api/v2/courses/coaches/me/courses).

/**
 * @route   POST /api/v2/courses
 * @desc    Создать новый курс
 */
router.post(
    '/',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    roleMiddleware(['COACH', 'ADMIN']),
    courseController.createCourse
);

/**
 * @route   PUT /api/v2/courses/:courseId
 * @desc    Обновить свой курс
 */
router.put(
    '/:courseId',
    authMiddleware,
    roleMiddleware(['COACH', 'ADMIN']),
    courseController.updateCourse
);

/**
 * @route   PATCH /api/v2/courses/:courseId/status
 * @desc    Изменить статус курса (опубликовать/архивировать)
 */
router.patch(
    '/:courseId/status',
    authMiddleware,
    roleMiddleware(['COACH', 'ADMIN']),
    courseController.updateCourseStatus
);

module.exports = withErrorHandling(router);