// v2/controllers/admin.controller.js

const User = require('../models/User');
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

    const query = {}; // Начинаем с пустого объекта для фильтров

    // Динамически строим объект query на основе переданных параметров
    if (uuid) {
        query.uuid = uuid;
    }
    if (email) {
        // Используем case-insensitive regex для поиска по части email
        query.email = { $regex: email, $options: 'i' };
    }
    if (role) {
        query.roles = role; // Ищет пользователей, у которых есть указанная роль в массиве
    }
    
    // Пагинация
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    
    const users = await User.find(query)
        .select('-password -verificationToken -sessionTokenVersion')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10));

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
    const totalUsers = await User.countDocuments(query);
    
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

    const user = await User.findOne({ uuid });
    if (!user) {
        return res.status(404).json({ msg: 'User not found.' });
    }

    user.roles = [...new Set(roles)];

    if (user.roles.includes('COACH')) {
        await Coach.findOneAndUpdate(
            { user: user._id },
            { $setOnInsert: { user: user._id } },
            { upsert: true }
        );
    }
    
    await user.save();
    
    res.json({ msg: 'User roles updated successfully.', roles: user.roles });
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
    
    const user = await User.findOne({ uuid });
    if (!user) {
        return res.status(404).json({ msg: 'User with this UUID not found.' });
    }

    if (!user.roles.includes('COACH')) {
        return res.status(400).json({ msg: 'Cannot verify: user does not have the COACH role.' });
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