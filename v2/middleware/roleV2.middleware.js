// v2/middleware/roleV2.middleware.js
module.exports = function (requiredRoles) {
    return function (req, res, next) {
        if (!req.user || !req.user.roles) {
             return res.status(403).json({ message: "Access denied. No user roles found." });
        }

        const hasRole = req.user.roles.some(role => requiredRoles.includes(role));
        
        if (!hasRole) {
            return res.status(403).json({ message: "Access denied. You do not have permission." });
        }
        next();
    };
};