const Schedule = require('../models/Schedule');
const Coach = require('../models/Coach');
const Group = require('../models/Group');
const User = require('../models/User');
const TrainingContract = require('../models/TrainingContract');
const Assignment = require('../models/Assignment');
const { notifyLessonScheduled } = require('../services/lessonNotify.service');

// Индивидуальное занятие можно назначить только по действующей записи студента у этого тренера
const LIVE_CONTRACT_STATUSES = ['pending_payment', 'pending_approval', 'active'];
// Что тренер может менять в событии. coach и context не меняются: это перенесло бы событие
// другому тренеру/студенту в обход проверок при создании
const UPDATABLE_EVENT_FIELDS = ['title', 'description', 'date', 'durationMinutes', 'link', 'status'];

const requireCoach = async (req, res) => {
    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');
    if (!coachProfile) {
        res.status(403).json({ msg: req.t('controllers.schedule.coachProfileRequired'), code: 'COACH_PROFILE_REQUIRED' });
    }
    return coachProfile;
};

/**
 * @desc    Создание нового события в расписании (индивидуального или группового)
 * @route   POST /api/v2/schedule
 * @access  Private (role: COACH)
 */
const createScheduleEvent = async (req, res) => {
    // Поля уже провалидированы в schedule.routes.js. notify (по умолчанию true) и message — опциональные:
    // уведомить адресатов (почта + колокольчик) и приложить личное сообщение тренера.
    const { title, description, date, durationMinutes, link, eventType, contextId, message, personalMessages } = req.body;
    const notify = req.body.notify !== false; // по умолчанию уведомляем

    const coachProfile = await requireCoach(req, res);
    if (!coachProfile) return;

    const context = { type: eventType, refId: contextId };
    let contract;
    let recipients = []; // кого уведомлять: [{ _id, firstName, lastName, email }]

    // Проверка существования контекста и прав доступа
    if (eventType === 'individual') {
        const student = await User.findById(contextId).select('_id firstName lastName email');
        if (!student) return res.status(404).json({ msg: req.t('controllers.schedule.studentNotFound'), code: 'STUDENT_NOT_FOUND' });
        contract = await TrainingContract.findOne({
            student: student._id,
            coach: coachProfile._id,
            status: { $in: LIVE_CONTRACT_STATUSES },
        }).sort({ createdAt: -1 }).select('_id');
        if (!contract) {
            return res.status(403).json({ msg: req.t('controllers.schedule.notYourStudent'), code: 'NOT_YOUR_STUDENT' });
        }
        recipients = [student];
    } else {
        const group = await Group.findById(contextId).select('coach status members').populate('members', 'firstName lastName email');
        if (!group) return res.status(404).json({ msg: req.t('controllers.schedule.groupNotFound'), code: 'GROUP_NOT_FOUND' });
        if (String(group.coach) !== String(coachProfile._id)) {
            return res.status(403).json({ msg: req.t('controllers.schedule.notGroupOwner'), code: 'NOT_GROUP_OWNER' });
        }
        if (group.status !== 'active') {
            return res.status(422).json({ msg: req.t('controllers.schedule.groupArchived'), code: 'GROUP_ARCHIVED' });
        }
        recipients = group.members || [];
    }

    const newEvent = await Schedule.create({
        title, description, date, durationMinutes, link,
        coach: coachProfile._id,
        context,
        // Связь с записью студента: сколько занятий из пакета израсходовано, очистка при удалении записи
        contract: contract ? contract._id : undefined,
        ...(req.club ? { club: req.club } : {}),
    });

    // Уведомления (почта «от лица тренера» + колокольчик) — не блокируют и не роняют создание занятия
    let notified = null;
    if (notify && recipients.length) {
        try {
            const coachUser = await User.findById(req.user.id).select('firstName lastName email').lean();
            notified = await notifyLessonScheduled({
                event: newEvent,
                coach: coachUser || {},
                recipients,
                type: eventType === 'group' ? 'NEW_GROUP_LESSON' : 'NEW_LESSON',
                customMessage: typeof message === 'string' ? message.trim() : '',
                personalMessages: personalMessages && typeof personalMessages === 'object' ? personalMessages : {},
                baseUrl: process.env.FRONTEND_BASE_URL || '',
            });
        } catch (e) {
            console.error('createScheduleEvent: ошибка рассылки уведомлений:', e.message);
        }
    }

    res.status(201).json({ ...newEvent.toObject(), notified });
};


/**
 * @desc    Получить расписание для текущего пользователя (студента ИЛИ тренера)
 * @route   GET /api/v2/schedule?startDate=&endDate=
 * @access  Private
 */
const getMySchedule = async (req, res) => {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    // Группы пользователя (индекс Group.members) и его профиль тренера — параллельно
    const [userGroups, coachProfile] = await Promise.all([
        Group.find({ members: userId }).select('_id'),
        Coach.findOne({ user: userId }).select('_id'),
    ]);
    const groupIds = userGroups.map(g => g._id);

    const query = {
        $or: [
            // Либо я - студент в индивидуальном событии
            { 'context.type': 'individual', 'context.refId': userId },
            // Либо это событие для одной из моих групп
            { 'context.type': 'group', 'context.refId': { $in: groupIds } },
            // Либо я - тренер, который ведет это событие
            ...(coachProfile ? [{ coach: coachProfile._id }] : [])
        ]
    };

    // Изоляция по клубу (#7): если активный клуб определён — только его события
    if (req.club) query.club = req.club;

    // Фильтр по датам: можно передать только одну границу
    if (startDate || endDate) {
        query.date = {};
        if (startDate) query.date.$gte = new Date(startDate);
        if (endDate) query.date.$lte = new Date(endDate);
    }

    const events = await Schedule.find(query)
        .populate({ path: 'coach', select: 'user', populate: { path: 'user', select: 'uuid firstName lastName' } })
        .sort({ date: 'asc' })
        .lean();

    // context.refId указывает то на группу, то на пользователя (ref у поля нет) — подтягиваем
    // названия групп и имена студентов двумя запросами на весь список, без N+1
    const refIds = (type) => [...new Set(events.filter(e => e.context.type === type).map(e => String(e.context.refId)))];
    const [groups, students] = await Promise.all([
        Group.find({ _id: { $in: refIds('group') } }).select('name').lean(),
        User.find({ _id: { $in: refIds('individual') } }).select('uuid firstName lastName').lean(),
    ]);
    const byId = new Map([...groups, ...students].map(doc => [String(doc._id), doc]));
    events.forEach(e => { e.context.ref = byId.get(String(e.context.refId)) || null; });

    res.json({ data: events });
};


/**
 * @desc    Обновить событие в расписании
 * @route   PUT /api/v2/schedule/:eventId
 * @access  Private (role: COACH)
 */
const updateScheduleEvent = async (req, res) => {
    const { eventId } = req.params;
    const coachProfile = await requireCoach(req, res);
    if (!coachProfile) return;

    const updateData = {};
    for (const field of UPDATABLE_EVENT_FIELDS) {
        if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }
    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ msg: req.t('controllers.schedule.nothingToUpdate', { fields: UPDATABLE_EVENT_FIELDS.join(', ') }), code: 'EMPTY_UPDATE' });
    }

    // Находим и обновляем, только если я - тренер этого события
    const updatedEvent = await Schedule.findOneAndUpdate(
        { _id: eventId, coach: coachProfile._id },
        { $set: updateData },
        { new: true, runValidators: true }
    );

    if (!updatedEvent) {
        return res.status(404).json({ msg: req.t('controllers.schedule.eventNotFoundOrNotEditable'), code: 'EVENT_NOT_FOUND' });
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
    const coachProfile = await requireCoach(req, res);
    if (!coachProfile) return;

    const result = await Schedule.findOneAndDelete({ _id: eventId, coach: coachProfile._id });

    if (!result) {
        return res.status(404).json({ msg: req.t('controllers.schedule.eventNotFoundOrNotDeletable'), code: 'EVENT_NOT_FOUND' });
    }
    // ДЗ занятия остаётся (по нему могли уже сдать работы), но больше не ссылается на удалённое занятие
    await Assignment.updateMany({ schedule: result._id }, { $unset: { schedule: 1 } });

    res.json({ msg: req.t('controllers.schedule.eventDeletedSuccess') });
};


module.exports = {
    createScheduleEvent,
    getMySchedule,
    updateScheduleEvent,
    deleteScheduleEvent,
};
