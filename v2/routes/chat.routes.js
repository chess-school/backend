// v2/routes/chat.routes.js

const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const chatController = require('../controllers/chat.controller');

// Все роуты для чатов требуют авторизации
router.use(authMiddleware);

/**
 * @route   GET /api/v2/conversations
 * @desc    Получить список всех чатов пользователя
 * @access  Private
 */
router.get('/', chatController.getMyConversations);

/**
 * @route   GET /api/v2/conversations/:conversationId/messages
 * @desc    Получить историю сообщений для конкретного чата
 * @access  Private
 */
router.get('/:conversationId/messages', chatController.getConversationMessages);


module.exports = withErrorHandling(router);