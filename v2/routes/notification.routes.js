// v2/routes/notification.routes.js
const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const notificationController = require('../controllers/notification.controller');

// Все роуты здесь требуют авторизации
router.use(authMiddleware);

// Получить все мои уведомления
router.get('/', notificationController.getMyNotifications);

// Пометить все как прочитанные
router.post('/read-all', notificationController.markAllAsRead);

// Пометить одно как прочитанное
router.patch('/:notificationId/read', notificationController.markAsRead);

// Удалить одно уведомление
router.delete('/:notificationId', notificationController.deleteNotification);


module.exports = withErrorHandling(router);