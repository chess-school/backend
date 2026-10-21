// v2/middleware/roleV2.middleware.js
// Пускает пользователя, у которого есть хотя бы одна из requiredRoles. Ставится после authV2.
module.exports = function (requiredRoles) {
    return function (req, res, next) {
        if (!req.user || !req.user.roles) {
            return res.status(401).json({ msg: 'Auth token is required.', code: 'TOKEN_REQUIRED' });
        }

        const hasRole = req.user.roles.some(role => requiredRoles.includes(role));

        if (!hasRole) {
            return res.status(403).json({
                msg: `Access denied. Required role: ${requiredRoles.join(' or ')}.`,
                code: 'FORBIDDEN_ROLE',
            });
        }
        next();
    };
};
