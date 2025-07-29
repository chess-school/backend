// v2/routes/admin.routes.js

const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const adminController = require('../controllers/admin.controller');
const validateRequest = require('../middleware/validateRequest');

// Применяем глобальные мидлвары для всех админских роутов
router.use(authMiddleware);
router.use(roleMiddleware(['ADMIN']));

// =================================================================
//                      РОУТЫ ДЛЯ РЕСУРСА "USER"
// =================================================================

/**
 * @route   GET /api/v2/admin/users
 * @desc    Получить пользователей по фильтрам (uuid, email, role)
 */
router.get(
    '/users', 
    adminController.getUsers
);

/**
 * @route   PATCH /api/v2/admin/users/roles
 * @desc    Изменить роли пользователя (uuid передается в query)
 */
router.patch(
    '/users/roles',
    [
        validateRequest('uuid'),  
        validateRequest('roles'), 
    ],
    adminController.updateUserRoles
);

/**
 * @route   PATCH /api/v2/admin/users/verify-coach
 * @desc    Верифицировать пользователя (uuid передается в query)
 */
router.patch(
    '/users/verify-coach',
    validateRequest('uuid'),
    adminController.verifyCoach
);

// Для ясности, давайте добавим пустой "/users/" роут, 
// чтобы он не конфликтовал с более специфичными.
router.use('/users', (req, res, next) => next());


module.exports = withErrorHandling(router);