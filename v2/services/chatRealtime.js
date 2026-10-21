// v2/services/chatRealtime.js
// Мост между сервисом чата и socket.io: REST-контроллеры и сокет рассылают события одинаково.
// Каждый подключённый пользователь сидит в socket-комнате `user:<id>` (все его вкладки/устройства).
// Без инициализации (тесты REST, воркеры) рассылка — no-op.

let namespace = null;

const userRoom = (userId) => `user:${userId}`;

const setChatNamespace = (nsp) => { namespace = nsp; };

/** Отправить событие пользователям (во все их вкладки) */
const emitToUsers = (userIds, event, payload) => {
    if (!namespace) return;
    for (const id of new Set(userIds.map(String))) namespace.to(userRoom(id)).emit(event, payload);
};

module.exports = { setChatNamespace, emitToUsers, userRoom };
