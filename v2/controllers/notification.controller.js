const notifRepo = require('../repositories/notification.repo'); // шов notification (mongo|pg по NOTIF_DB)

/**
 * @desc    Получить все уведомления для текущего пользователя
 * @route   GET /api/v2/notifications
 * @access  Private
 */
const getMyNotifications = async (req, res) => {
    const [notifications, unreadCount] = await Promise.all([
        notifRepo.listForRecipient(req.user.id, 50),
        notifRepo.countUnread(req.user.id),
    ]);
    res.json({
        data: notifications,
        pagination: { limit: 50 },
        unreadCount,
    });
};

/**
 * @desc    Пометить одно уведомление как прочитанное по его ID
 * @route   PATCH /api/v2/notifications/:notificationId/read
 * @access  Private
 */
const markAsRead = async (req, res) => {
    const notification = await notifRepo.markRead(req.params.notificationId, req.user.id);
    if (!notification) {
        return res.status(404).json({ msg: 'Notification not found or you do not have access to it.' });
    }
    res.json(notification);
};

/**
 * @desc    Пометить ВСЕ уведомления как прочитанные
 * @route   POST /api/v2/notifications/read-all
 * @access  Private
 */
const markAllAsRead = async (req, res) => {
    await notifRepo.markAllRead(req.user.id);
    res.json({ msg: 'All notifications have been marked as read.' });
};

/**
 * @desc    Удалить одно уведомление по его ID
 * @route   DELETE /api/v2/notifications/:notificationId
 * @access  Private
 */
const deleteNotification = async (req, res) => {
    const result = await notifRepo.remove(req.params.notificationId, req.user.id);
    if (!result) {
        return res.status(404).json({ msg: 'Notification not found or you do not have access to it.' });
    }
    res.json({ msg: 'Notification deleted successfully.' });
};

module.exports = {
    getMyNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
};
