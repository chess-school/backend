// v2/routes/user.routes.js

const express = require('express');
const router = express.Router();

const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/authV2.middleware');
const uploadMiddleware = require('../../middleware/upload'); // Используем ваш существующий multer middleware
const withErrorHandling = require('../utils/withErrorHandling');
const validateRequest = require('../middleware/validateRequest'); 
const validate = require('../middleware/validate');
const { body } = require('express-validator');

// Те же правила, что в student.routes.js
const NAME_RE = /^\p{L}[\p{L}\p{M}\s'’-]*$/u;
const E164_RE = /^\+[1-9]\d{7,14}$/;
const personName = (field) => body(field).optional().isString().bail().trim()
    .isLength({ min: 1, max: 50 }).withMessage(`${field} must be 1–50 characters`).bail()
    .matches(NAME_RE).withMessage(`${field} may contain only letters, spaces, hyphens and apostrophes`);


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
    validate([
        personName('firstName'),
        personName('lastName'),
        body('phone').optional({ values: 'null' }).isString().bail()
            .customSanitizer((v) => v.replace(/[\s()-]/g, ''))
            .custom((v) => v === '' || E164_RE.test(v))
            .withMessage('phone must be in international format, e.g. +380501234567'),
        body('newPassword').optional().isString().isLength({ min: 8, max: 128 }).withMessage('newPassword must be 8–128 characters'),
    ]),
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