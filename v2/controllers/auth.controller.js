// const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { randomBytes, randomUUID } = require('crypto'); 
const User = require('../models/User'); // Все модели V2 живут в v2/models/
const Player = require('../models/Player');
const { sendVerificationEmailV2 } = require('../utils/email/email.service'); 

/**
 * Утилита для генерации JWT токена.
 * Может быть вынесена в отдельный файл /v2/utils/token.js
 */
const generateAccessToken = (id, roles, sessionTokenVersion, uuid) => {
    const payload = { id, roles, sessionTokenVersion, uuid, ver: 2 };
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '6h' });
};

/**
 * @desc    Регистрация нового пользователя
 * @route   POST /api/v2/auth/register
 * @access  Public
 */
const register = async (req, res) => {
    const { firstName, lastName, email, password } = req.body;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
        return res.status(400).json({ msg: req.t('api.userExistsError') });
    }
    const avatarName = `${firstName}+${lastName}`;
    const defaultAvatarUrl = `https://ui-avatars.com/api/?name=${avatarName}&background=random&color=fff`;

    const verificationToken = randomUUID();
    const user = new User({
        firstName,
        lastName,
        email: email.toLowerCase(),
        password,
        roles: ['USER'],
        verificationToken,
        avatarUrl: defaultAvatarUrl, 
    });
    await user.save();

    const player = new Player({ user: user._id });
    await player.save();

    await sendVerificationEmailV2(user.email, verificationToken, req.t);

    // email возвращаем, чтобы фронт показал страницу "проверьте почту" и опрашивал статус
    res.status(201).json({ msg: req.t('api.registrationSuccess'), email: user.email });
};

/**
 * @desc    Вход пользователя в систему
 * @route   POST /api/v2/auth/login
 * @access  Public
 */
const login = async (req, res) => {
    const { email, password } = req.body;
    const { t } = req;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
        return res.status(400).json({ msg: t('api.auth.invalidCredentials') });
    }

    if (!user.emailVerified) {
        return res.status(400).json({ msg: t('api.auth.verifyEmailFirst') });
    }

    user.sessionTokenVersion += 1;
    await user.save();

    const token = generateAccessToken(user._id, user.roles, user.sessionTokenVersion, user.uuid);

    res.status(200).json({
        token,
        user: {
            // id: user._id, // Внутренний ID для приватных запросов
            uuid: user.uuid, // Публичный ID для URL
            // firstName: user.firstName,
            // email: user.email,
            roles: user.roles,
        }
    });
};

/**
 * @desc    Верификация email по токену из письма
 * @route   GET /api/v2/auth/verify-email?token=...
 * @access  Public
 */
const verifyEmail = async (req, res) => {
    const { token } = req.query;
    const { t } = req;

    const user = await User.findOne({ verificationToken: token });
    if (!user) {
        return res.status(400).json({ msg: t('api.auth.invalidToken') });
    }

    user.emailVerified = true;
    user.verificationToken = undefined;
    await user.save();

    res.json({ msg: t('api.auth.emailVerifiedSuccess') });
};


/**
 * @desc    Повторная отправка письма для верификации
 * @route   POST /api/v2/auth/resend-verification
 * @access  Public
 */
const resendVerificationEmail = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;
    const { t } = req;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
        // Мы не говорим, что юзер не найден, из соображений безопасности
        return res.json({ msg: t('api.auth.ifEmailExistsThenSent') });
    }

    if (user.emailVerified) {
        return res.status(400).json({ msg: t('api.auth.emailAlreadyVerified') });
    }

    const newVerificationToken = randomBytes(32).toString('hex');
    user.verificationToken = newVerificationToken;
    await user.save();

    await sendVerificationEmailV2(user.email, newVerificationToken, t);

    res.json({ msg: t('api.auth.verificationResentSuccess') });
};


/**
 * @desc    Проверяет статус верификации email по токену.
 *          Используется фронтендом для "ожидания" подтверждения.
 * @route   POST /api/v2/auth/check-verification
 * @access  Public
 */
const checkVerificationStatus = async (req, res) => {
    // Вкладка "проверьте почту" опрашивает статус по email (токен лежит только в письме)
    const email = req.query.email;

    if (!email) {
        return res.status(400).json({ emailVerified: false });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() }).select('emailVerified');

    if (!user) {
        return res.status(404).json({ emailVerified: false });
    }

    res.json({ emailVerified: user.emailVerified });
};


module.exports = {
    register,
    login,
    verifyEmail,
    resendVerificationEmail,
    checkVerificationStatus
};