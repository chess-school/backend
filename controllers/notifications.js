const Notification = require('../models/Notification');

// 🔁 1. Создать уведомление
const createNotification = async (req, res) => {
  const { recipient, type, content, metadata } = req.body;

  const notification = new Notification({ recipient, type, content, metadata });
  await notification.save();

  res.status(201).json(notification);
};

// 🔁 2. Получить уведомления пользователя
const getNotifications = async (req, res) => {
  const userId = req.user.id;
  const notifications = await Notification.find({ recipient: userId }).sort({ createdAt: -1 });

  res.status(200).json(notifications);
};

// 🔁 3. Пометить уведомление как прочитанное
const markAsRead = async (req, res) => {
  const { notification_id } = req.query;

  const notification = await Notification.findById(notification_id);
  if (!notification) return res.status(404).json({ msg: 'Notification not found' });

  if (notification.recipient.toString() !== req.user.id) {
    return res.status(403).json({ msg: 'Access denied to this notification' });
  }

  notification.read = true;
  await notification.save();

  res.status(200).json({ msg: 'Notification marked as read' });
};

// 🔁 4. Удалить уведомление
const deleteNotification = async (req, res) => {
  const { notification_id } = req.query;

  const notification = await Notification.findById(notification_id);
  if (!notification) return res.status(404).json({ msg: 'Notification not found' });

  if (notification.recipient.toString() !== req.user.id) {
    return res.status(403).json({ msg: 'Access denied to this notification' });
  }

  await Notification.findByIdAndDelete(notification_id);

  res.status(200).json({ msg: 'Notification deleted' });
};

module.exports = {
  createNotification,
  getNotifications,
  markAsRead,
  deleteNotification,
};
