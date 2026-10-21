const Group = require('../models/Group');
const Coach = require('../models/Coach');
const User = require('../models/User');
const TrainingContract = require('../models/TrainingContract');

// Записи, по которым студент реально учится у тренера (отменённые/возвращённые не дают права на группу)
const LIVE_CONTRACT_STATUSES = ['pending_payment', 'pending_approval', 'active'];

/**
 * @desc    Создание новой учебной группы
 * @route   POST /api/v2/groups
 * @access  Private (role: COACH)
 */
const createGroup = async (req, res) => {
    const { name, description } = req.body;

    // 1. Находим профиль тренера текущего пользователя
    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');
    if (!coachProfile) {
        return res.status(403).json({ msg: 'You must have a coach profile to create groups.', code: 'COACH_PROFILE_REQUIRED' });
    }

    // 2. Создаем группу
    const group = new Group({
        name,
        description,
        coach: coachProfile._id // Текущий тренер - владелец группы
    });

    await group.save();
    res.status(201).json(group);
};


/**
 * @desc    Получение списка групп, созданных текущим тренером
 * @route   GET /api/v2/coaches/me/groups
 * @access  Private (role: COACH)
 */
const getMyGroups = async (req, res) => {
    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');
    if (!coachProfile) {
        return res.json({ data: [] });
    }

    const groups = await Group.find({ coach: coachProfile._id })
                              .populate('members', 'uuid firstName lastName avatarUrl')
                              .sort({ createdAt: -1 });

    res.json({ data: groups });
};


/**
 * @desc    Получить детальную информацию о конкретной группе по ее _id
 * @route   GET /api/v2/groups/:groupId
 * @access  Private (тренер группы, её участник или ADMIN)
 */
const getGroupById = async (req, res) => {
    const { groupId } = req.params;

    // Некорректный groupId -> CastError -> 400 (errorHandlerV2)
    const group = await Group.findById(groupId)
                             .populate('coach', 'user')
                             .populate('members', 'uuid firstName lastName avatarUrl');

    if (!group) {
        return res.status(404).json({ msg: 'Group not found.', code: 'GROUP_NOT_FOUND' });
    }

    // ПРОВЕРКА ДОСТУПА: тренер группы, участник группы или администратор
    const coachUserId = group.coach ? String(group.coach.user) : null;
    const isMember = group.members.some(member => String(member._id) === req.user.id);
    const isAdmin = req.user.roles.includes('ADMIN');

    if (coachUserId !== req.user.id && !isMember && !isAdmin) {
        return res.status(403).json({ msg: 'You do not have permission to view this group.', code: 'FORBIDDEN' });
    }

    res.json(group);
};

/** Профиль тренера и группа, которой он владеет; иначе — готовый ответ с ошибкой */
const loadOwnGroup = async (req, res, groupId) => {
    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');
    if (!coachProfile) {
        res.status(403).json({ msg: 'Coach profile not found for the current user.', code: 'COACH_PROFILE_REQUIRED' });
        return {};
    }
    const group = await Group.findById(groupId);
    if (!group || String(group.coach) !== String(coachProfile._id)) {
        res.status(404).json({ msg: 'Group not found or you are not its owner.', code: 'GROUP_NOT_FOUND' });
        return {};
    }
    return { coachProfile, group };
};

/**
 * @desc    Добавить участника (студента) в группу с проверкой контракта и дубликатов.
 * @route   POST /api/v2/groups/:groupId/members
 * @access  Private (role: COACH)
 */
const addMemberToGroup = async (req, res) => {
    const { groupId } = req.params;
    const { userUuid } = req.body;

    const { coachProfile, group } = await loadOwnGroup(req, res, groupId);
    if (!group) return;
    if (group.status !== 'active') {
        return res.status(422).json({ msg: 'Cannot add members to an archived group.', code: 'GROUP_ARCHIVED' });
    }

    const studentToAdd = await User.findOne({ uuid: userUuid }).select('_id');
    if (!studentToAdd) {
        return res.status(404).json({ msg: 'Student with this UUID not found.', code: 'STUDENT_NOT_FOUND' });
    }

    // Студент должен учиться у этого тренера по действующей записи (не отменённой и не возвращённой)
    const contract = await TrainingContract.findOne({
        student: studentToAdd._id,
        coach: coachProfile._id,
        status: { $in: LIVE_CONTRACT_STATUSES },
    }).sort({ createdAt: -1 });
    if (!contract) {
        return res.status(403).json({ msg: 'This user is not enrolled as your student.', code: 'NOT_YOUR_STUDENT' });
    }

    // Атомарно: условие members $ne в фильтре + $addToSet — параллельные запросы не создадут дубль.
    // Проверяем matchedCount, а не modifiedCount: из-за timestamps Mongoose всегда меняет updatedAt
    const result = await Group.updateOne(
        { _id: group._id, members: { $ne: studentToAdd._id } },
        { $addToSet: { members: studentToAdd._id } }
    );
    if (result.matchedCount === 0) {
        return res.status(409).json({ msg: 'This student is already a member of this group.', code: 'ALREADY_MEMBER' });
    }

    // Запись студента теперь относится к этой группе; из прежней группы (если была) он выходит,
    // только если его там не держит другая запись
    const previousGroup = contract.group;
    await TrainingContract.updateOne({ _id: contract._id }, { $set: { group: group._id } });
    if (previousGroup && String(previousGroup) !== String(group._id)) {
        const stillLinked = await TrainingContract.exists({ student: studentToAdd._id, group: previousGroup });
        if (!stillLinked) await Group.updateOne({ _id: previousGroup }, { $pull: { members: studentToAdd._id } });
    }

    res.json({ msg: 'Student successfully added to the group.' });
};

/**
 * @desc    Удалить участника из группы
 * @route   DELETE /api/v2/groups/:groupId/members/:userUuid
 * @access  Private (role: COACH)
 */
const removeMemberFromGroup = async (req, res) => {
    const { groupId, userUuid } = req.params;

    const { group } = await loadOwnGroup(req, res, groupId);
    if (!group) return;

    const studentToRemove = await User.findOne({ uuid: userUuid }).select('_id');
    if (!studentToRemove) {
        return res.status(404).json({ msg: 'Student with this UUID not found.', code: 'STUDENT_NOT_FOUND' });
    }

    const result = await Group.updateOne(
        { _id: group._id, members: studentToRemove._id },
        { $pull: { members: studentToRemove._id } }
    );
    if (result.matchedCount === 0) {
        return res.status(404).json({ msg: 'This student is not a member of this group.', code: 'NOT_A_MEMBER' });
    }
    // Записи студента больше не ссылаются на группу, из которой он вышел
    await TrainingContract.updateMany({ student: studentToRemove._id, group: group._id }, { $set: { group: null } });

    res.json({ msg: 'Student successfully removed from the group.' });
};


module.exports = {
    createGroup,
    getMyGroups,
    getGroupById,
    addMemberToGroup,
    removeMemberFromGroup
};
