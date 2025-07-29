// v2/routes/auth.routes.js

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const authController = require('../controllers/auth.controller');
const withErrorHandling = require('../utils/withErrorHandling');

// =================================================================
//                      АУТЕНТИФИКАЦИЯ И РЕГИСТРАЦИЯ
// =================================================================

/**
 * @route   POST /api/v2/auth/register
 * @desc    Регистрация нового пользователя
 * @access  Public
 */
router.post(
    '/register',
    [
        // Валидация входных данных
        check('firstName', 'First name is required').not().isEmpty().trim(),
        check('lastName', 'Last name is required').not().isEmpty().trim(),
        check('email', 'Please include a valid email').isEmail(),
        check('password', 'Password must be 6 or more characters').isLength({ min: 6 }),
    ],
    authController.register
);

/**
 * @route   POST /api/v2/auth/login
 * @desc    Аутентификация пользователя и получение токена
 * @access  Public
 */
router.post(
    '/login',
    [
        check('email', 'Please include a valid email').isEmail(),
        check('password', 'Password is required').exists(),
    ],
    authController.login
);

// =================================================================
//                      ВЕРИФИКАЦИЯ EMAIL
// =================================================================

/**
 * @route   GET /api/v2/auth/verify-email
 * @desc    Верификация email по токену из письма
 * @access  Public
 */
router.get(
    '/verify-email',
    authController.verifyEmail // Токен проверяется в контроллере из req.query
);

/**
 * @route   POST /api/v2/auth/resend-verification
 * @desc    Повторная отправка письма для верификации
 * @access  Public
 */
router.post(
    '/resend-verification',
    [
        check('email', 'Please include a valid email').isEmail(),
    ],
    authController.resendVerificationEmail
);

/**
 * @route   POST /api/v2/auth/check-verification
 * @desc    Проверка статуса верификации (для UX на фронтенде)
 * @access  Public
 */
router.post(
    '/check-verification',
    [
        check('token', 'Verification token is required').not().isEmpty(),
    ],
    authController.checkVerificationStatus
);


module.exports = withErrorHandling(router);
