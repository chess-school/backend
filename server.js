const express = require('express');
const http = require('http');
// .env — до подключения модулей: часть из них читает окружение при загрузке (CORS_ORIGINS, Stripe).
// override: true — .env имеет приоритет над переменными, которые PM2 инжектит из ecosystem.config.js
// (иначе REDIS_URL из ecosystem затеняет пароль из .env, и клиент Redis падает с NOAUTH).
require('dotenv').config({ override: true });
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/db');
const i18nextMiddleware = require('./config/i18n');
const initializeSocket = require('./sockets/game.sockets');
const initializeChatSocket = require('./sockets/chat.sockets');
const initializePlaySocket = require('./sockets/play.sockets');
const initializeClassroomSocket = require('./sockets/classroom.sockets');
const { corsOptions } = require('./config/cors');
const rateLimit = require('express-rate-limit');
const dns = require('dns');
dns.setServers(['8.8.8.8']);
connectDB();

const app = express();
// За nginx-реверс-прокси: доверяем первому прокси, чтобы req.ip брался из X-Forwarded-For.
// Иначе express-rate-limit видит один IP (127.0.0.1) на всех и лимитирует всех пользователей
// общим ведром (а также бросает ERR_ERL_UNEXPECTED_X_FORWARDED_FOR в лог).
app.set('trust proxy', 1);
const server = http.createServer(app);
// По умолчанию Node обрывает запрос через 5 мин вместе с телом — медленная загрузка книги
// на сотни МБ не успела бы дойти до прокси оцифровщика. headersTimeout (60 с) остаётся прежним.
server.requestTimeout = 30 * 60 * 1000;

// Security-заголовки. CSP выключен здесь (API не отдаёт SPA — её раздаёт nginx, где и задаётся CSP);
// crossOriginResourcePolicy=cross-origin, чтобы фронт с другого origin мог грузить аватары/картинки.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

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

// Строгий лимит на аутентификацию — против брутфорса паролей и спама письмами верификации.
// skipSuccessfulRequests: удачный логин не расходует лимит (не блокируем активного пользователя).
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: 'Too many authentication attempts from this IP, please try again after 15 minutes',
});
app.use([
    '/api/auth/login', '/api/auth/register', '/api/auth/resend-verification', '/api/auth/check-verification',
    '/api/v2/auth/login', '/api/v2/auth/register', '/api/v2/auth/resend-verification',
], authLimiter);

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
// Интерактивный класс: namespace /classroom, JWT в handshake (учебная доска + «поднять руку»)
initializeClassroomSocket(io);

const PORT = process.env.PORT || 5000;
// Слушаем только loopback — наружу приложение отдаёт nginx (reverse proxy).
// ВАЖНО: nginx должен проксировать на 127.0.0.1:PORT. Если прокси настроен на внешний IP —
// задать HOST=<ip> в .env, иначе бэкенд станет недоступен после рестарта.
const HOST = process.env.HOST || '127.0.0.1';

const start = () => {
    try {
        server.listen(PORT, HOST, () => console.log(`Server started on ${HOST}:${PORT}`));
    } catch (err) {
        console.log(err);
    }
};

start();