const jwt = require('jsonwebtoken')

module.exports = function (roles) {
    return function (req, res, next) {
        if (req.method === "OPTIONS") {
            return next()
        }

        try {
            const token = req.headers.authorization.split(' ')[1]
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