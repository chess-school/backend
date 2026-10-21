// v2/middleware/validate.js

const { validationResult } = require('express-validator');

/**
 * Запускает цепочки express-validator. При ошибках:
 *   - только в параметрах пути (битый id/uuid в URL) — 400 INVALID_ID: это ошибка запроса;
 *   - иначе — 422 VALIDATION_ERROR: данные запроса не прошли проверку.
 * Ответ: { msg, code, details: [{ field, message, location }] }
 * Использование: router.post('/', validate([body('email').isEmail()]), controller)
 */
const validate = (chains) => async (req, res, next) => {
    for (const chain of chains) {
        await chain.run(req);
    }
    const result = validationResult(req);
    if (result.isEmpty()) return next();

    // Одно сообщение на поле — первое, остальные обычно следствие
    const seen = new Set();
    const details = [];
    for (const error of result.array()) {
        const key = `${error.location}:${error.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        details.push({ field: error.path, message: error.msg, location: error.location });
    }

    if (details.every((d) => d.location === 'params')) {
        return res.status(400).json({ msg: details[0].message, code: 'INVALID_ID', details });
    }
    return res.status(422).json({ msg: 'Validation failed.', code: 'VALIDATION_ERROR', details });
};

module.exports = validate;
