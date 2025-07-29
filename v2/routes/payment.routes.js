// v2/routes/payment.routes.js

const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const paymentController = require('../controllers/payment.controller');
const validateRequest = require('../middleware/validateRequest');


/**
 * @route   POST /api/v2/payments/create-checkout-session
 * @desc    Создать Stripe Checkout сессию для оплаты.
 * @access  Private
 */
router.post(
    '/create-checkout-session',
    authMiddleware,
    validateRequest('contractId'),
    // Передаем контроллер НАПРЯМУЮ, без обертки
    paymentController.createCheckoutSession
);

// Применяем нашу утилиту ко всему роутеру в конце файла.
// Наша утилита сама пропустит webhook, так как мы ее немного улучшим.
module.exports = withErrorHandling(router);