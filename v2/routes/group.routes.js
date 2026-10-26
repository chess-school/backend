// v2/routes/group.routes.js

const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const groupController = require('../controllers/group.controller');
const validate = require('../middleware/validate');

const groupIdParam = param('groupId').isMongoId().withMessage('groupId must be a valid id');

// Список своих групп: GET /api/v2/coaches/me/groups — объявлен в coach.routes.js
// (здесь он оказывался по адресу /api/v2/groups/coaches/me/groups).

// =================================================================
//          РОУТЫ ДЛЯ УПРАВЛЕНИЯ ГРУППАМИ (ДЛЯ ТРЕНЕРОВ)
// =================================================================

/**
 * @route   POST /api/v2/groups
 * @desc    Создать новую учебную группу
 * @access  Private (role: COACH)
 */
router.post(
    '/',
    authMiddleware,
    require('../middleware/resolveClubV2.middleware'),
    roleMiddleware(['COACH', 'ADMIN']),
    validate([
        body('name').isString().withMessage('name is required').bail().trim()
            .isLength({ min: 1, max: 100 }).withMessage('name must be 1–100 characters'),
        body('description').optional().isString().trim().isLength({ max: 2000 }).withMessage('description must be up to 2000 characters'),
    ]),
    groupController.createGroup
);

/**
 * @route   GET /api/v2/groups/:groupId
 * @desc    Получить детальную информацию о группе (для тренера, участника или ADMIN)
 * @access  Private
 */
router.get(
    '/:groupId',
    authMiddleware,
    validate([groupIdParam]),
    groupController.getGroupById
);

// =================================================================
//          РОУТЫ ДЛЯ УПРАВЛЕНИЯ УЧАСТНИКАМИ ГРУППЫ
// =================================================================

/**
 * @route   POST /api/v2/groups/:groupId/members
 * @desc    Добавить студента в группу
 * @access  Private (role: COACH)
 */
router.post(
    '/:groupId/members',
    authMiddleware,
    roleMiddleware(['COACH', 'ADMIN']),
    validate([groupIdParam, body('userUuid').isUUID().withMessage('userUuid must be a valid UUID')]),
    groupController.addMemberToGroup
);

/**
 * @route   DELETE /api/v2/groups/:groupId/members/:userUuid
 * @desc    Удалить студента из группы
 * @access  Private (role: COACH)
 */
router.delete(
    '/:groupId/members/:userUuid',
    authMiddleware,
    roleMiddleware(['COACH', 'ADMIN']),
    validate([groupIdParam, param('userUuid').isUUID().withMessage('userUuid must be a valid UUID')]),
    groupController.removeMemberFromGroup
);

module.exports = withErrorHandling(router);
