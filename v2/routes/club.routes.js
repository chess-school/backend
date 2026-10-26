// v2/routes/club.routes.js — клубы (мульти-арендность #7)
const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const optionalAuth = require('../middleware/optionalAuthV2.middleware');
const resolveClub = require('../middleware/resolveClubV2.middleware');
const validate = require('../middleware/validate');
const clubController = require('../controllers/club.controller');

// Публичная витрина клуба для сайта /c/<slug> (бренд + тренеры + членство, если залогинен)
router.get('/by-slug/:slug', optionalAuth, clubController.getBySlug);

// Клубы текущего пользователя (переключатель клуба)
router.get('/mine', authMiddleware, clubController.getMyClubs);

// Реальная сводка активного клуба для консоли владельца
router.get('/overview', authMiddleware, resolveClub, resolveClub.requireClub, clubController.getOverview);

// Создать клуб (онбординг «Załóż klub») — создатель становится владельцем
router.post(
    '/',
    authMiddleware,
    validate([
        body('name').isString().withMessage('name is required').bail().trim().isLength({ min: 2, max: 120 }).withMessage('name must be 2–120 characters'),
        body('slug').optional().isString().trim().isLength({ max: 40 }),
        body('city').optional().isString().trim().isLength({ max: 120 }),
        body('plan').optional().isIn(['start', 'club', 'academy']).withMessage('plan must be start|club|academy'),
        body('brand.primaryColor').optional().isString().trim(),
    ]),
    clubController.createClub,
);

// Детали клуба (только участнику)
router.get('/:clubId', authMiddleware, validate([param('clubId').isMongoId().withMessage('clubId must be a valid id')]), clubController.getClub);

module.exports = withErrorHandling(router);
