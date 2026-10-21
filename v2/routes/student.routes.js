// v2/routes/student.routes.js
//
// Модуль студентов. Студент — пользователь, записанный на курс (TrainingContract).
// Все ошибки — в едином формате { msg, code, details? }:
//   400 некорректный id/параметр, 401 нет/битый токен, 403 нет прав, 404 не найдено,
//   409 конфликт (уже записан, есть оплата, параллельное изменение), 422 ошибка валидации полей.

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const validate = require('../middleware/validate');
const studentController = require('../controllers/student.controller');
const { ENROLLMENT_STATUSES, INITIAL_STATUSES } = require('../services/student.service');

const STAFF = ['COACH', 'ADMIN'];
// Буквы любого алфавита, пробел, дефис, апостроф: «Анна-Мария», «O'Connor»
const NAME_RE = /^\p{L}[\p{L}\p{M}\s'’-]*$/u;
const E164_RE = /^\+[1-9]\d{7,14}$/;

// --- переиспользуемые правила ---

/** Некорректный идентификатор в URL validate() отдаёт как 400 INVALID_ID */
const idParam = (name, { allowMe = false } = {}) => param(name)
    .custom((value) => (allowMe && value === 'me') || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    .withMessage(`${name} must be a valid UUID`);
const mongoIdParam = (name) => param(name).isMongoId().withMessage(`${name} must be a valid id`);

const optionalDate = (field) => body(field)
    .optional({ values: 'null' })
    .isISO8601({ strict: true }).withMessage(`${field} must be an ISO 8601 date, e.g. 2026-09-01`)
    .bail()
    .toDate();

const personName = (field) => body(field)
    .optional()
    .isString().withMessage(`${field} must be a string`).bail()
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage(`${field} must be 1–50 characters`).bail()
    .matches(NAME_RE).withMessage(`${field} may contain only letters, spaces, hyphens and apostrophes`);

const phone = body('phone')
    .optional({ values: 'null' })
    .isString().withMessage('phone must be a string').bail()
    .customSanitizer((v) => v.replace(/[\s()-]/g, ''))
    .custom((v) => v === '' || E164_RE.test(v)).withMessage('phone must be in international format, e.g. +380501234567');

/** Лишние поля в теле — 422: защищает от случайной/злонамеренной записи чужих полей */
const onlyFields = (allowed) => body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new Error(`Unknown field(s): ${unknown.join(', ')}`);
    return true;
});

const atLeastOne = (fields) => body().custom((value) => {
    if (!fields.some((f) => value && value[f] !== undefined)) {
        throw new Error(`Provide at least one of: ${fields.join(', ')}`);
    }
    return true;
});

router.use(authMiddleware);

/**
 * @route   GET /api/v2/students
 * @query   status, courseId, groupId, coachId (ADMIN), search, page (1), limit (20, max 100)
 */
router.get(
    '/',
    roleMiddleware(STAFF),
    validate([
        query('status').optional().isIn(ENROLLMENT_STATUSES).withMessage(`status must be one of: ${ENROLLMENT_STATUSES.join(', ')}`),
        query(['courseId', 'groupId', 'coachId']).optional().isMongoId().withMessage('must be a valid id'),
        query('search').optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage('search must be 1–100 characters'),
        query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('page must be a positive integer').toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt(),
    ]),
    studentController.listStudents
);

/**
 * @route   GET /api/v2/students/:uuid    (:uuid = me — своя карточка)
 */
router.get(
    '/:uuid',
    validate([idParam('uuid', { allowMe: true })]),
    studentController.getStudent
);

/**
 * @route   POST /api/v2/students
 * @body    { email | userUuid, courseId, groupId?, status?, startDate?, endDate?, coachId? (ADMIN) }
 */
router.post(
    '/',
    roleMiddleware(STAFF),
    validate([
        onlyFields(['email', 'userUuid', 'courseId', 'groupId', 'status', 'startDate', 'endDate', 'coachId']),
        body().custom((value) => {
            const hasEmail = value && value.email !== undefined;
            const hasUuid = value && value.userUuid !== undefined;
            if (hasEmail === hasUuid) throw new Error('Provide exactly one of: email, userUuid');
            return true;
        }),
        // Только trim + lowercase: normalizeEmail() вырезал бы +метки и точки и ломал поиск пользователя
        body('email').optional().isString().withMessage('email must be a string').bail().trim().toLowerCase()
            .isEmail().withMessage('email must be a valid email address'),
        body('userUuid').optional().isUUID().withMessage('userUuid must be a valid UUID'),
        body('courseId').exists().withMessage('courseId is required').bail().isMongoId().withMessage('courseId must be a valid id'),
        body('groupId').optional({ values: 'null' }).isMongoId().withMessage('groupId must be a valid id'),
        body('coachId').optional().isMongoId().withMessage('coachId must be a valid id')
            .bail()
            .custom((value, { req }) => {
                if (!req.user.roles.includes('ADMIN')) throw new Error('coachId can be set only by an administrator');
                return true;
            }),
        body('status').optional().isIn(INITIAL_STATUSES).withMessage(`status must be one of: ${INITIAL_STATUSES.join(', ')}`),
        optionalDate('startDate'),
        optionalDate('endDate'),
    ]),
    studentController.enrollStudent
);

/**
 * @route   PATCH /api/v2/students/:uuid
 * @body    { firstName?, lastName?, phone? (null — удалить) }
 */
router.patch(
    '/:uuid',
    roleMiddleware(['ADMIN']),
    validate([idParam('uuid')]),
    validate([
        onlyFields(['firstName', 'lastName', 'phone']),
        atLeastOne(['firstName', 'lastName', 'phone']),
        personName('firstName'),
        personName('lastName'),
        phone,
    ]),
    studentController.updateStudentProfile
);

/**
 * @route   PATCH /api/v2/students/:uuid/enrollments/:enrollmentId
 * @body    { status?, groupId? (null — убрать из группы), startDate?, endDate?, progressPercentage? }
 */
router.patch(
    '/:uuid/enrollments/:enrollmentId',
    roleMiddleware(STAFF),
    validate([idParam('uuid'), mongoIdParam('enrollmentId')]),
    validate([
        onlyFields(['status', 'groupId', 'startDate', 'endDate', 'progressPercentage']),
        atLeastOne(['status', 'groupId', 'startDate', 'endDate', 'progressPercentage']),
        body('status').optional().isIn(ENROLLMENT_STATUSES).withMessage(`status must be one of: ${ENROLLMENT_STATUSES.join(', ')}`),
        body('groupId').optional({ values: 'null' }).isMongoId().withMessage('groupId must be a valid id or null'),
        optionalDate('startDate'),
        optionalDate('endDate'),
        body('progressPercentage').optional().isInt({ min: 0, max: 100 }).withMessage('progressPercentage must be an integer 0–100').toInt(),
    ]),
    studentController.updateEnrollment
);

/**
 * @route   DELETE /api/v2/students/:uuid/enrollments/:enrollmentId
 */
router.delete(
    '/:uuid/enrollments/:enrollmentId',
    roleMiddleware(STAFF),
    validate([idParam('uuid'), mongoIdParam('enrollmentId')]),
    studentController.deleteEnrollment
);

module.exports = withErrorHandling(router);
