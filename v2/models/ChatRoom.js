// v2/models/ChatRoom.js
//
// Личный диалог двух пользователей (тренер ↔ его ученик). На одну пару и один контекст —
// одна комната: «Общий чат» (direct) плюс, по желанию, отдельные диалоги по задаче/домашке/книге.
// Уникальность — по key: отсортированные id участников + контекст.

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CONTEXT_KINDS = ['direct', 'puzzle', 'homework', 'book'];

const ChatContextSchema = new Schema({
    kind: { type: String, enum: CONTEXT_KINDS, default: 'direct' },
    /** id задачи / задания / книги — строка: у задач Lichess id не ObjectId */
    refId: { type: String, trim: true, maxlength: 100 },
    /** Подпись для шапки диалога («Задача #123», «Домашка: Ладейные окончания») */
    title: { type: String, trim: true, maxlength: 200 },
}, { _id: false });

const ChatRoomSchema = new Schema({
    members: {
        type: [{ type: Schema.Types.ObjectId, ref: 'TestUser' }],
        validate: { validator: (v) => Array.isArray(v) && v.length === 2 && String(v[0]) !== String(v[1]), message: 'A chat room has exactly two different members.' },
    },
    key: { type: String, required: true },
    context: { type: ChatContextSchema, default: () => ({ kind: 'direct' }) },
    lastMessage: {
        text: String,
        sender: { type: Schema.Types.ObjectId, ref: 'TestUser' },
        createdAt: Date,
    },
    lastMessageAt: { type: Date, default: null },
}, { timestamps: true });

ChatRoomSchema.index({ key: 1 }, { unique: true });
// Список диалогов пользователя: свежие сверху
ChatRoomSchema.index({ members: 1, lastMessageAt: -1 });

/** Ключ уникальности комнаты для пары и контекста */
ChatRoomSchema.statics.keyFor = (a, b, context = {}) => {
    const pair = [String(a), String(b)].sort().join(':');
    const kind = context.kind || 'direct';
    return kind === 'direct' ? `${pair}:direct` : `${pair}:${kind}:${context.refId || ''}`;
};

ChatRoomSchema.statics.CONTEXT_KINDS = CONTEXT_KINDS;

module.exports = mongoose.model('ChatRoom', ChatRoomSchema, 'chat_rooms');
