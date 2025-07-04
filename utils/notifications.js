const Notification = require('../models/Notification');

const createNotification = async (recipient, type, content, metadata = {}) => {
    const notification = new Notification({ recipient, type, content, metadata });
    await notification.save();
};

module.exports = { createNotification };
