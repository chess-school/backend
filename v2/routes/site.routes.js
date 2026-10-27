// v2/routes/site.routes.js — публичные настройки сайта клуба (мульти-арендность #7, шаг 1)
const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const optionalAuth = require('../middleware/optionalAuthV2.middleware');
const siteController = require('../controllers/site.controller');

// Публичный бренд/тексты/соцсети активного клуба (по ?slug= или X-Club-Id для залогиненного).
// optionalAuth — чтобы учесть активный клуб вошедшего пользователя, но вход не обязателен.
router.get('/settings', optionalAuth, siteController.getSettings);

module.exports = withErrorHandling(router);
