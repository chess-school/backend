// v2/controllers/chat.controller.js

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const userRepo = require('../repositories/user.repo'); // шов identity (mongo|pg по USER_DB)

/**
 * @desc    Получить список всех чатов ("комнат") для текущего пользователя
 * @route   GET /api/v2/conversations
 * @access  Private
 */
const getMyConversations = async (req, res) => {
    // Находим все чаты, где текущий пользователь является участником
    const conversations = await Conversation.find({ members: req.user.id })
        .populate('groupContext', 'name') // Если это групповой чат, подгружаем название группы (Mongo-ссылка)
        .sort({ 'lastMessage.timestamp': -1 }) // Сортируем по последнему сообщению
        .lean();

    // Участники — app-level джойн через шов (замена populate('members'), КРОМЕ себя — как match $ne).
    const selfId = String(req.user.id);
    const memberIds = conversations.flatMap((c) => (c.members || []).map(String)).filter((id) => id !== selfId);
    const memberMap = await userRepo.userCardMap(memberIds, ['uuid', 'firstName', 'lastName', 'avatarUrl']);

    // Формируем красивый ответ для фронтенда
    const formattedConversations = conversations.map(convoObject => {
        // Участники, кроме себя (как было в populate.match), только найденные
        convoObject.members = (convoObject.members || [])
            .map(String).filter((id) => id !== selfId)
            .map((id) => memberMap.get(id) || null)
            .filter(m => m !== null);
        // Определяем название чата
        if (convoObject.type === 'group' && convoObject.groupContext) {
            convoObject.name = convoObject.groupContext.name;
        } else if (convoObject.type === 'private' && convoObject.members.length > 0) {
            const otherUser = convoObject.members[0];
            convoObject.name = `${otherUser.firstName} ${otherUser.lastName}`;
            convoObject.interlocutor = otherUser; // Для удобства
        } else {
            convoObject.name = 'Chat';
        }
        delete convoObject.groupContext;
        return convoObject;
    });

    res.json({ data: formattedConversations });
};


/**
 * @desc    Получить историю сообщений для конкретного чата (с пагинацией)
 * @route   GET /api/v2/conversations/:conversationId/messages
 * @access  Private
 */
const getConversationMessages = async (req, res) => {
    const { conversationId } = req.params;
    const { page = 1, limit = 30 } = req.query;
    
    // 1. Проверяем, является ли пользователь участником этого чата
    const conversation = await Conversation.findOne({ _id: conversationId, members: req.user.id });
    if (!conversation) {
        return res.status(403).json({ msg: "Access denied or conversation not found." });
    }

    // 2. Загружаем сообщения с пагинацией (в обратном порядке, от новых к старым)
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    
    const messages = await Message.find({ conversation: conversationId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean();

    // sender — app-level джойн через шов (замена populate('sender'))
    const senderMap = await userRepo.userCardMap(messages.map((m) => m.sender), ['uuid', 'firstName', 'lastName', 'avatarUrl']);
    for (const m of messages) m.sender = m.sender ? (senderMap.get(String(m.sender)) || null) : null;

    // Переворачиваем массив, чтобы на фронтенде он был в правильном порядке
    messages.reverse();

    const totalMessages = await Message.countDocuments({ conversation: conversationId });
    
    res.json({
        data: messages,
        pagination: {
            currentPage: parseInt(page, 10),
            totalPages: Math.ceil(totalMessages / parseInt(limit, 10)),
            totalMessages
        }
    });
};

module.exports = {
    getMyConversations,
    getConversationMessages
};