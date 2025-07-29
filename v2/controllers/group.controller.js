const Group = require('../models/Group');
const Coach = require('../models/Coach');
const User = require('../models/User');
const TrainingContract = require('../models/TrainingContract');

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
        return res.status(403).json({ msg: 'You must have a coach profile to create groups.' });
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
 * @access  Private (COACH or member of the group)
 */
const getGroupById = async (req, res) => {
    const { groupId } = req.params;

    const group = await Group.findById(groupId)
                             .populate('coach', 'user')
                             .populate('members', 'uuid firstName lastName avatarUrl');

    if (!group) {
        return res.status(404).json({ msg: 'Group not found.' });
    }
    
    // ПРОВЕРКА ДОСТУПА:
    // Либо я - тренер этой группы, либо я - участник этой группы.
    const coachUserId = group.coach.user.toString();
    const isMember = group.members.some(member => member._id.toString() === req.user.id);

    if (coachUserId !== req.user.id && !isMember) {
        return res.status(403).json({ msg: 'You do not have permission to view this group.' });
    }

    res.json(group);
};

/**
 * @desc    Добавить участника (студента) в группу с проверкой контракта и дубликатов.
 * @route   POST /api/v2/groups/:groupId/members
 * @access  Private (role: COACH)
 */
const addMemberToGroup = async (req, res) => {
    const { groupId } = req.params;
    const { userUuid } = req.body;

    // 1. Находим пользователя, которого нужно добавить
    const studentToAdd = await User.findOne({ uuid: userUuid }).select('_id');
    if (!studentToAdd) {
        return res.status(404).json({ msg: 'Student with this UUID not found.' });
    }
    
    // 2. Находим профиль тренера и группу
    const coachProfile = await Coach.findOne({ user: req.user.id });
    if (!coachProfile) {
        return res.status(403).json({ msg: 'Coach profile not found for the current user.' });
    }

    const group = await Group.findById(groupId);
    if (!group || group.coach.toString() !== coachProfile._id.toString()) {
        return res.status(404).json({ msg: 'Group not found or you are not its owner.' });
    }

    // 3. ПРОВЕРКА, НЕ ЯВЛЯЕТСЯ ЛИ ПОЛЬЗОВАТЕЛЬ УЖЕ УЧАСТНИКОМ (НОВОЕ!)
    // .includes() работает с массивом ObjectId, если мы приведем ID к строке
    const isAlreadyMember = group.members.some(memberId => memberId.toString() === studentToAdd._id.toString());
    if (isAlreadyMember) {
        return res.status(400).json({ msg: 'This student is already a member of this group.' });
    }

    // 4. Проверка наличия контракта
    const activeContract = await TrainingContract.findOne({
        student: studentToAdd._id,
        coach: coachProfile._id,
    });
    
    if (!activeContract) {
        return res.status(403).json({ msg: "Forbidden: This user is not enrolled as your student." });
    }
    
    // 5. Если все проверки пройдены, добавляем студента
    // Теперь `$addToSet` просто служит дополнительной страховкой на уровне БД
    group.members.push(studentToAdd._id);
    await group.save(); // Можно использовать push + save() для большей ясности

    // Опциональное обновление контракта
    await TrainingContract.updateOne(
        { _id: activeContract._id },
        { $set: { group: groupId } }
    );
    
    res.json({ msg: 'Student successfully added to the group.' });
};
/**
 * @desc    Удалить участника из группы
 * @route   DELETE /api/v2/groups/:groupId/members/:userUuid
 * @access  Private (role: COACH)
 */
const removeMemberFromGroup = async (req, res) => {
    const { groupId, userUuid } = req.params;
    
    const studentToRemove = await User.findOne({ uuid: userUuid }).select('_id');
    if (!studentToRemove) {
        return res.status(404).json({ msg: 'Student with this UUID not found.' });
    }
    
    const group = await Group.findById(groupId);
    const coachProfile = await Coach.findOne({ user: req.user.id });
    
    if (!group || group.coach.toString() !== coachProfile._id.toString()) {
        return res.status(404).json({ msg: 'Group not found or you are not the owner.' });
    }
    
    // Используем $pull, чтобы удалить ID пользователя из массива members
    await group.updateOne({ $pull: { members: studentToRemove._id } });
    
    res.json({ msg: 'Student successfully removed from the group.' });
};


module.exports = {
    createGroup,
    getMyGroups,
    getGroupById,
    addMemberToGroup,
    removeMemberFromGroup
};