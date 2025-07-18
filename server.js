const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const i18nextMiddleware = require('./config/i18n');
const initializeSocket = require('./sockets/game.sockets');

dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);

const whitelist = [
    'http://localhost:3002', 
    'http://localhost:3001', 
    'http://localhost:5173',
].filter(Boolean); 

const vercelPreviewRegex = new RegExp(
    /^https:\/\/new-front-u2qi-[a-z0-9]+-nikitas-projects-27f00a22\.vercel\.app$/
);

const corsOptions = {
    origin: function (origin, callback) {
        // Разрешаем запросы, если они:
        // - из "белого списка" (whitelist)
        // - соответствуют шаблону Vercel (vercelPreviewRegex)
        // - не имеют 'origin' (например, запросы от Postman или curl)
        if (whitelist.indexOf(origin) !== -1 || vercelPreviewRegex.test(origin) || !origin) {
            callback(null, true);
        } else {
            callback(new Error('This origin is not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

const publicRouter = express.Router();
publicRouter.get('/ping', (req, res) => {
    console.log(`Received keep-alive ping at: ${new Date().toISOString()}`);
    res.status(200).send('Pong!');
});

app.use('/api', publicRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(i18nextMiddleware); 
app.use(cors(corsOptions));

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