const userRepo = require('../repositories/user.repo'); // шов identity (mongo|pg по USER_DB)

// Белый список хостов, на которые разрешено делать редирект аватаром.
// ui-avatars.com — дефолтные аватары (см. auth.controller.js), остальные — наши CDN.
const ALLOWED_AVATAR_HOSTS = new Set([
    'ui-avatars.com',
]);

// Проверяем, что URL — абсолютный https и его хост в белом списке.
// Защита от open redirect: пользователь задаёт avatarUrl сам.
const isAllowedAvatarUrl = (rawUrl) => {
    if (typeof rawUrl !== 'string' || !rawUrl.startsWith('https://')) {
        return false;
    }
    try {
        const { protocol, hostname } = new URL(rawUrl);
        return protocol === 'https:' && ALLOWED_AVATAR_HOSTS.has(hostname.toLowerCase());
    } catch (e) {
        return false;
    }
};

// Дефолтный аватар на лету (тот же сервис, что и при регистрации в auth.controller.js).
const buildDefaultAvatarUrl = (user) => {
    const avatarName = `${user.firstName || ''}+${user.lastName || ''}`;
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarName)}&background=random&color=fff`;
};

/**
 * @desc    Получение профиля текущего пользователя
 * @route   GET /api/v2/users/me
 * @access  Private
 */
const getMyProfile = async (req, res) => {
    const user = await userRepo.findById(req.user.id);
    if (!user) {
        return res.status(404).json({ msg: 'User not found.' });
    }
    res.json(user);
};

/**
 * @desc    Обновление базовых данных профиля (имя, фамилия, смена пароля)
 * @route   PUT /api/v2/users/me
 * @access  Private
 */
const updateMyProfile = async (req, res) => {
    const { firstName, lastName, phone, currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    const { t } = req;

    const existing = await userRepo.findByIdForAuth(userId);
    if (!existing) {
        return res.status(404).json({ msg: 'User not found' });
    }

    // Смену пароля проверяем ДО записи профиля (неверный текущий пароль ничего не меняет)
    if (newPassword) {
        if (!currentPassword) {
            return res.status(400).json({ msg: t('api.auth.currentPasswordRequired') });
        }
        const isMatch = await userRepo.comparePassword(existing, currentPassword);
        if (!isMatch) {
            return res.status(400).json({ msg: t('api.auth.invalidCurrentPassword') });
        }
    }

    const patch = {};
    if (firstName) patch.firstName = firstName;
    if (lastName) patch.lastName = lastName;
    // phone: строка E.164 (уже провалидирована в роуте) или null/'' — очистить
    if (phone !== undefined) patch.phone = phone || null;
    if (Object.keys(patch).length) await userRepo.updateProfile(userId, patch);

    if (newPassword) await userRepo.updatePassword(userId, newPassword);

    const userResponse = await userRepo.findById(userId); // свежий публичный документ (без пароля)

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

    // Ищем пользователя и получаем URL его аватара (+ имя для дефолтного аватара)
    const user = await userRepo.findByUuid(uuid);

    if (!user) {
        // Вернем 404, чтобы фронтенд показал свой плейсхолдер.
        return res.status(404).json({ msg: 'Avatar not found' });
    }

    // avatarUrl задаётся пользователем — редиректим только на доверенные хосты (защита от open redirect).
    // Невалидный/сторонний URL заменяем на дефолтный аватар, а не раскрываем его.
    const target = isAllowedAvatarUrl(user.avatarUrl) ? user.avatarUrl : buildDefaultAvatarUrl(user);

    // Вместо отправки данных, мы делаем перенаправление на внешний URL!
    return res.redirect(302, target);
};


/**
 * @desc    Публичный профиль пользователя по UUID (для просмотра чужого профиля —
 *          напр. тренер смотрит ученика, страница клуба). Только НЕсекретные поля:
 *          email/phone/emailVerified НЕ отдаём третьим лицам.
 * @route   GET /api/v2/users/:uuid
 * @access  Private (любой авторизованный)
 */
const getPublicProfileByUuid = async (req, res) => {
    const { uuid } = req.params;
    const user = await userRepo.findByUuid(uuid);
    if (!user) {
        return res.status(404).json({ msg: 'User not found.' });
    }
    res.json({
        uuid: user.uuid,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        roles: user.roles,
        ratings: user.ratings,
        createdAt: user.createdAt,
    });
};


module.exports = {
    getMyProfile,
    updateMyProfile,
    updateMyAvatar,
    getAvatarByUuid,
    getPublicProfileByUuid
};