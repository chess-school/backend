// v2/routes/puzzles.routes.js

const express = require('express');
const router = express.Router();

// Подключаем ваши утилиты и middleware
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const validateRequest = require('../middleware/validateRequest'); // Ваш валидатор

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
 * @desc    Получить случайную задачу. Можно передавать query-параметры minRating и maxRating.
 * @access  Private (для всех аутентифицированных пользователей)
 */
router.get(
    '/random',
    [
        // Валидируем необязательные query-параметры.
        // Я предполагаю, что ваш validateRequest может быть настроен так.
        // Если нет, эту часть можно убрать, но это хороший паттерн.
        validateRequest('minRating', 'query', { optional: true, isInt: true }),
        validateRequest('maxRating', 'query', { optional: true, isInt: true }),
    ],
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