// v2/utils/accessToken.js
//
// Проверка JWT доступа — общая для HTTP (authV2) и socket.io (чат):
// подпись и срок, пользователь существует, версия сессии совпадает (после нового входа
// старые токены недействительны). Роли — актуальные из БД, а не из токена.

const jwt = require('jsonwebtoken');
const UserV2 = require('../models/User');

class AccessTokenError extends Error {
    constructor(code, message, status = 401) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

/** -> { id, uuid, roles }; бросает AccessTokenError (status 401, или 500 при сбое БД) */
const verifyAccessToken = async (token) => {
    if (!token) throw new AccessTokenError('TOKEN_REQUIRED', 'Auth token is required.');

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
        throw e.name === 'TokenExpiredError'
            ? new AccessTokenError('TOKEN_EXPIRED', 'Session expired. Please log in again.')
            : new AccessTokenError('TOKEN_INVALID', 'Invalid token.');
    }

    let user;
    try {
        user = await UserV2.findById(decoded.id).select('sessionTokenVersion roles uuid');
    } catch (e) {
        // Сбой БД — это не «плохой токен»: 401 разлогинил бы всех при недоступности MongoDB
        console.error('Auth V2 Error:', e.message);
        throw new AccessTokenError('INTERNAL_ERROR', 'An unexpected server error occurred.', 500);
    }
    if (!user) throw new AccessTokenError('USER_NOT_FOUND', 'User not found.');
    if (user.sessionTokenVersion !== decoded.sessionTokenVersion) {
        throw new AccessTokenError('SESSION_REVOKED', 'Session expired. Please log in again.');
    }
    return { id: user._id.toString(), uuid: user.uuid, roles: user.roles };
};

module.exports = { verifyAccessToken, AccessTokenError };
