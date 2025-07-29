// v2/routes/group.routes.js

const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const groupController = require('../controllers/group.controller');
const validateRequest = require('../middleware/validateRequest');


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
    roleMiddleware(['COACH']),
    validateRequest('name'), // Название группы обязательно
    groupController.createGroup
);

/**
 * @route   GET /api/v2/coaches/me/groups
 * @desc    Получить список всех групп, созданных текущим тренером
 * @access  Private (role: COACH)
 */
router.get(
    '/coaches/me/groups', // Этот роут логически связан с "моими" данными тренера
    authMiddleware,
    roleMiddleware(['COACH']),
    groupController.getMyGroups
);

/**
 * @route   GET /api/v2/groups/:groupId
 * @desc    Получить детальную информацию о группе (для тренера или участника)
 * @access  Private
 */
router.get(
    '/:groupId',
    authMiddleware, // Доступ есть у любого авторизованного пользователя...
    // ...а детальная проверка (тренер я или участник) происходит внутри контроллера
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
    roleMiddleware(['COACH']),
    validateRequest('userUuid'), // Требуем передать uuid студента в теле запроса
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
    roleMiddleware(['COACH']),
    groupController.removeMemberFromGroup
);

module.exports = withErrorHandling(router);