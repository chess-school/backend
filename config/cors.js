// Разрешённые источники — общие для Express и socket.io.
// На сервере боевой домен фронтенда задаётся в CORS_ORIGINS (через запятую, без / в конце)
const fromEnv = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const whitelist = [
    'http://localhost:3002',
    'http://localhost:3001',
    'http://localhost:5173',
    ...fromEnv,
];

const vercelPreviewRegex = /^https:\/\/new-front-u2qi-[a-z0-9]+-nikitas-projects-27f00a22\.vercel\.app$/;

/** Запросы из белого списка, превью Vercel и без Origin (Postman, curl) */
const isAllowedOrigin = (origin) => !origin || whitelist.includes(origin) || vercelPreviewRegex.test(origin);

const corsOptions = {
    origin: (origin, callback) => {
        // Запрещённый origin отклоняем МЯГКО (без CORS-заголовков), а не через throw:
        // callback(new Error()) уходил в error-handler и отдавал 500 INTERNAL_ERROR со стеком в логах
        // на каждый кросс-доменный запрос с чужого origin. callback(null, false) = браузер сам блокирует
        // ответ (нет Access-Control-Allow-Origin), а сервер отвечает штатно, без 500 и без шума в логах.
        callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = { corsOptions, isAllowedOrigin };
