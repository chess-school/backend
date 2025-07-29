const User = require('../models/User'); // Пути ../models/ должны быть правильными
const mongoose = require('mongoose');

/**
 * @desc    Получение профиля текущего пользователя
 * @route   GET /api/v2/users/me
 * @access  Private
 */
const getMyProfile = async (req, res) => {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
        return res.status(404).json({ msg: 'User not found.' });
    }
    const userResponse = user.toObject();
    delete userResponse.__v;
    res.json(userResponse);
};

/**
 * @desc    Обновление базовых данных профиля (имя, фамилия, смена пароля)
 * @route   PUT /api/v2/users/me
 * @access  Private
 */
const updateMyProfile = async (req, res) => {
    const { firstName, lastName, currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    const { t } = req;

    const user = await User.findById(userId);
    if (!user) {
        return res.status(404).json({ msg: 'User not found' });
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    
    if (newPassword) {
        if (!currentPassword) {
            return res.status(400).json({ msg: t('api.auth.currentPasswordRequired') });
        }
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(400).json({ msg: t('api.auth.invalidCurrentPassword') });
        }
        user.password = newPassword;
    }

    await user.save();
    
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({ 
        msg: t('api.auth.profileUpdatedSuccess'), 
        user: userResponse 
    });
};

/**
 * @desc    Загрузка или обновление аватара пользователя
 * @route   POST /api/v2/users/me/avatar
 * @access  Private
 */
const updateMyAvatar = async (req, res) => {
    // Для реализации этого эндпоинта нужно:
    // 1. Настроить middleware для загрузки файла не в память, а на S3/Cloudinary.
    // 2. Получить URL загруженного файла от этого сервиса.
    // 3. Сохранить этот URL в user.avatarUrl.
    
    // В текущей реализации мы временно отключаем эту возможность.
    return res.status(501).json({ msg: 'Custom avatar upload is not implemented yet.' });
};

/**
 * @desc    Получение аватара пользователя по его UUID
 * @route   GET /api/v2/users/:uuid/avatar
 * @access  Public
 */
const getAvatarByUuid = async (req, res) => {
    const { uuid } = req.params;

    // Ищем пользователя и получаем только URL его аватара
    const user = await User.findOne({ uuid }).select('avatarUrl');
    
    if (!user || !user.avatarUrl) {
        // Если у пользователя по какой-то причине нет аватара, 
        // можно сгенерировать дефолтный на лету или вернуть 404.
        // Вернем 404, чтобы фронтенд показал свой плейсхолдер.
        return res.status(404).json({ msg: 'Avatar not found' });
    }
    
    // Вместо отправки данных, мы делаем перенаправление на внешний URL!
    return res.redirect(302, user.avatarUrl);
};


module.exports = {
    getMyProfile,
    updateMyProfile,
    updateMyAvatar,
    getAvatarByUuid
};