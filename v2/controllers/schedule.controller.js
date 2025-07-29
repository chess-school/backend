const Schedule = require('../models/Schedule');
const Coach = require('../models/Coach');
const Group = require('../models/Group');
const User = require('../models/User');
const mongoose = require('mongoose');

/**
 * @desc    Создание нового события в расписании (индивидуального или группового)
 * @route   POST /api/v2/schedule
 * @access  Private (role: COACH)
 */
const createScheduleEvent = async (req, res) => {
    // В теле запроса ожидаем тип события и ID контекста
    const { title, description, date, durationMinutes, link, eventType, contextId } = req.body;

    // 1. Проверяем, существует ли тренерский профиль
    const coachProfile = await Coach.findOne({ user: req.user.id });
    if (!coachProfile) {
        return res.status(403).json({ msg: 'You must have a coach profile to create schedule events.' });
    }

    // 2. Валидация входных данных
    if (!['individual', 'group'].includes(eventType)) {
        return res.status(400).json({ msg: 'Invalid eventType. Must be "individual" or "group".' });
    }
    if (!mongoose.Types.ObjectId.isValid(contextId)) {
        return res.status(400).json({ msg: 'Invalid contextId format.' });
    }

    const context = { type: eventType, refId: contextId };
    
    // 3. Проверка существования контекста и прав доступа
    if (eventType === 'individual') {
        const student = await User.findById(contextId);
        if (!student) return res.status(404).json({ msg: 'Student not found.' });
        // Здесь можно добавить проверку, что это действительно студент этого тренера
    } else if (eventType === 'group') {
        const group = await Group.findById(contextId);
        if (!group) return res.status(404).json({ msg: 'Group not found.' });
        // Проверяем, что тренер - владелец этой группы
        if (group.coach.toString() !== coachProfile._id.toString()) {
            return res.status(403).json({ msg: 'You are not the owner of this group.' });
        }
    }

    // 4. Создаем событие
    const newEvent = new Schedule({
        title, description, date, durationMinutes, link,
        coach: coachProfile._id,
        context
    });

    await newEvent.save();
    res.status(201).json(newEvent);
};


/**
 * @desc    Получить расписание для текущего пользователя (студента ИЛИ тренера)
 * @route   GET /api/v2/schedule
 * @access  Private
 */
const getMySchedule = async (req, res) => {
    const userId = req.user.id;
    const { startDate, endDate } = req.query; // Для фильтрации по датам

    // 1. Находим все группы, в которых состоит пользователь
    const userGroups = await Group.find({ members: userId }).select('_id');
    const groupIds = userGroups.map(g => g._id);

    // 2. Находим профиль тренера, если он есть
    const coachProfile = await Coach.findOne({ user: userId }).select('_id');
    
    // 3. Строим сложный запрос для поиска
    const query = {
        $or: [
            // Либо я - студент в индивидуальном событии
            { 'context.type': 'individual', 'context.refId': userId },
            // Либо это событие для одной из моих групп
            { 'context.type': 'group', 'context.refId': { $in: groupIds } },
            // Либо я - тренер, который ведет это событие (если у меня есть профиль тренера)
            ...(coachProfile ? [{ coach: coachProfile._id }] : [])
        ]
    };

    // Добавляем фильтр по диапазону дат, если он передан
    if (startDate && endDate) {
        query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const events = await Schedule.find(query)
        .populate('coach', 'user') // Можно конкретизировать поля
        .populate({ path: 'context.refId', select: 'name members' }) // Попробуем подтянуть данные группы/студента
        .sort({ date: 'asc' });

    res.json({ data: events });
};


/**
 * @desc    Обновить событие в расписании
 * @route   PUT /api/v2/schedule/:eventId
 * @access  Private (role: COACH)
 */
const updateScheduleEvent = async (req, res) => {
    const { eventId } = req.params;
    const updateData = req.body;
    
    const coachProfile = await Coach.findOne({ user: req.user.id });
    
    // Находим и обновляем, только если я - тренер этого события
    const updatedEvent = await Schedule.findOneAndUpdate(
        { _id: eventId, coach: coachProfile._id },
        { $set: updateData },
        { new: true }
    );
    
    if (!updatedEvent) {
        return res.status(404).json({ msg: 'Event not found or you are not authorized to edit it.' });
    }
    
    res.json(updatedEvent);
};

/**
 * @desc    Удалить событие из расписания
 * @route   DELETE /api/v2/schedule/:eventId
 * @access  Private (role: COACH)
 */
const deleteScheduleEvent = async (req, res) => {
    const { eventId } = req.params;
    const coachProfile = await Coach.findOne({ user: req.user.id });
    
    const result = await Schedule.findOneAndDelete({ _id: eventId, coach: coachProfile._id });

    if (!result) {
        return res.status(404).json({ msg: 'Event not found or you are not authorized to delete it.' });
    }
    
    res.json({ msg: 'Event deleted successfully.' });
};


module.exports = {
    createScheduleEvent,
    getMySchedule,
    updateScheduleEvent,
    deleteScheduleEvent,
};