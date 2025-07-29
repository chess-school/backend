// v2/controllers/chat.controller.js

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

/**
 * @desc    Получить список всех чатов ("комнат") для текущего пользователя
 * @route   GET /api/v2/conversations
 * @access  Private
 */
const getMyConversations = async (req, res) => {
    // Находим все чаты, где текущий пользователь является участником
    const conversations = await Conversation.find({ members: req.user.id })
        .populate({ // Подгружаем информацию об участниках, КРОМЕ себя
            path: 'members',
            select: 'uuid firstName lastName avatarUrl',
            match: { _id: { $ne: req.user.id } } // $ne = Not Equal
        })
        .populate('groupContext', 'name') // Если это групповой чат, подгружаем название группы
        .sort({ 'lastMessage.timestamp': -1 }); // Сортируем по последнему сообщению

    // Формируем красивый ответ для фронтенда
    const formattedConversations = conversations.map(convo => {
        const convoObject = convo.toObject();
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
        
        // Удаляем свое собственное `_id` из списка members
        convoObject.members = convoObject.members.filter(m => m !== null);

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
        .populate('sender', 'uuid firstName lastName avatarUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10));

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