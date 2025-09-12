const Notification = require('../models/Notification'); // Ссылка на V2 модель, которая у вас названа NotificationV2

/**
 * @desc    Получить все уведомления для текущего пользователя
 * @route   GET /api/v2/notifications
 * @access  Private
 */
const getMyNotifications = async (req, res) => {
    // Находим все уведомления для пользователя, который отправил запрос
    const notifications = await Notification.find({ recipient: req.user.id })
        .sort({ createdAt: -1 })
        .limit(50); // Добавим лимит, чтобы не отправлять слишком много данных
    
    // Также посчитаем количество непрочитанных для отображения индикатора
    const unreadCount = await Notification.countDocuments({
        recipient: req.user.id,
        read: false
    });

    res.json({
        data: notifications,
        pagination: { // Добавим базовую информацию
            limit: 50
        },
        unreadCount
    });
};


/**
 * @desc    Пометить одно уведомление как прочитанное по его ID
 * @route   PATCH /api/v2/notifications/:notificationId/read
 * @access  Private
 */
const markAsRead = async (req, res) => {
    const { notificationId } = req.params;
    
    const notification = await Notification.findOneAndUpdate(
        // Найти можно, только если я являюсь получателем
        { _id: notificationId, recipient: req.user.id }, 
        { read: true },
        { new: true } // Вернуть обновленный документ
    );

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
    await Notification.updateMany(
        // Найти все непрочитанные уведомления для текущего пользователя
        { recipient: req.user.id, read: false },
        // И обновить у них статус
        { read: true }
    );

    res.json({ msg: 'All notifications have been marked as read.' });
};


/**
 * @desc    Удалить одно уведомление по его ID
 * @route   DELETE /api/v2/notifications/:notificationId
 * @access  Private
 */
const deleteNotification = async (req, res) => {
    const { notificationId } = req.params;
    
    // Удалить можно, только если я являюсь получателем
    const result = await Notification.findOneAndDelete({ 
        _id: notificationId, 
        recipient: req.user.id 
    });
    
    if (!result) {
         return res.status(404).json({ msg: 'Notification not found or you do not have access to it.' });
    }

    res.json({ msg: 'Notification deleted successfully.' });
};


module.exports = {
    getMyNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification
};