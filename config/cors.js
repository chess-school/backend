// Разрешённые источники — общие для Express и socket.io
const whitelist = [
    'http://localhost:3002',
    'http://localhost:3001',
    'http://localhost:5173',
].filter(Boolean);

const vercelPreviewRegex = /^https:\/\/new-front-u2qi-[a-z0-9]+-nikitas-projects-27f00a22\.vercel\.app$/;

/** Запросы из белого списка, превью Vercel и без Origin (Postman, curl) */
const isAllowedOrigin = (origin) => !origin || whitelist.includes(origin) || vercelPreviewRegex.test(origin);

const corsOptions = {
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) callback(null, true);
        else callback(new Error('This origin is not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = { corsOptions, isAllowedOrigin };
