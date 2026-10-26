const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { isAllowedOrigin } = require('../config/cors');
const { isClustered, getPubSub } = require('../v2/services/play/redis');

// Общий socket.io-сервер (CORS как у Express); namespaces подключаются в server.js
const initializeSocket = (server) => {
    const io = new Server(server, {
        // Те же источники, что у Express (config/cors.js), включая превью Vercel
        cors: {
            origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    // ШАГ 1: в кластере (REDIS_URL задан) рассылка событий между процессами идёт через Redis Pub/Sub —
    // nsp.to(room).emit(...) из любого процесса доходит до клиентов на всех процессах кластера.
    if (isClustered()) {
        const { pub, sub } = getPubSub();
        io.adapter(createAdapter(pub, sub));
        console.log('socket.io: Redis adapter включён (кластерный режим)');
    }

    // Обработчиков в корневом namespace нет: партии — /play (sockets/play.sockets.js), чат — /chat.
    // Прежние 'move'/'joinGame' пересылали ходы без проверки — удалены.

    return io;
};

module.exports = initializeSocket;
