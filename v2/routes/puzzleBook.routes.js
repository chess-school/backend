// v2/routes/puzzleBook.routes.js

const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const puzzleBookController = require('../controllers/puzzleBook.controller');

// Задачники из оцифрованных книг: решать может любой авторизованный, редактировать — COACH/ADMIN
router.use(authMiddleware);
router.use(require('../middleware/resolveClubV2.middleware'));

/**
 * @route   GET /api/v2/puzzle-books
 * @desc    Список задачников (ученикам — только опубликованные)
 */
router.get('/', puzzleBookController.getBooks);

/**
 * @route   GET /api/v2/puzzle-books/:bookId
 * @desc    Задачник со всеми упражнениями
 */
router.get('/:bookId', puzzleBookController.getBook);

/**
 * @route   PATCH /api/v2/puzzle-books/:bookId
 * @desc    Изменить название, описание или статус (draft | published)
 */
router.patch('/:bookId', roleMiddleware(['COACH', 'ADMIN']), puzzleBookController.updateBook);

/**
 * @route   PUT /api/v2/puzzle-books/:bookId/exercises/:exerciseId
 * @desc    Сохранить правки упражнения: title, fen, comment, hint, solution
 */
router.put(
    '/:bookId/exercises/:exerciseId',
    roleMiddleware(['COACH', 'ADMIN']),
    puzzleBookController.updateExercise
);

/**
 * @route   POST /api/v2/puzzle-books/:bookId/attempts
 * @desc    Зафиксировать попытку решения упражнения (ученик) — для статистики
 */
router.post('/:bookId/attempts', puzzleBookController.recordAttempt);

/**
 * @route   GET /api/v2/puzzle-books/:bookId/stats
 * @desc    Статистика прогресса учеников по задачнику (тренер)
 */
router.get('/:bookId/stats', roleMiddleware(['COACH', 'ADMIN']), puzzleBookController.getBookStats);

module.exports = withErrorHandling(router);
