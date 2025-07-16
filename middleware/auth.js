const jwt = require('jsonwebtoken');
const User = require('../models/User'); 

module.exports = async function (req, res, next) {
    if (req.method === "OPTIONS") {
        return next();
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ message: "Токен не передан, доступ запрещён" });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: "Токен отсутствует, доступ запрещён" });
        }

        const decodedData = jwt.verify(token, process.env.JWT_SECRET);
        
        const userFromDb = await User.findById(decodedData.id).select('sessionTokenVersion');

        if (!userFromDb) {
            return res.status(401).json({ message: "Пользователь не найден, доступ запрещён" });
        }

        if (userFromDb.sessionTokenVersion !== decodedData.sessionTokenVersion) {
            return res.status(401).json({ message: "Сессия истекла. Пожалуйста, войдите снова." });
        }
        
        req.user = decodedData; 
        next();

    } catch (e) {
        console.error("Ошибка авторизации:", e.message);
        return res.status(401).json({ message: "Неверный токен, доступ запрещён" });
    }
};