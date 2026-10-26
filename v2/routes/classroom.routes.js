// v2/routes/classroom.routes.js
//
// Интерактивный класс: выдача токенов доступа к медиа-микросервису LiveKit.
// Синхронизация доски/ходов/«поднять руку» — отдельно (socket.io), не здесь.

const express = require('express');
const { param } = require('express-validator');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const validate = require('../middleware/validate');
const classroomController = require('../controllers/classroom.controller');

/**
 * @route   POST /api/v2/classrooms/webhooks/livekit
 * @desc    Серверные события LiveKit → посещаемость. Аутентификация — подпись LiveKit (не authV2);
 *          тело принимаем СЫРЫМ (express.raw), т.к. receiver сверяет sha256 исходного body.
 * @access  Public (подписано ключом LiveKit)
 */
router.post(
    '/webhooks/livekit',
    express.raw({ type: () => true, limit: '256kb' }),
    classroomController.handleLivekitWebhook
);

/**
 * @route   POST /api/v2/classrooms/:id/token
 * @desc    Выдать JWT доступа к LiveKit-комнате урока (права по роли участника)
 * @access  Private (тренер группы, её участник или ADMIN)
 */
// roomId = groupId (24-hex) ИЛИ индивидуальная комната `lesson-<eventId>` (lesson-<24-hex>)
const ROOM_ID_RE = /^(?:[a-f\d]{24}|lesson-[a-f\d]{24})$/i;

router.post(
    '/:id/token',
    authMiddleware,
    validate([param('id').matches(ROOM_ID_RE).withMessage('id must be a valid classroom id')]),
    classroomController.generateToken
);

/**
 * @route   POST /api/v2/classrooms/from-schedule/:eventId
 * @desc    Войти в урок из события расписания (создать/возобновить сессию + отметить присутствие)
 * @access  Private (тренер группы, её участник или ADMIN)
 */
router.post(
    '/from-schedule/:eventId',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    validate([param('eventId').isMongoId().withMessage('eventId must be a valid id')]),
    classroomController.enterFromSchedule
);

/**
 * @route   POST /api/v2/classrooms/sessions/:sessionId/end
 * @desc    Завершить сессию урока
 * @access  Private (тренер группы или ADMIN)
 */
router.post(
    '/sessions/:sessionId/end',
    authMiddleware,
    validate([param('sessionId').isMongoId().withMessage('sessionId must be a valid id')]),
    classroomController.endSession
);

/**
 * @route   GET /api/v2/classrooms/:id/sessions
 * @desc    История занятий группы
 * @access  Private (тренер группы, её участник или ADMIN)
 */
router.get(
    '/:id/sessions',
    authMiddleware,
    validate([param('id').isMongoId().withMessage('id must be a valid classroom id')]),
    classroomController.listSessions
);

module.exports = withErrorHandling(router);
