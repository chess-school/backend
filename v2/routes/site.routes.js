// v2/routes/site.routes.js — настройки сайта клуба (мульти-арендность #7, шаг 1 + экран настроек)
const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const optionalAuth = require('../middleware/optionalAuthV2.middleware');
const authMiddleware = require('../middleware/authV2.middleware');
const resolveClub = require('../middleware/resolveClubV2.middleware');
const { param } = require('express-validator');
const validate = require('../middleware/validate');
const uploadImage = require('../middleware/uploadImage');
const { forbidden } = require('../utils/apiError');
const siteController = require('../controllers/site.controller');
const mediaController = require('../controllers/media.controller');

// Только владелец клуба может править настройки сайта.
const requireOwner = (req, res, next) => {
    if (req.clubRole !== 'owner') return next(forbidden('Only the club owner can edit site settings.', 'NOT_CLUB_OWNER'));
    next();
};

// Медиатекой управляет персонал клуба (владелец или тренер) — им же нужны картинки для статей/страниц.
const requireStaff = (req, res, next) => {
    if (req.clubRole === 'owner' || req.clubRole === 'trainer') return next();
    next(forbidden('Only club staff can manage media.', 'NOT_CLUB_STAFF'));
};

// ПУБЛИЧНЫЙ бренд/тексты/соцсети активного клуба (по ?slug= или X-Club-Id для залогиненного).
router.get('/settings', optionalAuth, siteController.getSettings);

// Сырые сохранённые настройки для формы в консоли (вход + активный клуб).
router.get('/settings/admin', authMiddleware, resolveClub, resolveClub.requireClub, siteController.getAdminSettings);

// Сохранить настройки сайта (только владелец активного клуба).
router.patch('/settings', authMiddleware, resolveClub, resolveClub.requireClub, requireOwner, siteController.updateSettings);

// --- Медиатека клуба (шаг 2) ----------------------------------------------------------------------

// ПУБЛИЧНАЯ отдача файла по ключу (драйвер mongo). Регистрируем до /media/:id, чтобы не конфликтовать.
router.get('/media/file/*', mediaController.serveFile);

// Список медиа активного клуба (персонал клуба).
router.get('/media', authMiddleware, resolveClub, resolveClub.requireClub, requireStaff, mediaController.listMedia);

// Загрузить изображение (multipart/form-data, поле `file`; необязательный `alt`).
router.post('/media', authMiddleware, resolveClub, resolveClub.requireClub, requireStaff, uploadImage, mediaController.uploadMedia);

// Удалить своё медиа.
router.delete('/media/:id', authMiddleware, resolveClub, resolveClub.requireClub, requireStaff,
    validate([param('id').isMongoId().withMessage('id must be a valid id')]), mediaController.deleteMedia);

module.exports = withErrorHandling(router);
