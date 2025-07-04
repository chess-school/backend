const errorHandler = (handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ msg: 'Server error', error: error.message });
    }
};

module.exports = errorHandler;
