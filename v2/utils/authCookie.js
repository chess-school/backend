// v2/utils/authCookie.js
//
// HttpOnly-cookie транспорт для access-токена (пентест 13.11: уводим JWT из localStorage).
// Авторизация остаётся совместимой: токен берётся из cookie ИЛИ из заголовка Authorization: Bearer
// (старые вкладки с токеном в localStorage продолжают работать до перелогина).
//
// Установка cookie — встроенный res.cookie() Express (cookie-parser НЕ нужен для записи).
// Чтение входящих cookie — свой мини-парсер (нулевая зависимость), т.к. cookie-parser не подключён.

const COOKIE_NAME = 'accessToken';
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // как срок JWT (6h)

/**
 * Атрибуты cookie. secure берём из req.secure: за nginx (trust proxy=1 + X-Forwarded-Proto)
 * в проде это true (https), в локальной http-разработке — false, чтобы cookie ставилась.
 * sameSite='strict' достаточно против CSRF: фронт и API на одном origin (chess.motorcycles).
 */
const cookieOptions = (req) => ({
    httpOnly: true,
    secure: req ? !!req.secure : true,
    sameSite: 'strict',
    path: '/',
});

const setAuthCookie = (res, token, req) => {
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: MAX_AGE_MS });
};

const clearAuthCookie = (res, req) => {
    // Атрибуты должны совпадать с установкой, иначе браузер не удалит cookie.
    res.clearCookie(COOKIE_NAME, cookieOptions(req));
};

/** Разбор строки заголовка Cookie в объект { name: value }. */
const parseCookies = (cookieHeader) => {
    const out = {};
    if (!cookieHeader || typeof cookieHeader !== 'string') return out;
    for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        if (!key) continue;
        const val = part.slice(idx + 1).trim();
        try {
            out[key] = decodeURIComponent(val);
        } catch {
            out[key] = val;
        }
    }
    return out;
};

/** Токен из HTTP-запроса: сначала Bearer-заголовок, затем cookie. null — нет токена. */
const tokenFromRequest = (req) => {
    const header = req.headers && req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        return header.slice(7);
    }
    const cookieHeader = req.headers && req.headers.cookie;
    return parseCookies(cookieHeader)[COOKIE_NAME] || null;
};

/** Токен из socket.io-рукопожатия: handshake.auth.token, затем cookie из заголовков. */
const tokenFromHandshake = (handshake) => {
    if (handshake && handshake.auth && handshake.auth.token) {
        return handshake.auth.token;
    }
    const cookieHeader = handshake && handshake.headers && handshake.headers.cookie;
    return parseCookies(cookieHeader)[COOKIE_NAME] || null;
};

module.exports = {
    COOKIE_NAME,
    setAuthCookie,
    clearAuthCookie,
    parseCookies,
    tokenFromRequest,
    tokenFromHandshake,
};
