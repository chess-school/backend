// v2/controllers/admin.controller.js

const userRepo = require('../repositories/user.repo'); // шов identity (mongo|pg по USER_DB)
const Coach = require('../models/Coach');
// const mongoose = require('mongoose');

// =================================================================
//                      УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
// =================================================================

/**
 * @desc    Получить список всех пользователей с пагинацией и фильтрами.
 * @route   GET /api/v2/admin/users
 * @access  Private (role: ADMIN)
 */
/**
 * @desc    Получить список пользователей или одного пользователя по фильтрам.
 *          Поддерживает фильтрацию по uuid, email, role и пагинацию.
 * @route   GET /api/v2/admin/users
 * @access  Private (role: ADMIN)
 */
const getUsers = async (req, res) => {
    // Деструктуризируем query-параметры
    const { uuid, email, role, page = 1, limit = 10 } = req.query;

    // Фильтр (uuid точный, email — подстрока без регистра, role — наличие в массиве);
    // экранирование/нормализацию и проекцию секретов делает репозиторный шов.
    const filter = { uuid, email, role };

    // Пагинация
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const users = await userRepo.findMany(filter, { skip, limit: parseInt(limit, 10) });

    // Если искали по уникальному идентификатору (uuid) и нашли ровно одного пользователя,
    // можно вернуть его как отдельный объект, а не в массиве. Это удобно для фронтенда.
    if (uuid && users.length === 1) {
        
        // Получаем связанные данные для детального просмотра
        const user = users[0];
        const coachProfile = await Coach.findOne({ user: user._id });

        return res.json({
            user: user,
            coachProfile: coachProfile || null
        });
    }

    // В остальных случаях возвращаем список с пагинацией
    const totalUsers = await userRepo.count(filter);
    
    res.json({
        data: users,
        pagination: {
            currentPage: parseInt(page, 10),
            totalPages: Math.ceil(totalUsers / parseInt(limit, 10)),
            totalUsers
        }
    });
};

/**
 * @desc    Изменить роли пользователя, идентифицированного по UUID в query-параметрах.
 * @route   PATCH /api/v2/admin/users/roles
 * @access  Private (role: ADMIN)
 */
const updateUserRoles = async (req, res) => {
    const { uuid } = req.query;
    const { roles } = req.body;
    
    if (!uuid) {
        return res.status(400).json({ msg: 'UUID must be provided as a query parameter.' });
    }
    
    if (!Array.isArray(roles) || !roles.every(r => ['USER', 'COACH', 'ADMIN'].includes(r))) {
        return res.status(400).json({ msg: 'Invalid roles array provided.' });
    }

    const user = await userRepo.findByUuid(uuid);
    if (!user) {
        return res.status(404).json({ msg: 'User not found.' });
    }

    const nextRoles = [...new Set(roles)];

    if (nextRoles.includes('COACH')) {
        await Coach.findOneAndUpdate(
            { user: user._id },
            { $setOnInsert: { user: user._id } },
            { upsert: true }
        );
    }

    await userRepo.updateRoles(user._id, nextRoles);

    res.json({ msg: 'User roles updated successfully.', roles: nextRoles });
};


/**
 * @desc    Верифицировать пользователя как тренера, идентифицированного по UUID в query-параметрах.
 * @route   PATCH /api/v2/admin/users/verify-coach
 * @access  Private (role: ADMIN)
 */
const verifyCoach = async (req, res) => {
    const { uuid } = req.query; 

    if (!uuid) {
        return res.status(400).json({ msg: 'UUID must be provided as a query parameter.' });
    }
    
    const user = await userRepo.findByUuid(uuid);
    if (!user) {
        return res.status(404).json({ msg: 'User with this UUID not found.' });
    }

    // Верифицировать можно тренера ИЛИ админа (у админа может быть тренерский профиль без роли COACH).
    if (!user.roles.includes('COACH') && !user.roles.includes('ADMIN')) {
        return res.status(400).json({ msg: 'Cannot verify: user is neither a coach nor an admin.', code: 'NOT_COACH_OR_ADMIN' });
    }

    const coachProfile = await Coach.findOneAndUpdate(
        { user: user._id },
        { isVerified: true },
        { new: true }
    );

    if (!coachProfile) {
        return res.status(404).json({ msg: 'Coach profile not found for this user. Cannot verify.' });
    }
    
    res.json({ msg: 'Coach status has been successfully verified.', coachProfile });
};


module.exports = {
    getUsers,
    updateUserRoles,
    verifyCoach,
};