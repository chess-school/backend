const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    type: {
        type: String,
        enum: [ 
            'request',
            'statusUpdate',
            'homework_submission',
            'homework_reviewed', 
            'system',           
            'reminder'           
        ],
        required: true,
    },
    content: {
        type: String,
        required: true,
    },
    metadata: {
        type: Object,
        default: {},
    },
    read: {
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('Notification', NotificationSchema);
