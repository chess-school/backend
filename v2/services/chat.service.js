// v2/services/chat.service.js
//
// Личные сообщения тренер ↔ ученик поверх учебного модуля.
// Кто с кем может переписываться (canChat):
//   пара «тренер — его ученик»: TrainingContract.coach = профиль Coach тренера, student = ученик,
//   статус записи не cancelled/refunded (как «мои студенты» в модуле students);
//   ADMIN — с любым пользователем (поддержка).
// Чужая комната неотличима от несуществующей: 404 ROOM_NOT_FOUND, без утечки факта существования.
// Каждое изменение (REST или сокет) пишется в БД и рассылается участникам через chatRealtime.

const mongoose = require('mongoose');
const User = require('../models/User');
const Coach = require('../models/Coach');
const TrainingContract = require('../models/TrainingContract');
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');
const { badRequest, forbidden, notFound, unprocessable } = require('../utils/apiError');
const { emitToUsers } = require('./chatRealtime');

const { ObjectId } = mongoose.Types;

const CHAT_STATUSES = ['pending_payment', 'pending_approval', 'active', 'completed'];
const PUBLIC_USER = 'uuid firstName lastName avatarUrl';
const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;

const isAdmin = (user) => (user.roles || []).includes('ADMIN');
const toId = (v) => String(v && v._id ? v._id : v);

// =================================================================
//                         СВЯЗИ И ПРАВА
// =================================================================

/** Пользователи, связанные с userId записью на курс: { userId: 'student' | 'coach' } (роль собеседника) */
const relationsOf = async (userId) => {
    const relations = new Map();
    const myCoach = await Coach.findOne({ user: userId }).select('_id').lean();

    const [asCoach, asStudent] = await Promise.all([
        myCoach
            ? TrainingContract.find({ coach: myCoach._id, status: { $in: CHAT_STATUSES } }).distinct('student')
            : [],
        TrainingContract.find({ student: userId, status: { $in: CHAT_STATUSES } }).distinct('coach'),
    ]);
    for (const id of asCoach) relations.set(String(id), 'student');
    if (asStudent.length) {
        const coaches = await Coach.find({ _id: { $in: asStudent } }).select('user').lean();
        for (const c of coaches) if (!relations.has(String(c.user))) relations.set(String(c.user), 'coach');
    }
    relations.delete(String(userId));
    return relations;
};

/** Можно ли user начать диалог с otherId */
const canChat = async (user, otherId) => {
    if (isAdmin(user)) return true;
    const other = await User.findById(otherId).select('roles').lean();
    if (other && (other.roles || []).includes('ADMIN')) return true;
    return (await relationsOf(user.id)).has(String(otherId));
};

/** Комната, где user — участник; иначе 404 */
const findMyRoom = async (user, roomId) => {
    if (!ObjectId.isValid(roomId)) throw badRequest('Invalid room id.', 'INVALID_ID');
    const room = await ChatRoom.findOne({ _id: roomId, members: user.id }).lean();
    if (!room) throw notFound('Chat room not found.', 'ROOM_NOT_FOUND');
    return room;
};

// =================================================================
//                         ПРЕДСТАВЛЕНИЕ
// =================================================================

const toUserDto = (u) => (u ? { _id: u._id, uuid: u.uuid, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl || null } : null);

const toMessageDto = (m) => ({
    _id: m._id,
    room: m.room,
    sender: m.sender,
    text: m.text,
    createdAt: m.createdAt,
    readAt: m.readAt || null,
    ...(m.clientId ? { clientId: m.clientId } : {}),
});

/** room.members должны быть populated */
const toRoomDto = (room, me, unreadCount = 0) => {
    const other = room.members.find((m) => m && toId(m) !== String(me));
    return {
        _id: room._id,
        context: room.context || { kind: 'direct' },
        interlocutor: toUserDto(other),
        lastMessage: room.lastMessage && room.lastMessage.text ? room.lastMessage : null,
        lastMessageAt: room.lastMessageAt || null,
        unreadCount,
        createdAt: room.createdAt,
    };
};

/** Непрочитанные (сообщения собеседника без readAt) по комнатам — одним запросом */
const unreadByRoom = async (userId, roomIds) => {
    if (!roomIds.length) return new Map();
    const rows = await ChatMessage.aggregate([
        { $match: { room: { $in: roomIds.map((id) => new ObjectId(String(id))) }, readAt: null, sender: { $ne: new ObjectId(String(userId)) } } },
        { $group: { _id: '$room', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.count]));
};

// =================================================================
//                         КОМНАТЫ
// =================================================================

const listRooms = async (user) => {
    const rooms = await ChatRoom.find({ members: user.id })
        .populate('members', PUBLIC_USER)
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .lean();
    const unread = await unreadByRoom(user.id, rooms.map((r) => r._id));
    return rooms.map((r) => toRoomDto(r, user.id, unread.get(String(r._id)) || 0));
};

const normalizeContext = (context) => {
    if (!context || !context.kind || context.kind === 'direct') return { kind: 'direct' };
    if (!ChatRoom.CONTEXT_KINDS.includes(context.kind)) {
        throw unprocessable('Unknown chat context.', 'VALIDATION_ERROR', [{ field: 'context.kind', message: `One of: ${ChatRoom.CONTEXT_KINDS.join(', ')}` }]);
    }
    if (!context.refId) {
        throw unprocessable('Context reference is required.', 'VALIDATION_ERROR', [{ field: 'context.refId', message: 'Required for non-direct context.' }]);
    }
    return { kind: context.kind, refId: String(context.refId), ...(context.title ? { title: String(context.title) } : {}) };
};

/** Найти или создать комнату с otherId — идемпотентно: { room, created } */
const openRoom = async (user, { userId: otherId, context }) => {
    if (!ObjectId.isValid(otherId)) throw badRequest('Invalid user id.', 'INVALID_ID');
    if (String(otherId) === String(user.id)) throw badRequest('You cannot start a chat with yourself.', 'CHAT_WITH_SELF');
    if (!(await User.exists({ _id: otherId }))) throw notFound('User not found.', 'USER_NOT_FOUND');
    if (!(await canChat(user, otherId))) {
        throw forbidden('You can only message your coach or your students.', 'CHAT_NOT_ALLOWED');
    }
    const ctx = normalizeContext(context);
    const key = ChatRoom.keyFor(user.id, otherId, ctx);

    let created = false;
    let room = await ChatRoom.findOne({ key }).lean();
    if (!room) {
        try {
            room = (await ChatRoom.create({ members: [user.id, otherId], key, context: ctx })).toObject();
            created = true;
        } catch (e) {
            if (e.code !== 11000) throw e;
            room = await ChatRoom.findOne({ key }).lean(); // параллельный запрос успел первым
        }
    }
    const populated = await ChatRoom.findById(room._id).populate('members', PUBLIC_USER).lean();
    const unread = await unreadByRoom(user.id, [room._id]);
    return { room: toRoomDto(populated, user.id, unread.get(String(room._id)) || 0), created };
};

// =================================================================
//                         СООБЩЕНИЯ
// =================================================================

/**
 * История по курсору: before — id сообщения, старше которого выдать; ответ — по возрастанию времени.
 * -> { data, hasMore }
 */
const listMessages = async (user, roomId, { before, limit } = {}) => {
    await findMyRoom(user, roomId);
    const size = Math.max(1, Math.min(PAGE_MAX, Number(limit) || PAGE_DEFAULT));
    const filter = { room: roomId };
    if (before) {
        if (!ObjectId.isValid(before)) throw badRequest('Invalid cursor.', 'INVALID_CURSOR');
        const pivot = await ChatMessage.findOne({ _id: before, room: roomId }).select('createdAt').lean();
        if (!pivot) throw badRequest('Invalid cursor.', 'INVALID_CURSOR');
        filter.$or = [
            { createdAt: { $lt: pivot.createdAt } },
            { createdAt: pivot.createdAt, _id: { $lt: pivot._id } },
        ];
    }
    const rows = await ChatMessage.find(filter).sort({ createdAt: -1, _id: -1 }).limit(size + 1).lean();
    const hasMore = rows.length > size;
    return { data: rows.slice(0, size).reverse().map(toMessageDto), hasMore };
};

const sendMessage = async (user, roomId, { text, clientId }) => {
    const room = await findMyRoom(user, roomId);
    // Права проверяются и при каждой отправке: после отмены записи история видна, но писать нельзя
    const other = room.members.map(String).find((m) => m !== String(user.id));
    if (other && !(await canChat(user, other))) {
        throw forbidden('You can no longer message this user.', 'CHAT_NOT_ALLOWED');
    }
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean) throw unprocessable('Message text is required.', 'VALIDATION_ERROR', [{ field: 'text', message: 'Required.' }]);
    if (clean.length > ChatMessage.MAX_TEXT) {
        throw unprocessable(`Message is too long (max ${ChatMessage.MAX_TEXT}).`, 'VALIDATION_ERROR', [{ field: 'text', message: 'Too long.' }]);
    }
    // Повтор той же отправки (переподключение сокета) не создаёт дубль
    if (clientId) {
        const existing = await ChatMessage.findOne({ room: roomId, sender: user.id, clientId: String(clientId) }).lean();
        if (existing) return toMessageDto(existing);
    }
    const message = await ChatMessage.create({ room: roomId, sender: user.id, text: clean, ...(clientId ? { clientId: String(clientId).slice(0, 64) } : {}) });
    await ChatRoom.updateOne(
        { _id: roomId },
        { $set: { lastMessage: { text: clean.slice(0, 300), sender: user.id, createdAt: message.createdAt }, lastMessageAt: message.createdAt } },
    );
    const dto = toMessageDto(message.toObject());
    emitToUsers(room.members, 'message:new', { roomId: String(roomId), message: dto });
    return dto;
};

/** Отметить прочитанными сообщения собеседника -> { updated, readAt } */
const markRead = async (user, roomId) => {
    const room = await findMyRoom(user, roomId);
    const readAt = new Date();
    const { modifiedCount } = await ChatMessage.updateMany(
        { room: roomId, sender: { $ne: user.id }, readAt: null },
        { $set: { readAt } },
    );
    if (modifiedCount > 0) {
        emitToUsers(room.members, 'message:read', { roomId: String(roomId), readerId: String(user.id), readAt });
    }
    return { updated: modifiedCount, readAt };
};

/** Суммарно и по комнатам */
const unreadSummary = async (user) => {
    const roomIds = await ChatRoom.find({ members: user.id }).distinct('_id');
    const byRoom = await unreadByRoom(user.id, roomIds);
    let total = 0;
    const rooms = {};
    for (const [id, n] of byRoom) { rooms[id] = n; total += n; }
    return { total, rooms };
};

/** С кем можно переписываться: ученики (для тренера) и тренеры (для ученика) */
const listContacts = async (user) => {
    const relations = await relationsOf(user.id);
    if (!relations.size) return [];
    const users = await User.find({ _id: { $in: [...relations.keys()] } }).select(PUBLIC_USER).sort({ lastName: 1, firstName: 1 }).lean();
    return users.map((u) => ({ ...toUserDto(u), relation: relations.get(String(u._id)) }));
};

/** Индикатор «печатает» — только участникам комнаты, без записи в БД */
const notifyTyping = async (user, roomId, typing) => {
    const room = await findMyRoom(user, roomId);
    const others = room.members.filter((m) => String(m) !== String(user.id));
    emitToUsers(others, 'typing', { roomId: String(roomId), userId: String(user.id), typing: !!typing });
};

module.exports = {
    listRooms, openRoom, listMessages, sendMessage, markRead, unreadSummary, listContacts, notifyTyping,
    canChat, relationsOf, CHAT_STATUSES,
};
