// v2/controllers/notification.controller.js

const Notification = require('../models/Notification'); // Ссылка на V2 модель

/**
 * @desc    Получить все уведомления для текущего пользователя
 * @route   GET /api/v2/notifications
 * @access  Private
 */
const getMyNotifications = async (req, res) => {
    const notifications = await Notification.find({ recipient: req.user.id })
                                            .sort({ createdAt: -1 })
                                            .limit(50); // Добавим лимит, чтобы не загружать тысячи
    
    // Подсчитаем количество непрочитанных для удобства фронтенда
    const unreadCount = await Notification.countDocuments({ recipient: req.user.id, read: false });

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

    const notification = await Notification.findOneAndUpdate(
        // Находим, только если я получатель
        { _id: notificationId, recipient: req.user.id }, 
        { read: true },
        { new: true }
    );

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
    await Notification.updateMany(
        { recipient: req.user.id, read: false },
        { read: true }
    );
    res.json({ msg: 'All notifications marked as read.' });
};


/**
 * @desc    Удалить одно уведомление
 * @route   DELETE /api/v2/notifications/:notificationId
 * @access  Private
 */
const deleteNotification = async (req, res) => {
    const { notificationId } = req.params;

    const result = await Notification.findOneAndDelete({ 
        _id: notificationId, 
        recipient: req.user.id 
    });
    
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