const express = require('express');
const http = require('http');
// .env — до подключения модулей: часть из них читает окружение при загрузке (CORS_ORIGINS, Stripe)
require('dotenv').config();
const cors = require('cors');
const connectDB = require('./config/db');
const i18nextMiddleware = require('./config/i18n');
const initializeSocket = require('./sockets/game.sockets');
const initializeChatSocket = require('./sockets/chat.sockets');
const initializePlaySocket = require('./sockets/play.sockets');
const { corsOptions } = require('./config/cors');
const rateLimit = require('express-rate-limit');
const dns = require('dns');
dns.setServers(['8.8.8.8']);
connectDB();

const app = express();
const server = http.createServer(app);
// По умолчанию Node обрывает запрос через 5 мин вместе с телом — медленная загрузка книги
// на сотни МБ не успела бы дойти до прокси оцифровщика. headersTimeout (60 с) остаётся прежним.
server.requestTimeout = 30 * 60 * 1000;

// Источники CORS — config/cors.js (те же правила у socket.io)
app.use(cors(corsOptions));
app.use(
  '/api/v2/payments/webhook', 
  express.raw({ type: 'application/json' }),
  require('./v2/routes/webhook.router') // <--- Мы создадим этот новый, отдельный файл
);


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150, 
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
    // Фронтенд опрашивает статус оцифровки раз в 5 с (180 запросов за 15 мин) — не считаем их в лимит
    skip: (req) => req.method === 'GET' && /^\/v2\/digitizer\/tasks\/[^/]+$/.test(req.path),
});
app.use('/api', apiLimiter);

app.use(i18nextMiddleware); 

const publicRouter = express.Router();
publicRouter.get('/ping', (req, res) => {
    console.log(`Received keep-alive ping at: ${new Date().toISOString()}`);
    res.status(200).send('Pong!');
});
app.use('/api', publicRouter);



app.use('/api', require('./routes'));
app.use('/api/v2', require('./v2/routes'));
// Ошибки до контроллеров v2 (битый JSON и т.п.) — тем же форматом { msg, code }, а не HTML-страницей Express
app.use('/api/v2', require('./v2/middleware/errorHandlerV2').middleware);

const io = initializeSocket(server);
// Личные сообщения: namespace /chat, JWT в handshake (docs/CHAT_API.md)
initializeChatSocket(io);
// Онлайн-партии: namespace /play, JWT в handshake (docs/PLAY_API.md)
initializePlaySocket(io);

const PORT = process.env.PORT || 5000;

const start = () => {
    try {
        server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
    } catch (err) {
        console.log(err);
    }
};

start();