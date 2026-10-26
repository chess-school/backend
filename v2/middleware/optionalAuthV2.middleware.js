// v2/middleware/optionalAuthV2.middleware.js
// Мягкая аутентификация: если валидный Bearer-токен передан — заполняет req.user ({ id, uuid, roles }),
// иначе просто пропускает запрос как гостевой (req.user остаётся undefined).
// Используется на публичных роутах, где ответ зависит от роли (каталог курсов и т.п.).
const { verifyAccessToken } = require('../utils/accessToken');

module.exports = async function (req, res, next) {
    if (req.method === 'OPTIONS') {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(); // гость
    }

    try {
        req.user = await verifyAccessToken(authHeader.split(' ')[1]);
    } catch (e) {
        // Токен есть, но невалиден/протух — не падаем, обслуживаем как гостя.
        req.user = undefined;
    }
    next();
};
