// v2/models/ChatMessage.js
// Сообщение личного диалога. Получатель в комнате один, поэтому статус «прочитано» — одно поле readAt.

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MAX_TEXT = 4000;

const ChatMessageSchema = new Schema({
    room: { type: Schema.Types.ObjectId, ref: 'ChatRoom', required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },
    text: { type: String, required: true, trim: true, maxlength: MAX_TEXT },
    /** Когда прочитал собеседник; null — не прочитано */
    readAt: { type: Date, default: null },
    /** Временный id отправителя: подтверждение оптимистичной отправки без дублей */
    clientId: { type: String, maxlength: 64 },
}, { timestamps: true });

// История диалога по курсору (createdAt, _id)
ChatMessageSchema.index({ room: 1, createdAt: -1, _id: -1 });
// Непрочитанные: сообщения собеседника без readAt
ChatMessageSchema.index({ room: 1, readAt: 1, sender: 1 });

ChatMessageSchema.statics.MAX_TEXT = MAX_TEXT;

module.exports = mongoose.model('ChatMessage', ChatMessageSchema, 'chat_messages');
