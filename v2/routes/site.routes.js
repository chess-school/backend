// v2/routes/site.routes.js — настройки сайта клуба (мульти-арендность #7, шаг 1 + экран настроек)
const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const optionalAuth = require('../middleware/optionalAuthV2.middleware');
const authMiddleware = require('../middleware/authV2.middleware');
const resolveClub = require('../middleware/resolveClubV2.middleware');
const { forbidden } = require('../utils/apiError');
const siteController = require('../controllers/site.controller');

// Только владелец клуба может править настройки сайта.
const requireOwner = (req, res, next) => {
    if (req.clubRole !== 'owner') return next(forbidden('Only the club owner can edit site settings.', 'NOT_CLUB_OWNER'));
    next();
};

// ПУБЛИЧНЫЙ бренд/тексты/соцсети активного клуба (по ?slug= или X-Club-Id для залогиненного).
router.get('/settings', optionalAuth, siteController.getSettings);

// Сырые сохранённые настройки для формы в консоли (вход + активный клуб).
router.get('/settings/admin', authMiddleware, resolveClub, resolveClub.requireClub, siteController.getAdminSettings);

// Сохранить настройки сайта (только владелец активного клуба).
router.patch('/settings', authMiddleware, resolveClub, resolveClub.requireClub, requireOwner, siteController.updateSettings);

module.exports = withErrorHandling(router);
