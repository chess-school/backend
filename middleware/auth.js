const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
    if (req.method === "OPTIONS") {
        next();
    }

    try {
        if (!req.headers.authorization) {
            return res.status(403).json({ message: "Пользователь не авторизован, токен не передан" });
        }

        const token = req.headers.authorization.split(' ')[1]; // Bearer <token>
        if (!token) {
            return res.status(403).json({ message: "Пользователь не авторизован, токен отсутствует" });
        }

        const decodedData = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decodedData;
        next();
    } catch (e) {
        console.log(e);
        return res.status(403).json({ message: "Пользователь не авторизован, ошибка в токене" });
    }
};
