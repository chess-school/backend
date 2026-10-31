// v2/controllers/notification.controller.js

// Доступ к хранилищу — через репозиторий-шов (mongo|pg по флагу NOTIF_DB).
// См. v2/repositories/notification.repo.js и docs/postgres-migration/.
const repo = require('../repositories/notification.repo');

/**
 * @desc    Получить все уведомления для текущего пользователя
 * @route   GET /api/v2/notifications
 * @access  Private
 */
const getMyNotifications = async (req, res) => {
    const [notifications, unreadCount] = await Promise.all([
        repo.listForRecipient(req.user.id, 50), // лимит, чтобы не тянуть тысячи
        repo.countUnread(req.user.id),
    ]);

    res.json({
        data: notifications,
        unreadCount
    });
};


/**
 * @desc    Пометить одно уведомление как прочитанное
 * @route   PATCH /api/v2/notifications/:notificationId/read
 * @access  Private
 */
const markAsRead = async (req, res) => {
    const { notificationId } = req.params;

    const notification = await repo.markRead(notificationId, req.user.id);

    if (!notification) {
        return res.status(404).json({ msg: 'Notification not found or access denied.' });
    }

    res.json(notification);
};

/**
 * @desc    Пометить ВСЕ уведомления как прочитанные
 * @route   POST /api/v2/notifications/read-all
 * @access  Private
 */
const markAllAsRead = async (req, res) => {
    await repo.markAllRead(req.user.id);
    res.json({ msg: 'All notifications marked as read.' });
};


/**
 * @desc    Удалить одно уведомление
 * @route   DELETE /api/v2/notifications/:notificationId
 * @access  Private
 */
const deleteNotification = async (req, res) => {
    const { notificationId } = req.params;

    const result = await repo.remove(notificationId, req.user.id);

    if (!result) {
         return res.status(404).json({ msg: 'Notification not found or access denied.' });
    }

    res.json({ msg: 'Notification deleted.' });
};


module.exports = {
    getMyNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification
};