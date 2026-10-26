// v2/middleware/errorHandlerV2.js

const mongoose = require('mongoose');
const { ApiError } = require('../utils/apiError');

/**
 * Приводит любую ошибку к единому ответу { msg, code, details? } с правильным статусом:
 *   ApiError                 -> её statusCode/code
 *   Mongoose CastError       -> 400 (например, некорректный ObjectId в URL)
 *   Mongoose ValidationError -> 422 со списком полей
 *   duplicate key (11000)    -> 409
 *   битый JSON в теле        -> 400
 *   всё остальное            -> 500 без деталей (подробности только в логе сервера)
 */
/**
 * Переводит итоговое сообщение по коду ошибки через переводчик запроса (res.req.t).
 * Ключ: api.errors.<CODE>; defaultValue — исходный английский текст (на случай, если
 * перевод/переводчик недоступен). В перевод прокидываются поля из extra для интерполяции.
 * res.req может отсутствовать (ошибка до роутинга) — тогда возвращаем defaultValue как есть.
 */
const localize = (res, code, defaultValue, extra) => {
    const t = res && res.req && res.req.t;
    if (!t) return defaultValue;
    return t(`api.errors.${code}`, { defaultValue, ...(extra || {}) });
};

const toResponse = (error, res) => {
    if (error instanceof ApiError) {
        return {
            status: error.statusCode,
            body: { msg: localize(res, error.code, error.message), code: error.code, details: error.details },
        };
    }
    if (error instanceof mongoose.Error.CastError) {
        const def = `Invalid value for '${error.path}'.`;
        return { status: 400, body: { msg: localize(res, 'INVALID_ID', def, { path: error.path }), code: 'INVALID_ID' } };
    }
    if (error instanceof mongoose.Error.ValidationError) {
        const details = Object.values(error.errors).map((e) => ({ field: e.path, message: e.message }));
        return { status: 422, body: { msg: localize(res, 'VALIDATION_ERROR', 'Validation failed.'), code: 'VALIDATION_ERROR', details } };
    }
    if (error && error.code === 11000) {
        const fields = Object.keys(error.keyPattern || error.keyValue || {});
        const list = fields.join(', ') || 'unique field';
        const def = `Duplicate value for: ${list}.`;
        return { status: 409, body: { msg: localize(res, 'DUPLICATE', def, { fields: list }), code: 'DUPLICATE' } };
    }
    if (error && error.type === 'entity.parse.failed') {
        return { status: 400, body: { msg: localize(res, 'MALFORMED_JSON', 'Malformed JSON in request body.'), code: 'MALFORMED_JSON' } };
    }
    // Ошибки со statusCode < 500 (как в digitizer.service) — ожидаемые, их текст можно отдать
    if (error && error.statusCode && error.statusCode < 500) {
        return { status: error.statusCode, body: { msg: localize(res, 'REQUEST_ERROR', error.message), code: 'REQUEST_ERROR' } };
    }
    if (error && error.statusCode >= 500 && error.statusCode !== 500) {
        return { status: error.statusCode, body: { msg: localize(res, 'UPSTREAM_ERROR', error.message), code: 'UPSTREAM_ERROR' } };
    }
    return { status: 500, body: { msg: localize(res, 'INTERNAL_ERROR', 'An unexpected server error occurred.'), code: 'INTERNAL_ERROR' } };
};

const sendError = (error, res) => {
    const { status, body } = toResponse(error, res);
    if (status >= 500) console.error('V2 Controller Error:', error);
    if (body.details === undefined) delete body.details;
    res.status(status).json(body);
};

/** Обёртка контроллера: ловит исключения (в т.ч. из async) и отвечает единым форматом. */
const errorHandler = (handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (error) {
        sendError(error, res);
    }
};

/** Express error-middleware для /api/v2: ошибки до контроллера (битый JSON и т.п.). */
errorHandler.middleware = (error, req, res, next) => {
    if (res.headersSent) return next(error);
    sendError(error, res);
};

module.exports = errorHandler;
