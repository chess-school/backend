// v2/models/Conversation.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ConversationSchema = new Schema({
    type: { // Личный или групповой
        type: String,
        enum: ['private', 'group'],
        required: true,
    },
    members: [{ // Массив участников
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    }],
    
    // Для групповых чатов можно добавить доп. информацию
    groupContext: { // Ссылка на нашу модель Group
        type: Schema.Types.ObjectId,
        ref: 'Group'
    },
    
    // Последнее сообщение (для превью в списке чатов)
    lastMessage: {
        text: String,
        sender: { type: Schema.Types.ObjectId, ref: 'User' },
        timestamp: Date,
    }
}, { timestamps: true });

module.exports = mongoose.model('ConversationV2', ConversationSchema, 'conversations');