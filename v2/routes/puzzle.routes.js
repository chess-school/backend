// v2/routes/puzzles.routes.js

const express = require('express');
const router = express.Router();

// Подключаем ваши утилиты и middleware
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const validate = require('../middleware/validate');
const { query } = require('express-validator');

// Подключаем наш новый контроллер
const puzzleController = require('../controllers/puzzle.controller');

// Применяем middleware аутентификации для всех роутов с пазлами.
// Предполагается, что решать задачи могут только залогиненные пользователи.
router.use(authMiddleware);

// =================================================================
//                      РОУТЫ ДЛЯ РЕСУРСА "PUZZLE"
// =================================================================

/**
 * @route   GET /api/v2/puzzles/random
 * @desc    Случайная задача. Все query-параметры необязательны:
 *          minRating, maxRating, source (lichess — по умолчанию | book | all), bookId, exclude (id прошлой задачи), theme
 *          Рейтинговое окно действует только на задачи Lichess.
 * @access  Private (для всех аутентифицированных пользователей)
 */
router.get(
    '/random',
    // validateRequest('minRating', ...) на деле требовал обязательный minRating (он проверяет
    // только наличие полей) — без рейтинга запрос получал 400. Теперь параметры действительно опциональны
    validate([
        query(['minRating', 'maxRating']).optional().isInt({ min: 0, max: 4000 }).withMessage('must be an integer 0–4000').toInt(),
        query('source').optional().isIn(['all', 'lichess', 'book']).withMessage('source must be all, lichess or book'),
        query('bookId').optional().isMongoId().withMessage('bookId must be a valid id'),
        query('exclude').optional().isString().isLength({ max: 100 }),
        query('theme').optional().isString().trim().isLength({ min: 1, max: 50 }).withMessage('theme must be 1–50 characters'),
    ]),
    puzzleController.getRandomPuzzle
);


// Здесь можно будет добавлять другие роуты, например, для создания пазлов тренерами:
/*
const roleMiddleware = require('../middleware/roleV2.middleware');

router.post(
    '/',
    roleMiddleware(['COACH', 'ADMIN']), // Только тренеры и админы могут создавать
    [
        validateRequest('fen', 'body'),
        validateRequest('moves', 'body'),
        validateRequest('rating', 'body'),
    ],
    puzzleController.createPuzzle
);
*/


// Экспортируем роутер, обернутый в ваш обработчик ошибок
module.exports = withErrorHandling(router);