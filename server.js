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

const publicRouter = express.Router();
publicRouter.get('/ping', (req, res) => {
    console.log(`Received keep-alive ping at: ${new Date().toISOString()}`);
    res.status(200).send('Pong!');
});

app.use('/api', publicRouter);

const dynamicCors = (origin, callback) => {
    const whitelist = [
        'http://localhost:3002',
        'http://localhost:3001',
        'http://localhost:5173'
    ];
    const regex = /^https:\/\/new-front-u2qi-[a-z0-9]+\.vercel\.app$/;

    if (!origin || whitelist.includes(origin) || regex.test(origin)) {
        callback(null, true);
    } else {
        callback(new Error('Not allowed by CORS: ' + origin));
    }
};

app.use(cors({
    origin: dynamicCors,
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
