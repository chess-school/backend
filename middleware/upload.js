const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb({ message: 'Неподдерживаемый формат файла. Пожалуйста, загружайте только изображения.', code: 'LIMIT_UNEXPECTED_FILE' }, false);
  }
};

const upload = multer({
  storage: storage, 
  limits: {
    fileSize: 1024 * 1024 * 5, 
  },
  fileFilter: fileFilter,
});

module.exports = upload;