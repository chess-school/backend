// routes/chessDB.routes.js

const express = require('express');
const router = express.Router();

// Подключаем наш новый контроллер
const chessDBController = require('../controllers/chessDB.controller');

// Здесь вы можете подключить ваши middleware, как в примере с пазлами
// const authMiddleware = require('../middleware/authV2.middleware');
// router.use(authMiddleware); // Если доступ только для авторизованных

// =================================================================
//          РОУТЫ ДЛЯ РЕСУРСА "CHESS DATABASE"
// =================================================================

/**
 * @route   GET /api/v2/chessdb/book/:fen
 * @desc    Получить статистику ходов для текущей позиции (FEN).
 * @access  Public
 */
router.get(
    // ВАЖНО: Используем '(*)' в конце, чтобы Express корректно обрабатывал FEN,
    // содержащий слэши ('/'), не считая их разделителями роута.
    '/book/:fen(*)',
    chessDBController.getOpeningBookByFen
);


/**
 * @route   GET /api/v2/chessdb/player/:name
 * @desc    Получить список партий, где играл указанный игрок.
 * @access  Public
 */
router.get(
    '/player/:name',
    chessDBController.getPlayerGames
);

/**
 * @route   GET /api/v2/chessdb/games/:fen
 * @desc    Получить список партий для текущей позиции (FEN).
 * @access  Public
 */
router.post('/games-by-history', chessDBController.getGamesByPgnHistory);

// Если вы используете ваш `withErrorHandling`, оберните экспорт в него
// module.exports = withErrorHandling(router);
module.exports = router;