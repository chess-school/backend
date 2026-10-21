// v2/routes/coach.routes.js
const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const validate = require('../middleware/validate');
const coachRequestController = require('../controllers/coachRequest.controller');
const CoachRequest = require('../models/CoachRequest');
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const coachController = require('../controllers/coach.controller');
const courseController = require('../controllers/course.controller');
const groupController = require('../controllers/group.controller');

// =================================================================
//                 Публичные роуты (для всех)
// =================================================================

/**
 * @route   GET /api/v2/coaches
 * @desc    Получить список верифицированных тренеров или одного по uuid.
 *          Примеры:
 *          - /api/v2/coaches
 *          - /api/v2/coaches?page=2&limit=5
 *          - /api/v2/coaches?uuid=...
 *          - /api/v2/coaches?q=anna — поиск по имени/фамилии
 */
router.get(
    '/',
    validate([
        query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
        query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1–50'),
        query('q').optional().isString().isLength({ max: 100 }).withMessage('q must be at most 100 characters'),
    ]),
    coachController.getCoaches
);

// =================================================================
//                 Заявки ученик -> тренер
// =================================================================

/**
 * @route   GET /api/v2/coaches/requests/sent
 * @desc    Мои отправленные заявки (статус на карточках тренеров)
 */
router.get('/requests/sent', authMiddleware, coachRequestController.listSentRequests);

/**
 * @route   POST /api/v2/coaches/:coachId/requests
 * @desc    Отправить заявку тренеру: { experience: Beginner|Intermediate|Advanced, goals? }
 */
router.post(
    '/:coachId/requests',
    authMiddleware,
    validate([
        param('coachId').isMongoId().withMessage('coachId must be a valid id'),
        body('experience').isIn(CoachRequest.EXPERIENCE_LEVELS).withMessage(`experience must be one of: ${CoachRequest.EXPERIENCE_LEVELS.join(', ')}`),
        body('goals').optional().isString().withMessage('goals must be a string').bail().trim()
            .isLength({ max: CoachRequest.GOALS_MAX }).withMessage(`goals must be at most ${CoachRequest.GOALS_MAX} characters`),
    ]),
    coachRequestController.createRequest
);


// =================================================================
//                 Приватные роуты для Тренеров
// =================================================================

/**
 * @route   GET /api/v2/coaches/me
 * @desc    Получить свой профиль тренера
 */
router.get(
    '/me',
    authMiddleware,
    roleMiddleware(['COACH']),
    coachController.getMyCoachProfile
);

/**
 * @route   PUT /api/v2/coaches/me
 * @desc    Создать или обновить свой профиль тренера
 */
router.put(
    '/me',
    authMiddleware,
    roleMiddleware(['COACH']),
    coachController.upsertMyCoachProfile
);

/**
 * @route   GET /api/v2/coaches/me/courses
 * @desc    Получить свои курсы (включая черновики)
 */
router.get(
    '/me/courses',
    authMiddleware,
    roleMiddleware(['COACH']),
    courseController.getMyCourses
);

/**
 * @route   GET /api/v2/coaches/me/groups
 * @desc    Получить свои учебные группы с участниками
 */
router.get(
    '/me/groups',
    authMiddleware,
    roleMiddleware(['COACH']),
    groupController.getMyGroups
);

/**
 * @route   GET /api/v2/coaches/me/requests?status=pending
 * @desc    Заявки мне как тренеру (ADMIN — всем тренерам)
 */
router.get(
    '/me/requests',
    authMiddleware,
    roleMiddleware(['COACH', 'ADMIN']),
    validate([query('status').optional().isIn(CoachRequest.REQUEST_STATUSES).withMessage(`status must be one of: ${CoachRequest.REQUEST_STATUSES.join(', ')}`)]),
    coachRequestController.listCoachRequests
);

/**
 * @route   PATCH /api/v2/coaches/me/requests/:requestId
 * @desc    Решение: { status: 'approved', courseId } — записать ученика на свой курс; { status: 'rejected' }
 */
router.patch(
    '/me/requests/:requestId',
    authMiddleware,
    roleMiddleware(['COACH', 'ADMIN']),
    validate([
        param('requestId').isMongoId().withMessage('requestId must be a valid id'),
        body('status').isIn(['approved', 'rejected']).withMessage('status must be approved or rejected'),
        body('courseId')
            .if(body('status').equals('approved'))
            .isMongoId().withMessage('courseId is required to approve: the student is enrolled into this course'),
    ]),
    coachRequestController.decideRequest
);

module.exports = withErrorHandling(router);