const validateRequest = (fields) => (req, res, next) => {
    const fieldsToCheck = Array.isArray(fields) ? fields : [fields];

    for (const field of fieldsToCheck) {
        if (
            (req.body && req.body[field] !== undefined) ||
            (req.query && req.query[field] !== undefined) ||
            (req.params && req.params[field] !== undefined)
        ) {
            continue;
        }
        return res.status(400).json({ msg: `Field '${field}' is required.` });
    }
    next();
};

module.exports = validateRequest;