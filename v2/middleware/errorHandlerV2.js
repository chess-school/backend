const errorHandler = (handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (error) {
        console.error('V2 Controller Error:', error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            message: error.message || 'An unexpected server error occurred.',
            // stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
    }
};

module.exports = errorHandler;