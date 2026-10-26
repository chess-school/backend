const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const scheduleController = require('../controllers/schedule.controller');
const validate = require('../middleware/validate');

const eventIdParam = param('eventId').isMongoId().withMessage('eventId must be a valid id');
const EVENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'missed'];

// Общие правила для полей события; required — только для создания
const eventFields = (required) => [
    (required ? body('title').exists().withMessage('title is required').bail() : body('title').optional())
        .isString().trim().isLength({ min: 1, max: 200 }).withMessage('title must be 1–200 characters'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description must be up to 5000 characters'),
    (required ? body('date').exists().withMessage('date is required').bail() : body('date').optional())
        .isISO8601({ strict: true }).withMessage('date must be an ISO 8601 date-time, e.g. 2026-09-01T18:00:00Z').bail().toDate(),
    body('durationMinutes').optional().isInt({ min: 5, max: 600 }).withMessage('durationMinutes must be an integer 5–600').toInt(),
    body('link').optional({ values: 'falsy' }).isURL({ protocols: ['http', 'https'], require_protocol: true })
        .withMessage('link must be an http(s) URL'),
];

/**
 * @route   POST /api/v2/schedule
 * @desc    Создать новое событие в расписании
 * @access  Private (role: COACH)
 */
router.post(
    '/',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    roleMiddleware(['COACH', 'ADMIN']),
    validate([
        ...eventFields(true),
        body('eventType').isIn(['individual', 'group']).withMessage('eventType must be "individual" or "group"'),
        body('contextId').isMongoId().withMessage('contextId must be a valid id'),
        body('notify').optional().isBoolean().withMessage('notify must be a boolean').toBoolean(),
        body('message').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }).withMessage('message must be at most 2000 chars'),
        body('personalMessages').optional().isObject().withMessage('personalMessages must be an object'),
    ]),
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
    require('../middleware/resolveClubV2.middleware'),
    validate([
        query(['startDate', 'endDate']).optional().isISO8601().withMessage('must be an ISO 8601 date'),
    ]),
    scheduleController.getMySchedule
);


/**
 * @route   PUT /api/v2/schedule/:eventId
 * @desc    Обновить событие: title, description, date, durationMinutes, link, status
 * @access  Private (role: COACH)
 */
router.put(
    '/:eventId',
    authMiddleware,
    roleMiddleware(['COACH', 'ADMIN']),
    validate([
        eventIdParam,
        ...eventFields(false),
        body('status').optional().isIn(EVENT_STATUSES).withMessage(`status must be one of: ${EVENT_STATUSES.join(', ')}`),
    ]),
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
    roleMiddleware(['COACH', 'ADMIN']),
    validate([eventIdParam]),
    scheduleController.deleteScheduleEvent
);


module.exports = withErrorHandling(router);
