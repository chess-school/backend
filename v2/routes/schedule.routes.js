const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const scheduleController = require('../controllers/schedule.controller');
const validateRequest = require('../middleware/validateRequest');


/**
 * @route   POST /api/v2/schedule
 * @desc    Создать новое событие в расписании
 * @access  Private (role: COACH)
 */
router.post(
    '/',
    authMiddleware,
    roleMiddleware(['COACH']),
    validateRequest(['title', 'date', 'eventType', 'contextId']),
    scheduleController.createScheduleEvent
);


/**
 * @route   GET /api/v2/schedule
 * @desc    Получить "моё" расписание (для студента и/или тренера)
 * @access  Private
 */
router.get(
    '/',
    authMiddleware,
    scheduleController.getMySchedule
);


/**
 * @route   PUT /api/v2/schedule/:eventId
 * @desc    Обновить событие в расписании
 * @access  Private (role: COACH)
 */
router.put(
    '/:eventId',
    authMiddleware,
    roleMiddleware(['COACH']),
    scheduleController.updateScheduleEvent
);

/**
 * @route   DELETE /api/v2/schedule/:eventId
 * @desc    Удалить событие из расписания
 * @access  Private (role: COACH)
 */
router.delete(
    '/:eventId',
    authMiddleware,
    roleMiddleware(['COACH']),
    scheduleController.deleteScheduleEvent
);


module.exports = withErrorHandling(router);