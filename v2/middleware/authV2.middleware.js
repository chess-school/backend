// v2/middleware/authV2.middleware.js
// Проверка токена — в v2/utils/accessToken.js (та же логика у сокетов чата).
const { verifyAccessToken } = require('../utils/accessToken');

module.exports = async function (req, res, next) {
    if (req.method === "OPTIONS") {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ msg: 'Auth token is required.', code: 'TOKEN_REQUIRED' });
    }

    try {
        req.user = await verifyAccessToken(authHeader.split(' ')[1]);
    } catch (e) {
        return res.status(e.status || 500).json({ msg: e.message, code: e.code || 'INTERNAL_ERROR' });
    }
    next();
};
