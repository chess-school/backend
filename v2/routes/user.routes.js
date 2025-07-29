// v2/routes/user.routes.js

const express = require('express');
const router = express.Router();

const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/authV2.middleware');
const uploadMiddleware = require('../../middleware/upload'); // Используем ваш существующий multer middleware
const withErrorHandling = require('../utils/withErrorHandling');
const validateRequest = require('../middleware/validateRequest'); 


// =================================================================
//      ЭНДПОИНТЫ ДЛЯ УПРАВЛЕНИЯ СОБСТВЕННЫМ ПРОФИЛЕМ (/me)
// =================================================================

/**
 * @route   GET /api/v2/users/me
 * @desc    Получить профиль текущего авторизованного пользователя
 * @access  Private
 */
router.get(
    '/me',
    authMiddleware,
    userController.getMyProfile
);

/**
 * @route   PUT /api/v2/users/me
 * @desc    Обновить профиль текущего пользователя (имя, пароль)
 * @access  Private
 */
router.put(
    '/me',
    authMiddleware,
    userController.updateMyProfile
);

/**
 * @route   POST /api/v2/users/me/avatar
 * @desc    Загрузить или обновить аватар текущего пользователя
 * @access  Private
 */
router.post(
    '/me/avatar',
    [ authMiddleware ],
    userController.updateMyAvatar
);


// =================================================================
//      ЭНДПОИНТЫ ДЛЯ ПОЛУЧЕНИЯ ПУБЛИЧНЫХ ДАННЫХ
// =================================================================

/**
 * @route   GET /api/v2/users/:userId/avatar
 * @desc    Получить аватар пользователя по его ID
 * @access  Public
 */
router.get(
    '/:uuid/avatar',
    validateRequest('uuid'), // Проверяем, что параметр uuid передан
    userController.getAvatarByUuid
);

module.exports = withErrorHandling(router);