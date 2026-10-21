// v2/routes/chatRoom.routes.js
//
// Личные сообщения тренер ↔ ученик: /api/v2/chat. Реалтайм — socket.io namespace /chat
// (sockets/chat.sockets.js), см. docs/CHAT_API.md.
// Ошибки — { msg, code, details? }: 400 битый id/курсор, 401 токен, 403 CHAT_NOT_ALLOWED,
// 404 ROOM_NOT_FOUND (в т.ч. чужая комната), 422 ошибка полей.

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const validate = require('../middleware/validate');
const chat = require('../controllers/chatRoom.controller');
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');

const roomIdParam = param('roomId').isMongoId().withMessage('roomId must be a valid id');

router.use(authMiddleware);

router.get('/rooms', chat.listRooms);

router.post('/rooms', validate([
    body('userId').isMongoId().withMessage('userId must be a valid id'),
    body('context').optional().isObject().withMessage('context must be an object'),
    body('context.kind').optional().isIn(ChatRoom.CONTEXT_KINDS).withMessage(`context.kind must be one of: ${ChatRoom.CONTEXT_KINDS.join(', ')}`),
    body('context.refId').optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage('context.refId must be 1–100 characters'),
    body('context.title').optional().isString().trim().isLength({ max: 200 }).withMessage('context.title must be at most 200 characters'),
]), chat.openRoom);

router.get('/rooms/:roomId/messages', validate([
    roomIdParam,
    query('before').optional().isMongoId().withMessage('before must be a message id'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1–100').toInt(),
]), chat.listMessages);

router.post('/rooms/:roomId/messages', validate([
    roomIdParam,
    body('text').isString().withMessage('text must be a string').bail()
        .trim().isLength({ min: 1, max: ChatMessage.MAX_TEXT }).withMessage(`text must be 1–${ChatMessage.MAX_TEXT} characters`),
    body('clientId').optional().isString().isLength({ max: 64 }).withMessage('clientId must be at most 64 characters'),
]), chat.sendMessage);

router.post('/rooms/:roomId/read', validate([roomIdParam]), chat.markRead);

router.get('/unread', chat.unread);
router.get('/contacts', chat.contacts);

module.exports = withErrorHandling(router);
