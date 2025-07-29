const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const courseController = require('../controllers/course.controller');

// =================================================================
//                         ПУБЛИЧНЫЕ РОУТЫ
// =================================================================

/**
 * @route   GET /api/v2/courses
 * @desc    Получить список курсов или один курс по ID.
 *          Примеры: /courses?level=beginner, /courses?courseId=...
 */
router.get('/', courseController.getPublicCourses);


// =================================================================
//          ПРИВАТНЫЕ РОУТЫ ДЛЯ УПРАВЛЕНИЯ КУРСАМИ
// =================================================================

/**
 * @route   GET /api/v2/coaches/me/courses
 * @desc    Получить список курсов ТЕКУЩЕГО тренера
 */
router.get(
    '/coaches/me/courses',
    authMiddleware,
    roleMiddleware(['COACH']),
    courseController.getMyCourses
);

/**
 * @route   POST /api/v2/courses
 * @desc    Создать новый курс
 */
router.post(
    '/',
    authMiddleware,
    roleMiddleware(['COACH']),
    courseController.createCourse
);

/**
 * @route   PUT /api/v2/courses/:courseId
 * @desc    Обновить свой курс
 */
router.put(
    '/:courseId',
    authMiddleware,
    roleMiddleware(['COACH']),
    courseController.updateCourse
);

/**
 * @route   PATCH /api/v2/courses/:courseId/status
 * @desc    Изменить статус курса (опубликовать/архивировать)
 */
router.patch(
    '/:courseId/status',
    authMiddleware,
    roleMiddleware(['COACH']),
    courseController.updateCourseStatus
);

module.exports = withErrorHandling(router);