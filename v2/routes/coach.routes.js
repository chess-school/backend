// v2/routes/coach.routes.js
const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const coachController = require('../controllers/coach.controller');

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
 */
router.get(
    '/', 
    coachController.getCoaches
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

module.exports = withErrorHandling(router);