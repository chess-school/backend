const errorHandler = (handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (error) {
        // Подробности только в логе сервера; клиенту — обобщённое сообщение (без утечки внутренних деталей).
        console.error('Ошибка:', error);
        res.status(500).json({ msg: 'Server error' });
    }
};

module.exports = errorHandler;
