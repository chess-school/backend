// v2/controllers/chatRoom.controller.js
// Тонкий слой HTTP для личных сообщений; логика и права — в services/chat.service.js.
// (Старый chat.controller.js — групповые «conversations», к этому модулю не относится.)

const chatService = require('../services/chat.service');

/**
 * @desc    Мои диалоги: собеседник, последнее сообщение, число непрочитанных
 * @route   GET /api/v2/chat/rooms
 */
const listRooms = async (req, res) => {
    res.json({ data: await chatService.listRooms(req.user) });
};

/**
 * @desc    Открыть диалог с пользователем (найти или создать — идемпотентно)
 * @route   POST /api/v2/chat/rooms  { userId, context?: { kind, refId, title } }
 */
const openRoom = async (req, res) => {
    const { room, created } = await chatService.openRoom(req.user, req.body);
    res.status(created ? 201 : 200).json({ data: room });
};

/**
 * @desc    История диалога (курсор before = id сообщения)
 * @route   GET /api/v2/chat/rooms/:roomId/messages?before=&limit=
 */
const listMessages = async (req, res) => {
    const { before, limit } = req.query;
    res.json(await chatService.listMessages(req.user, req.params.roomId, { before, limit }));
};

/**
 * @desc    Отправить сообщение
 * @route   POST /api/v2/chat/rooms/:roomId/messages  { text, clientId? }
 */
const sendMessage = async (req, res) => {
    const message = await chatService.sendMessage(req.user, req.params.roomId, req.body);
    res.status(201).json({ data: message });
};

/**
 * @desc    Отметить сообщения собеседника прочитанными
 * @route   POST /api/v2/chat/rooms/:roomId/read
 */
const markRead = async (req, res) => {
    res.json({ data: await chatService.markRead(req.user, req.params.roomId) });
};

/**
 * @desc    Число непрочитанных: всего и по комнатам
 * @route   GET /api/v2/chat/unread
 */
const unread = async (req, res) => {
    res.json({ data: await chatService.unreadSummary(req.user) });
};

/**
 * @desc    С кем можно переписываться (ученики тренера / тренеры ученика)
 * @route   GET /api/v2/chat/contacts
 */
const contacts = async (req, res) => {
    res.json({ data: await chatService.listContacts(req.user) });
};

module.exports = { listRooms, openRoom, listMessages, sendMessage, markRead, unread, contacts };
