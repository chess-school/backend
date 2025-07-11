const errorHandler = (handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (error) {
        console.error('Ошибка:', error);
        const message = process.env.NODE_ENV === 'production'
            ? 'Internal Server Error'
            : error.message;
        res.status(500).json({ msg: 'Server error', error: message });
    }
};

module.exports = errorHandler;