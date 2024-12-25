const express = require('express');
const http = require('http');
const { Server } = require('socket.io'); 
const connectDB = require('./config/db');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();
connectDB();

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: ['http://localhost:3002', 'http://localhost:3001', 'http://localhost:5173'],
        methods: ['GET', 'POST'],
        credentials: true
    }
});

app.use(express.json());
app.use(cors({
    origin: ['http://localhost:3002', 'http://localhost:3001', 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/api', require('./routes'));

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

const PORT = process.env.PORT || 5000;

const start = () => {
    try {
        server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
    } catch (err) {
        console.log(err);
    }
};

start();
