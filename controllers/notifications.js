const Notification = require('../models/Notification');

class notificationsController {

    async createNotification(req, res) {
        try {
            const { recipient, type, content } = req.body;
    
            if (!recipient || !type || !content) {
                return res.status(400).json({ msg: 'Все поля обязательны' });
            }
    
            const notification = new Notification({
                recipient,
                type,
                content,
            });
    
            await notification.save();
            res.status(201).json(notification);
        } catch (error) {
            console.error('Ошибка при создании уведомления:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }
    
    async getNotifications(req, res) {
        try {
            const userId = req.user.id;
            const notifications = await Notification.find({ recipient: userId }).sort({ createdAt: -1 });
            res.status(200).json(notifications);
        } catch (error) {
            console.error('Ошибка при получении уведомлений:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }

    async markAsRead(req, res) {
        try {
            const { notification_id } = req.query;
            if (!notification_id) {
                return res.status(400).json({ msg: 'ID уведомления обязателен' });
            }
    
            const notification = await Notification.findById(notification_id);
    
            if (!notification) {
                return res.status(404).json({ msg: 'Уведомление не найдено' });
            }
    
            if (notification.recipient.toString() !== req.user.id) {
                return res.status(403).json({ msg: 'У вас нет доступа к этому уведомлению' });
            }
    
            notification.read = true;
            await notification.save();
            res.status(200).json({ msg: 'Уведомление помечено как прочитанное' });
        } catch (error) {
            console.error('Ошибка при обновлении уведомления:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }    

    async deleteNotification(req, res) {
        try {
            const { notification_id } = req.query;
            if (!notification_id) {
                return res.status(400).json({ msg: 'ID уведомления обязателен' });
            }
    
            const notification = await Notification.findById(notification_id);
    
            if (!notification) {
                return res.status(404).json({ msg: 'Уведомление не найдено' });
            }
    
            if (notification.recipient.toString() !== req.user.id) {
                return res.status(403).json({ msg: 'У вас нет доступа к этому уведомлению' });
            }
    
            await Notification.findByIdAndDelete(notification_id);
            res.status(200).json({ msg: 'Уведомление удалено' });
        } catch (error) {
            console.error('Ошибка при удалении уведомления:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }
    
}

module.exports = new notificationsController();
