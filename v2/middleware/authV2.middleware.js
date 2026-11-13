// v2/middleware/authV2.middleware.js
// Проверка токена — в v2/utils/accessToken.js (та же логика у сокетов чата).
const { verifyAccessToken } = require('../utils/accessToken');
const { tokenFromRequest } = require('../utils/authCookie');

module.exports = async function (req, res, next) {
    if (req.method === "OPTIONS") {
        return next();
    }

    // Токен из HttpOnly-cookie или из заголовка Authorization: Bearer (обратная совместимость).
    const token = tokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ msg: 'Auth token is required.', code: 'TOKEN_REQUIRED' });
    }

    try {
        req.user = await verifyAccessToken(token);
    } catch (e) {
        return res.status(e.status || 500).json({ msg: e.message, code: e.code || 'INTERNAL_ERROR' });
    }
    next();
};
