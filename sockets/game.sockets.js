const { Server } = require('socket.io');

const initializeSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: ['http://localhost:3002', 'http://localhost:3001', 'http://localhost:5173'],
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        console.log(`Игрок подключился: ${socket.id}`);

        socket.on('move', (data) => {
            console.log('Ход:', data);
            io.to(data.gameId).emit('move', data);
        });

        socket.on('joinGame', ({ gameId, playerId }) => {
            socket.join(gameId);
            console.log(`Игрок ${playerId} присоединился к игре ${gameId}`);
        });

        socket.on('disconnect', () => {
            console.log('Игрок отключился:', socket.id);
        });
    });

    return io;
};

module.exports = initializeSocket;
