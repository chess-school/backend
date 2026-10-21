// v2/middleware/uploadImage.js
// Один необязательный файл-изображение в поле `file` (multipart/form-data), в память, до 5 МБ.
// Ошибки — в формате API v2: слишком большой файл -> 413, не картинка -> 422.

const multer = require('multer');

const MAX_SIZE_MB = 5;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE_MB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
        const error = new Error(`Only images are allowed: ${ALLOWED_TYPES.join(', ')}.`);
        error.code = 'UNSUPPORTED_FILE_TYPE';
        return cb(error);
    },
}).single('file');

module.exports = (req, res, next) => upload(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ msg: `The file is larger than ${MAX_SIZE_MB} MB.`, code: 'FILE_TOO_LARGE' });
    }
    if (error.code === 'UNSUPPORTED_FILE_TYPE') {
        return res.status(422).json({ msg: error.message, code: 'UNSUPPORTED_FILE_TYPE', details: [{ field: 'file', message: error.message, location: 'body' }] });
    }
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ msg: error.message, code: 'BAD_UPLOAD' });
    }
    return next(error);
});
