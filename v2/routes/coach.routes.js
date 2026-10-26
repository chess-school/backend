// v2/routes/coach.routes.js
const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const validate = require('../middleware/validate');
const coachRequestController = require('../controllers/coachRequest.controller');
const coachApplicationController = require('../controllers/coachApplication.controller');
const CoachRequest = require('../models/CoachRequest');
const CoachApplication = require('../models/CoachApplication');
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
    require('../middleware/optionalAuthV2.middleware'),
    require('../middleware/resolveClubV2.middleware'),
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
    require('../middleware/resolveClubV2.middleware'),
    validate([
        param('coachId').isMongoId().withMessage('coachId must be a valid id'),
        body('experience').isIn(CoachRequest.EXPERIENCE_LEVELS).withMessage(`experience must be one of: ${CoachRequest.EXPERIENCE_LEVELS.join(', ')}`),
        body('goals').optional().isString().withMessage('goals must be a string').bail().trim()
            .isLength({ max: CoachRequest.GOALS_MAX }).withMessage(`goals must be at most ${CoachRequest.GOALS_MAX} characters`),
    ]),
    coachRequestController.createRequest
);


// =================================================================
//          Заявки на роль тренера (кандидат -> админ)
// =================================================================

/**
 * @route   GET /api/v2/coaches/applications/me
 * @desc    Моя последняя заявка на роль тренера (статус на странице «Тренеры»)
 */
router.get('/applications/me', authMiddleware, coachApplicationController.getMine);

/**
 * @route   POST /api/v2/coaches/applications
 * @desc    Подать заявку на роль тренера: { motivation, headline?, experience?, specializations?, contact?, fideProfile?, sourceLang? }
 */
router.post(
    '/applications',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    validate([
        body('motivation').isString().withMessage('motivation must be a string').bail().trim()
            .isLength({ min: 1, max: CoachApplication.MOTIVATION_MAX }).withMessage(`motivation must be 1–${CoachApplication.MOTIVATION_MAX} characters`),
        body('headline').optional().isString().trim().isLength({ max: 200 }).withMessage('headline must be at most 200 characters'),
        body('experience').optional().isString().trim().isLength({ max: CoachApplication.EXPERIENCE_MAX }).withMessage(`experience must be at most ${CoachApplication.EXPERIENCE_MAX} characters`),
        body('specializations').optional().isArray().withMessage('specializations must be an array'),
        body('contact').optional().isString().trim().isLength({ max: 200 }).withMessage('contact must be at most 200 characters'),
        body('fideProfile.title').optional().isIn(CoachApplication.FIDE_TITLES).withMessage(`title must be one of: ${CoachApplication.FIDE_TITLES.join(', ')}`),
        body('fideProfile.profileUrl').optional({ values: 'falsy' }).isURL().withMessage('profileUrl must be a valid URL'),
    ]),
    coachApplicationController.submit
);

/**
 * @route   GET /api/v2/coaches/applications?status=pending
 * @desc    Все заявки на роль тренера (ADMIN)
 */
router.get(
    '/applications',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    roleMiddleware(['ADMIN']),
    validate([query('status').optional().isIn(CoachApplication.APPLICATION_STATUSES).withMessage(`status must be one of: ${CoachApplication.APPLICATION_STATUSES.join(', ')}`)]),
    coachApplicationController.list
);

/**
 * @route   PATCH /api/v2/coaches/applications/:applicationId
 * @desc    Решение админа: { status: 'approved'|'rejected', adminNote? }
 */
router.patch(
    '/applications/:applicationId',
    authMiddleware,
    roleMiddleware(['ADMIN']),
    validate([
        param('applicationId').isMongoId().withMessage('applicationId must be a valid id'),
        body('status').isIn(['approved', 'rejected']).withMessage('status must be approved or rejected'),
        body('adminNote').optional().isString().trim().isLength({ max: 2000 }).withMessage('adminNote must be at most 2000 characters'),
    ]),
    coachApplicationController.decide
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
    roleMiddleware(['COACH', 'ADMIN']),
    coachController.getMyCoachProfile
);

/**
 * @route   PUT /api/v2/coaches/me
 * @desc    Создать или обновить свой профиль тренера
 */
router.put(
    '/me',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    roleMiddleware(['COACH', 'ADMIN']),
    coachController.upsertMyCoachProfile
);

/**
 * @route   PATCH /api/v2/coaches/me/verify
 * @desc    Админ верифицирует свой собственный профиль тренера (самоподтверждение)
 * @access  Private (role: ADMIN)
 */
router.patch(
    '/me/verify',
    authMiddleware,
    roleMiddleware(['ADMIN']),
    coachController.verifyMyCoachProfile
);

/**
 * @route   GET /api/v2/coaches/me/courses
 * @desc    Получить свои курсы (включая черновики)
 */
router.get(
    '/me/courses',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    roleMiddleware(['COACH', 'ADMIN']),
    courseController.getMyCourses
);

/**
 * @route   GET /api/v2/coaches/me/groups
 * @desc    Получить свои учебные группы с участниками
 */
router.get(
    '/me/groups',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    roleMiddleware(['COACH', 'ADMIN']),
    groupController.getMyGroups
);

/**
 * @route   GET /api/v2/coaches/me/requests?status=pending
 * @desc    Заявки мне как тренеру (ADMIN — всем тренерам)
 */
router.get(
    '/me/requests',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
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
        // courseId необязателен: без него ученик записывается на персональный курс тренера
        // (создаётся автоматически при первом одобрении) — см. coachRequest.service.decideRequest
        body('courseId')
            .optional({ values: 'falsy' })
            .isMongoId().withMessage('courseId must be a valid id'),
    ]),
    coachRequestController.decideRequest
);

module.exports = withErrorHandling(router);