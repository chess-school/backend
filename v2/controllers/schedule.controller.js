const scheduleRepo = require('../repositories/schedule.repo'); // шов learning (mongo|pg по LEARNING_DB)
const coachRepo = require('../repositories/coach.repo'); // шов coaching (mongo|pg по COACHING_DB)
const Group = require('../models/Group');
const userRepo = require('../repositories/user.repo'); // шов identity (mongo|pg по USER_DB)
const contractRepo = require('../repositories/trainingContract.repo'); // шов coaching
const assignmentRepo = require('../repositories/assignment.repo'); // шов learning
const { notifyLessonScheduled } = require('../services/lessonNotify.service');

// Индивидуальное занятие можно назначить только по действующей записи студента у этого тренера
const LIVE_CONTRACT_STATUSES = ['pending_payment', 'pending_approval', 'active'];
// Что тренер может менять в событии. coach и context не меняются: это перенесло бы событие
// другому тренеру/студенту в обход проверок при создании
const UPDATABLE_EVENT_FIELDS = ['title', 'description', 'date', 'durationMinutes', 'link', 'status'];

const requireCoach = async (req, res) => {
    const coachProfile = await coachRepo.findByUser(req.user.id);
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
        const student = await userRepo.findById(contextId);
        if (!student) return res.status(404).json({ msg: req.t('controllers.schedule.studentNotFound'), code: 'STUDENT_NOT_FOUND' });
        contract = await contractRepo.findOne({
            student: student._id,
            coach: coachProfile._id,
            status: { $in: LIVE_CONTRACT_STATUSES },
        }, { sort: { createdAt: -1 } });
        if (!contract) {
            return res.status(403).json({ msg: req.t('controllers.schedule.notYourStudent'), code: 'NOT_YOUR_STUDENT' });
        }
        recipients = [student];
    } else {
        const group = await Group.findById(contextId).select('coach status members').lean();
        if (!group) return res.status(404).json({ msg: req.t('controllers.schedule.groupNotFound'), code: 'GROUP_NOT_FOUND' });
        // участники группы — app-level джойн через шов (замена populate('members'))
        const memberMap = await userRepo.userCardMap(group.members, ['firstName', 'lastName', 'email']);
        group.members = (group.members || []).map((id) => memberMap.get(String(id)) || null).filter(Boolean);
        if (String(group.coach) !== String(coachProfile._id)) {
            return res.status(403).json({ msg: req.t('controllers.schedule.notGroupOwner'), code: 'NOT_GROUP_OWNER' });
        }
        if (group.status !== 'active') {
            return res.status(422).json({ msg: req.t('controllers.schedule.groupArchived'), code: 'GROUP_ARCHIVED' });
        }
        recipients = group.members || [];
    }

    const newEvent = await scheduleRepo.create({
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
            const coachUser = await userRepo.findById(req.user.id);
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

    res.status(201).json({ ...newEvent, notified });
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
        coachRepo.findByUser(userId),
    ]);
    const groupIds = userGroups.map(g => g._id);

    // Расписание пользователя (студент индивид./участник группы/тренер) — через шов learning.
    const events = await scheduleRepo.findForUser({
        userId,
        groupIds,
        coachId: coachProfile ? coachProfile._id : null,
        club: req.club || null,
        startDate,
        endDate,
    });
    await coachRepo.attachCoachField(events); // джойн coach→user — app-level через шов

    // context.refId указывает то на группу, то на пользователя (ref у поля нет) — подтягиваем
    // названия групп и имена студентов двумя запросами на весь список, без N+1
    const refIds = (type) => [...new Set(events.filter(e => e.context.type === type).map(e => String(e.context.refId)))];
    const [groups, students] = await Promise.all([
        Group.find({ _id: { $in: refIds('group') } }).select('name').lean(),
        userRepo.findByIdList(refIds('individual')),
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
    const updatedEvent = await scheduleRepo.updateOwn(eventId, coachProfile._id, updateData);

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

    const result = await scheduleRepo.deleteOwn(eventId, coachProfile._id);

    if (!result) {
        return res.status(404).json({ msg: req.t('controllers.schedule.eventNotFoundOrNotDeletable'), code: 'EVENT_NOT_FOUND' });
    }
    // ДЗ занятия остаётся (по нему могли уже сдать работы), но больше не ссылается на удалённое занятие
    await assignmentRepo.clearScheduleByIds([result._id]);

    res.json({ msg: req.t('controllers.schedule.eventDeletedSuccess') });
};


module.exports = {
    createScheduleEvent,
    getMySchedule,
    updateScheduleEvent,
    deleteScheduleEvent,
};
