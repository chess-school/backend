const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MessageSchema = new Schema({
    conversation: {
        type: Schema.Types.ObjectId,
        ref: 'ConversationV2',
        required: true,
        index: true,
    },
    sender: { // Кто отправил
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    text: { // Текст сообщения
        type: String,
        required: true
    },
    // readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }] // для статусов "прочитано"
}, { timestamps: true });

module.exports = mongoose.model('MessageV2', MessageSchema, 'messages');