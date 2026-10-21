const { Server } = require('socket.io');
const { isAllowedOrigin } = require('../config/cors');

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

    // Обработчиков в корневом namespace нет: партии — /play (sockets/play.sockets.js), чат — /chat.
    // Прежние 'move'/'joinGame' пересылали ходы без проверки — удалены.

    return io;
};

module.exports = initializeSocket;
