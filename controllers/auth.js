const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken'); // <-- Используем require
const crypto = require('crypto'); // <-- Используем require
const { validationResult } = require('express-validator');
const User = require('../models/User'); // <-- Используем require
const Player = require('../models/Player'); // <-- Используем require
const Role = require('../models/Role'); // <-- Используем require
const { sendVerificationEmail } = require('../utils/nodemailer'); // <-- Используем require

// --- 2. Улучшение производительности: Загружаем дефолтный аватар один раз при старте ---
const defaultAvatarPath = path.join(__dirname, '..', 'public', 'images', 'default-avatar.png');
const DEFAULT_AVATAR_BUFFER = fs.readFileSync(defaultAvatarPath);


// --- 3. Генерация криптографически надежного токена ---
const generateSecureToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// 🔐 Generate JWT Token
const generateAccessToken = (id, roles) => {
  return jwt.sign({ id, roles }, process.env.JWT_SECRET, { expiresIn: "24h" });
};

// 📝 Registration
const registration = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const existingUser = await User.findOne({ email: req.body.email.toLowerCase() });
  if (existingUser) {
    return res.status(400).json({ msg: req.t('api.userExistsError') });
  }

  // --- Используем новую безопасную функцию для генерации токена ---
  const verificationToken = generateSecureToken();
  const userRole = await Role.findOne({ value: "user" });

  const user = new User({
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email.toLowerCase(),
    password: req.body.password, // Пароль будет хеширован pre-save хуком в модели
    emailVerified: false,
    verificationToken,
    verificationTokenExpires: Date.now() + 24 * 60 * 60 * 1000, // 4. Токен действует 24 часа
    roles: [userRole.value],
    avatar: {
      data: DEFAULT_AVATAR_BUFFER,
      contentType: 'image/png'
    }
  });
  await user.save();

  // Создание профиля игрока
  const player = new Player({ user: user._id });
  await player.save();

  await sendVerificationEmail(user.email, verificationToken, req.t);

  // --- 5. УДАЛЕН небезопасный токен из ответа ---
  res.status(201).json({
    msg: req.t('api.registrationSuccess'),
    email: user.email,
  });
};

// 🔐 Login
const login = async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password;
  const user = await User.findOne({ email });

  // --- 6. Защита от перечисления пользователей: общая ошибка ---
  const isPasswordMatch = user ? await user.comparePassword(password) : false;

  if (!user || !isPasswordMatch) {
    return res.status(401).json({ msg: req.t('api.invalidCredentials') }); // Используем 401 Unauthorized
  }

  if (!user.emailVerified) {
    return res.status(403).json({ msg: req.t('api.emailNotVerified') }); // Используем 403 Forbidden
  }

  const token = generateAccessToken(user._id, user.roles);

  // --- 7. Защита от утечки данных: отправляем только нужные поля ---
  res.status(200).json({
    token,
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: user.roles,
    },
  });
};

// ✅ Verify email
const verifyEmail = async (req, res) => {
  // --- 8. Учитываем срок действия токена ---
  const user = await User.findOne({
    verificationToken: req.query.token,
    verificationTokenExpires: { $gt: Date.now() } // Проверяем, что токен не истек
  });

  if (!user) {
    return res.status(400).json({ msg: req.t('api.invalidOrExpiredToken') });
  }

  user.emailVerified = true;
  user.verificationToken = undefined;
  user.verificationTokenExpires = undefined;
  await user.save();

  res.json({ msg: req.t('api.emailVerifiedSuccess') });
};

// 🔁 Resend verification email
const resendVerificationEmail = async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });

  // --- 9. Тихий ответ, если пользователь не найден, для защиты от перечисления ---
  if (!user) {
    return res.json({ msg: req.t('api.resendSuccess') });
  }

  if (user.emailVerified) {
    return res.status(200).json({ msg: req.t('api.emailAlreadyVerified') });
  }

  // --- 10. Защита от спама (Rate Limiting) ---
  if (user.verificationEmailSentAt && (Date.now() - user.verificationEmailSentAt) < 120000) { // 2 минуты
    return res.status(429).json({ msg: req.t('api.tooManyRequests') });
  }

  user.verificationToken = generateSecureToken();
  user.verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;
  user.verificationEmailSentAt = Date.now();
  await user.save();

  await sendVerificationEmail(user.email, user.verificationToken, req.t);

  res.json({ msg: req.t('api.resendSuccess') });
};

// ✅ Check email verification status
const checkVerificationStatus = async (req, res) => {
  const { email } = req.query; // Ищем по email, а не по токену
  if (!email) {
    return res.status(400).json({ msg: "Email query parameter is required" });
  }
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return res.status(404).json({ msg: 'User not found' }); // Здесь 404 - нормально, так как эндпоинт авторизован
  }

  res.json({ emailVerified: user.emailVerified });
};


// 👥 Get all users (admin only)
const getUsers = async (req, res) => {
  // --- 11. Исключаем приватные поля ---
  const users = await User.find().select('-password -verificationToken -verificationTokenExpires');
  res.json(users);
};


// 👤 Get current user profile
const getProfile = async (req, res) => {
  // `select('-password')` уже исключает пароль. Это хорошо.
  const user = await User.findById(req.user.id).select('-password -verificationToken -verificationTokenExpires');
  if (!user) {
    return res.status(404).json({ msg: req.t('userNotFound') });
  }

  res.json(user); // Возвращаем объект User без лишних манипуляций, Mongoose позаботится о JSON
};

// 🖼 Get avatar image by user ID
const getAvatar = async (req, res) => {
  // Этот эндпоинт публичный, любой может посмотреть аватар. Это нормально, если так и задумано.
  const user = await User.findById(req.params.id).select('avatar');
  if (!user || !user.avatar?.data) {
    return res.status(404).json({ msg: 'Avatar not found' });
  }

  res.set('Content-Type', user.avatar.contentType);
  res.send(user.avatar.data);
};

// ✏️ Update profile
const updateProfile = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ msg: req.t('userNotFound') });

  // Обновление основных полей
  user.firstName = req.body.firstName || user.firstName;
  user.lastName = req.body.lastName || user.lastName;

  // Обновление профиля тренера
  if (user.roles.includes('coach')) {
    user.coachProfile = { ...user.coachProfile, ...req.body.coachProfile };
  }

  // Обновление аватара
  if (req.file) {
    user.avatar = { data: req.file.buffer, contentType: req.file.mimetype };
  }

  // --- 12. Безопасная смена email ---
  if (req.body.email && req.body.email.toLowerCase() !== user.email) {
    const newEmail = req.body.email.toLowerCase();
    const existingUser = await User.findOne({ email: newEmail });
    if (existingUser) {
      return res.status(400).json({ msg: req.t('api.emailTakenError') });
    }
    user.email = newEmail;
    user.emailVerified = false; // Требуем новую верификацию
    user.verificationToken = generateSecureToken();
    user.verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;
    await sendVerificationEmail(user.email, user.verificationToken, req.t);
  }

  // --- Безопасная смена пароля (код не изменился, но подтверждаю, что он верен) ---
  if (req.body.newPassword) {
    if (!req.body.currentPassword) {
      return res.status(400).json({ msg: req.t('api.currentPasswordRequired') });
    }
    const isMatch = await user.comparePassword(req.body.currentPassword);
    if (!isMatch) {
      return res.status(400).json({ msg: req.t('api.invalidCurrentPassword') });
    }
    user.password = req.body.newPassword;
  }

  await user.save();

  // --- Отправляем обратно только безопасные данные ---
  const updatedUser = user.toObject();
  delete updatedUser.password;
  delete updatedUser.verificationToken;
  delete updatedUser.verificationTokenExpires;

  res.json({
    msg: req.t('api.profileUpdatedSuccess'),
    user: updatedUser,
  });
};

module.exports = {
  registration, 
  login, 
  verifyEmail, 
  resendVerificationEmail, 
  checkVerificationStatus,
  getUsers, 
  getProfile, 
  getAvatar, 
  updateProfile,
};