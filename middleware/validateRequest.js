const validateRequest = (fields) => (req, res, next) => {
    for (const field of fields) {
        if (!req.body[field] && !req.query[field] && !req.params[field]) {
            return res.status(400).json({ msg: `${field} is required` });
        }
    }
    next();
};

module.exports = validateRequest;
