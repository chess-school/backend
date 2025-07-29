// v2/routes/enrollment.routes.js
const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const enrollmentController = require('../controllers/enrollment.controller');

// =================================================================
//            Эндпоинт для студента: ЗАПИСАТЬСЯ НА КУРС
// =================================================================

/**
 * @route   POST /api/v2/courses/:courseId/enroll
 * @desc    Записаться на курс (создать контракт)
 * @access  Private
 */
router.post(
    '/courses/:courseId/enroll',
    authMiddleware,
    enrollmentController.enrollInCourse
);

// =================================================================
//        Эндпоинты для студента: ПРОСМОТР СВОИХ КУРСОВ
// =================================================================
/**
 * @route   GET /api/v2/my-training/contracts
 * @desc    Получить список курсов, на которые я записан
 * @access  Private
 */
router.get(
    '/my-training/contracts',
    authMiddleware,
    enrollmentController.getMyContracts
);

// =================================================================
//          Эндпоинты для тренера: ПРОСМОТР СВОИХ СТУДЕНТОВ
// =================================================================

/**
 * @route   GET /api/v2/coaches/me/students
 * @desc    Получить список всех студентов тренера (по контрактам)
 * @access  Private (role: COACH)
 */
router.get(
    '/coaches/me/students',
    authMiddleware,
    roleMiddleware(['COACH']),
    enrollmentController.getMyStudents
);


module.exports = withErrorHandling(router);