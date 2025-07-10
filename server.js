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

const originLinks = [
    'http://localhost:3002', 
    'http://localhost:3001', 
    'http://localhost:5173', 
    'https://new-front-u2qi-99pw6oah7-nikitas-projects-27f00a22.vercel.app', 
    'https://new-front-u2qi-208ucx92u-nikitas-projects-27f00a22.vercel.app',
    'https://new-front-u2qi-d4jmz3wcy-nikitas-projects-27f00a22.vercel.app',
    'https://new-front-u2qi-r1np2ja0n-nikitas-projects-27f00a22.vercel.app',
    'https://new-front-u2qi-8e1zfstgy-nikitas-projects-27f00a22.vercel.app',
    'https://new-front-u2qi-da91kzjnn-nikitas-projects-27f00a22.vercel.app'
];

const publicRouter = express.Router();
publicRouter.get('/ping', (req, res) => {
    console.log(`Received keep-alive ping at: ${new Date().toISOString()}`);
    res.status(200).send('Pong!');
});

app.use('/api', publicRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: originLinks,
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
