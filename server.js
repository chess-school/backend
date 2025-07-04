const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const initializeSocket = require('./sockets/game.sockets');

dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: ['http://localhost:3002', 'http://localhost:3001', 'http://localhost:5173', 'https://new-front-u2qi-git-dev-nikitas-projects-27f00a22.vercel.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/api', require('./routes'));

initializeSocket(server);

const PORT = process.env.PORT || 5000;

const start = () => {
    try {
        server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
    } catch (err) {
        console.log(err);
    }
};

start();
