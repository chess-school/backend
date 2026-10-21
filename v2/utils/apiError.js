// v2/utils/apiError.js

/**
 * Ошибка API с HTTP-статусом и машиночитаемым кодом.
 * Бросается из контроллеров/сервисов и превращается errorHandlerV2 в ответ
 *   { msg: 'Человекочитаемое сообщение', code: 'STUDENT_NOT_FOUND', details?: [...] }
 * Поле называется msg — его уже показывает фронтенд (перехватчик axios).
 */
class ApiError extends Error {
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        if (details) this.details = details;
    }
}

const badRequest = (message, code = 'BAD_REQUEST', details) => new ApiError(400, code, message, details);
const forbidden = (message = 'You do not have permission to perform this action.', code = 'FORBIDDEN') =>
    new ApiError(403, code, message);
const notFound = (message, code = 'NOT_FOUND') => new ApiError(404, code, message);
const conflict = (message, code = 'CONFLICT') => new ApiError(409, code, message);
const unprocessable = (message, code = 'VALIDATION_ERROR', details) => new ApiError(422, code, message, details);

module.exports = { ApiError, badRequest, forbidden, notFound, conflict, unprocessable };
