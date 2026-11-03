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
const multer = require('multer');
// Документ для автогенерации сайта (.docx/.txt/.md) — в память, до 8 МБ.
const uploadDoc = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }).single('document');
const { forbidden } = require('../utils/apiError');
const siteController = require('../controllers/site.controller');
const mediaController = require('../controllers/media.controller');
const pageController = require('../controllers/sitePage.controller');

// Безопасный slug страницы в URL: буквы/цифры/дефис, 1–60 символов (напр. home, about, my-events).
const PAGE_SLUG = /^[a-z0-9-]{1,60}$/i;

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

// --- Страницы сайта из блоков (шаг 3) -------------------------------------------------------------

const slugParam = validate([param('slug').matches(PAGE_SLUG).withMessage('slug must be a valid page slug')]);

// Список страниц активного клуба (персонал). Регистрируем до /pages/:slug.
router.get('/pages', authMiddleware, resolveClub, resolveClub.requireClub, requireStaff, pageController.listPages);

// Черновик страницы для редактора (персонал). Две сегментации — отдельно от публичного /pages/:slug.
router.get('/pages/admin/:slug', authMiddleware, resolveClub, resolveClub.requireClub, requireStaff,
    slugParam, pageController.getAdminPage);

// ПУБЛИЧНАЯ опубликованная страница клуба (по ?slug=<clubSlug> или X-Club-Id залогиненного).
router.get('/pages/:slug', optionalAuth, slugParam, pageController.getPublicPage);

// Создать/перезаписать черновик страницы (только владелец).
router.put('/pages/:slug', authMiddleware, resolveClub, resolveClub.requireClub, requireOwner,
    slugParam, pageController.savePage);

// Автогенерация черновиков страниц из текста/документа/ссылок через `claude -p` (только владелец).
// Регистрируем ДО /pages/:slug/publish и /pages/:slug — у 'generate' нет :slug-коллизии.
router.post('/pages/generate', authMiddleware, resolveClub, resolveClub.requireClub, requireOwner,
    uploadDoc, pageController.generatePages);

// Опубликовать страницу (только владелец).
router.post('/pages/:slug/publish', authMiddleware, resolveClub, resolveClub.requireClub, requireOwner,
    slugParam, pageController.publishPage);

// Удалить страницу (только владелец).
router.delete('/pages/:slug', authMiddleware, resolveClub, resolveClub.requireClub, requireOwner,
    slugParam, pageController.deletePage);

module.exports = withErrorHandling(router);
