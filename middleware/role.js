const jwt = require('jsonwebtoken')
const { tokenFromRequest } = require('../v2/utils/authCookie')

module.exports = function (roles) {
    return function (req, res, next) {
        if (req.method === "OPTIONS") {
            return next()
        }

        try {
            // Токен из HttpOnly-cookie или Bearer-заголовка.
            const token = tokenFromRequest(req)
            if (!token) {
                return res.status(403).json({message: req.t('api.auth.notAuthorized')})
            }
            const {roles: userRoles} = jwt.verify(token, process.env.JWT_SECRET)
            let hasRole = false
            userRoles.forEach(role => {
                if (roles.includes(role)) {
                    hasRole = true
                }
            })
            if (!hasRole) {
                return res.status(403).json({message: req.t('api.auth.accessDenied')})
            }
            next();
        } catch (e) {
            console.log(e)
            return res.status(403).json({message: req.t('api.auth.notAuthorized')})
        }
    }
};