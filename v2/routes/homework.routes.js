// v2/routes/homework.routes.js
//
// Домашние задания — два роутера (каждый со своей авторизацией, чтобы не перехватывать чужие пути):
//   /api/v2/assignments  — задания (тренер задаёт к занятию, студент сдаёт)
//   /api/v2/submissions  — сдачи (тренер проверяет, вложение — скриншот)
// Ошибки — { msg, code, details? }: 400 битый id, 403 нет прав, 404, 409 конфликт, 413 большой файл, 422 валидация.

const express = require('express');
const { body, param, query } = require('express-validator');
const assignments = express.Router();
const submissions = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const validate = require('../middleware/validate');
const uploadImage = require('../middleware/uploadImage');
const controller = require('../controllers/homework.controller');

const STAFF = ['COACH', 'ADMIN'];
const mongoId = (name) => param(name).isMongoId().withMessage(`${name} must be a valid id`);
const title = () => body('title').optional().isString().bail().trim().isLength({ min: 1, max: 200 }).withMessage('title must be 1–200 characters');
const description = (required) => (required ? body('description').exists().withMessage('description is required').bail() : body('description').optional())
    .isString().bail().trim().isLength({ min: 1, max: 5000 }).withMessage('description must be 1–5000 characters');
const dueDate = () => body('dueDate').optional({ values: 'null' })
    .isISO8601({ strict: true }).withMessage('dueDate must be an ISO 8601 date').bail().toDate();
const onlyFields = (allowed) => body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new Error(`Unknown field(s): ${unknown.join(', ')}`);
    return true;
});

const resolveClub = require('../middleware/resolveClubV2.middleware');
assignments.use(authMiddleware);
assignments.use(resolveClub);
submissions.use(authMiddleware);
submissions.use(resolveClub);

// ---------------------- задания ----------------------

assignments.get('/my', controller.listMyAssignments);

assignments.get('/',
    roleMiddleware(['COACH', 'ADMIN']),
    validate([query('scheduleId').optional().isMongoId().withMessage('scheduleId must be a valid id')]),
    controller.listCoachAssignments
);

assignments.post('/',
    roleMiddleware(['COACH', 'ADMIN']),
    validate([
        onlyFields(['scheduleId', 'title', 'description', 'dueDate']),
        body('scheduleId').exists().withMessage('scheduleId is required').bail().isMongoId().withMessage('scheduleId must be a valid id'),
        title(),
        description(true),
        dueDate(),
    ]),
    controller.createAssignment
);

assignments.post('/puzzles',
    roleMiddleware(['COACH', 'ADMIN']),
    validate([
        onlyFields(['contextType', 'contextRefId', 'puzzleBookId', 'title', 'description', 'puzzleTarget', 'dueDate', 'plan']),
        body('contextType').isIn(['student', 'group']).withMessage('contextType must be student or group'),
        body('contextRefId').isMongoId().withMessage('contextRefId must be a valid id'),
        body('puzzleBookId').isMongoId().withMessage('puzzleBookId must be a valid id'),
        title(),
        description(false),
        body('puzzleTarget').optional().isInt({ min: 0, max: 100000 }).withMessage('puzzleTarget must be a non-negative integer'),
        dueDate(),
        body('plan').optional().isArray({ max: 60 }).withMessage('plan must be an array'),
        body('plan.*.date').optional().isISO8601().withMessage('plan.date must be an ISO 8601 date'),
        body('plan.*.puzzleCount').optional().isInt({ min: 0, max: 100000 }),
        body('plan.*.note').optional().isString().bail().isLength({ max: 500 }),
    ]),
    controller.createPuzzleAssignment
);

assignments.patch('/:assignmentId',
    roleMiddleware(STAFF),
    validate([
        mongoId('assignmentId'),
        onlyFields(['title', 'description', 'dueDate']),
        body().custom((v) => {
            if (!['title', 'description', 'dueDate'].some((f) => v && v[f] !== undefined)) throw new Error('Provide at least one of: title, description, dueDate');
            return true;
        }),
        title(),
        description(false),
        dueDate(),
    ]),
    controller.updateAssignment
);

assignments.delete('/:assignmentId', roleMiddleware(STAFF), validate([mongoId('assignmentId')]), controller.deleteAssignment);

// Сдача: multipart/form-data, поля contentText и file (изображение до 5 МБ)
assignments.put('/:assignmentId/submission',
    validate([mongoId('assignmentId')]),
    uploadImage,
    validate([
        body('contentText').optional().isString().bail().isLength({ max: 10000 }).withMessage('contentText must be up to 10000 characters'),
    ]),
    controller.submitAssignment
);

// ---------------------- сдачи ----------------------

submissions.get('/review',
    roleMiddleware(['COACH', 'ADMIN']),
    validate([query('status').optional().isIn(['submitted', 'needs_revision', 'approved']).withMessage('status must be submitted, needs_revision or approved')]),
    controller.listSubmissionsForReview
);

submissions.patch('/:submissionId/review',
    roleMiddleware(STAFF),
    validate([
        mongoId('submissionId'),
        onlyFields(['status', 'comment']),
        body('status').isIn(['approved', 'needs_revision']).withMessage('status must be approved or needs_revision'),
        body('comment').optional().isString().bail().trim().isLength({ max: 5000 }).withMessage('comment must be up to 5000 characters'),
    ]),
    controller.reviewSubmission
);

submissions.get('/:submissionId/attachment', validate([mongoId('submissionId')]), controller.getSubmissionAttachment);

module.exports = { assignments: withErrorHandling(assignments), submissions: withErrorHandling(submissions) };
