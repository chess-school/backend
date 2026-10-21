// sockets/chat.sockets.js
//
// Реалтайм личных сообщений: socket.io namespace /chat на общем HTTP-сервере.
// Подключение: io('<host>/chat', { auth: { token: '<JWT>' } }) — тот же токен и та же проверка,
// что у REST (подпись, срок, версия сессии). Каждый сокет сидит в комнате user:<id>.
//
// Клиент -> сервер (все с ack-колбэком: { ok: true, data } | { ok: false, error: { msg, code } }):
//   message:send { roomId, text, clientId? }   — запись в БД + message:new обоим участникам
//   message:read { roomId }                    — readAt + message:read обоим участникам
//   typing       { roomId, typing: boolean }   — typing собеседнику (без записи в БД)
// Сервер -> клиент: message:new { roomId, message }, message:read { roomId, readerId, readAt },
//   typing { roomId, userId, typing }.

const { verifyAccessToken } = require('../v2/utils/accessToken');
const { ApiError } = require('../v2/utils/apiError');
const chatService = require('../v2/services/chat.service');
const { setChatNamespace, userRoom } = require('../v2/services/chatRealtime');

const toAckError = (error) => {
    if (error instanceof ApiError) return { msg: error.message, code: error.code };
    console.error('Chat socket error:', error);
    return { msg: 'An unexpected server error occurred.', code: 'INTERNAL_ERROR' };
};

/** Обработчик события с ack: ошибки сервиса не роняют сокет, а уходят клиенту */
const handle = (socket, event, fn) => {
    socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
            const data = await fn(payload || {});
            reply({ ok: true, data });
        } catch (error) {
            reply({ ok: false, error: toAckError(error) });
        }
    });
};

const initializeChatSocket = (io) => {
    const nsp = io.of('/chat');

    nsp.use(async (socket, next) => {
        try {
            socket.user = await verifyAccessToken(socket.handshake.auth && socket.handshake.auth.token);
            next();
        } catch (e) {
            const err = new Error(e.message || 'Unauthorized');
            err.data = { code: e.code || 'TOKEN_INVALID' };
            next(err);
        }
    });

    nsp.on('connection', (socket) => {
        const { user } = socket;
        socket.join(userRoom(user.id));

        handle(socket, 'message:send', ({ roomId, text, clientId }) => chatService.sendMessage(user, roomId, { text, clientId }));
        handle(socket, 'message:read', ({ roomId }) => chatService.markRead(user, roomId));
        handle(socket, 'typing', ({ roomId, typing }) => chatService.notifyTyping(user, roomId, typing));
    });

    setChatNamespace(nsp);
    return nsp;
};

module.exports = initializeChatSocket;
