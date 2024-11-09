const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
    if (req.method === "OPTIONS") {
        return next();
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(403).json({ message: "Токен не передан, доступ запрещён" });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(403).json({ message: "Токен отсутствует, доступ запрещён" });
        }

        const decodedData = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decodedData;
        next();
    } catch (e) {
        console.error("Ошибка авторизации:", e.message);
        return res.status(403).json({ message: "Неверный токен, доступ запрещён" });
    }
};
