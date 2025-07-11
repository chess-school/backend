const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Player = require('../models/Player');
const Role = require('../models/Role');
const { auth } = require('../config/firebase');
const errorHandler = require('../middleware/errorHandler');
const { sendVerificationEmail } = require('../utils/nodemailer');

// 🔐 Generate JWT Token
const generateAccessToken = (id, roles) => {
  return jwt.sign({ id, roles }, process.env.JWT_SECRET, { expiresIn: "24h" });
};

// // 📧 Mail transporter setup (Mailtrap)
// const transporter = nodemailer.createTransport({
//   host: process.env.MAILTRAP_HOST,
//   port: process.env.MAILTRAP_PORT,
//   auth: {
//     user: process.env.MAILTRAP_USER,
//     pass: process.env.MAILTRAP_PASS,
//   },
// });

// 📩 Send verification email
// const sendVerificationEmail = async (email, token) => {
//   const verificationUrl = `${process.env.BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
//   const mailOptions = {
//     from: '"Chess School" <no-reply@chess-school.com>',
//     to: email,
//     subject: 'Verify your email',
//     html: `<p>Welcome to Chess School!</p><p>Please confirm your email:</p><a href="${verificationUrl}">${verificationUrl}</a>`,
//   };
//   await transporter.sendMail(mailOptions);
// };

// 📝 Registration
const registration = errorHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const existingUser = await User.findOne({ email: req.body.email });
  if (existingUser) {
    return res.status(400).json({ msg: req.t('api.userExistsError') });
  }

  const saltRounds = 10;
  const verificationToken = await bcrypt.hash(Date.now().toString(), saltRounds);
  const userRole = await Role.findOne({ value: "user" });
  const defaultAvatarPath = path.join(__dirname, '..', 'public', 'images', 'default-avatar.png');
  const defaultAvatarBuffer = fs.readFileSync(defaultAvatarPath);

  const user = new User({
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    password: req.body.password,
    emailVerified: false,
    verificationToken,
    roles: [userRole.value],
    avatar: {
      data: defaultAvatarBuffer,
      contentType: 'image/png'
    }
  });

  await user.save();

  const player = new Player({
    user: user._id,
    bullet: {},
    blitz: {},
    rapid: {},
    classic: {}
  });
  await player.save();

  // 👇 --- ИЗМЕНЕНИЕ 4: ВЫЗЫВАЕМ НОВУЮ ФУНКЦИЮ ---
  await sendVerificationEmail(req.body.email, verificationToken, req.t);

  res.status(201).json({
    msg: req.t('api.registrationSuccess'),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    // Не рекомендуется отправлять токен обратно в чистом виде, но если он нужен для фронтенда:
    token: encodeURIComponent(verificationToken),
  });
});

// 🔐 Login
const login = errorHandler(async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password;

  const user = await User.findOne({ email: email });
  if (!user) return res.status(400).json({ msg: 'User not found' });

  if (!user.emailVerified) return res.status(400).json({ msg: 'Please verify your email first' });

  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch) return res.status(400).json({ msg: 'Invalid credentials' });

  const token = generateAccessToken(user._id, user.roles);
  res.status(200).json({ user, token });
});

// ✅ Verify email
const verifyEmail = errorHandler(async (req, res) => {
  const user = await User.findOne({ verificationToken: req.query.token, emailVerified: false });
  if (!user) return res.status(400).json({ msg: 'Invalid or expired token' });

  user.emailVerified = true;
  user.verificationToken = undefined;
  await user.save();

  res.json({ msg: 'Email verified successfully' });
});

// 🔁 Resend verification email
const resendVerificationEmail = errorHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email }); // Искать лучше по email
  if (!user) return res.status(404).json({ msg: 'User not found' });

  if (user.emailVerified) {
    return res.status(200).json({ msg: 'Email is already verified.' });
  }

  // Создаем новый токен
  const salt = await bcrypt.genSalt(10);
  const newToken = await bcrypt.hash(Date.now().toString(), salt);
  user.verificationToken = newToken;
  // Можно добавить поле для отслеживания последней отправки, если нужно
  // user.lastEmailSent = new Date();
  await user.save();

  // 👇 --- ИЗМЕНЕНИЕ 3: ВЫЗЫВАЕМ НОВУЮ ФУНКЦИЮ ---
  await sendVerificationEmail(user.email, newToken);

  res.json({ msg: 'Verification email resent successfully' });
});

// ✅ Check email verification status
const checkVerificationStatus = errorHandler(async (req, res) => {
  const user = await User.findOne({ verificationToken: req.body.token });
  if (!user) return res.status(404).json({ msg: 'Invalid or expired token' });

  res.json({ emailVerified: user.emailVerified });
});

// 👥 Get all users (admin only)
const getUsers = errorHandler(async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// 👤 Get current user profile
const getProfile = errorHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(404).json({ msg: 'User not found' });

  const profile = user.toObject();
  profile.photoUrl = user.avatar?.data
    ? `${process.env.BASE_URL}/auth/avatar/${user._id}`
    : null;

  res.json(profile);
});

// 🖼 Get avatar image by user ID
const getAvatar = errorHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || !user.avatar?.data) {
    return res.status(404).json({ msg: 'Avatar not found' });
  }

  res.set('Content-Type', user.avatar.contentType);
  res.send(user.avatar.data);
});

// ✏️ Update profile
const updateProfile = errorHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ msg: 'User not found' });

  // Coach profile section
  if (user.roles.includes('coach')) {
    user.coachProfile = {
      ...user.coachProfile,
      title: req.body.title || user.coachProfile?.title || '',
      experience: req.body.experience || user.coachProfile?.experience || '',
      bio: req.body.bio || user.coachProfile?.bio || '',
      price: req.body.price ?? user.coachProfile?.price,
      services: Array.isArray(req.body.services)
        ? req.body.services
        : user.coachProfile?.services || [],
    };
  }

  // 🔒 Change password
  if (req.body.newPassword) {
    if (!req.body.currentPassword) {
      return res.status(400).json({ msg: 'Current password is required' });
    }

    const isMatch = await bcrypt.compare(req.body.currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid current password' });
    }

    user.password = req.body.newPassword; // 🔐 Will be hashed automatically on save
  }

  // 📝 Update other profile fields
  user.firstName = req.body.firstName || user.firstName;
  user.lastName = req.body.lastName || user.lastName;
  user.email = req.body.email || user.email;

  // 🖼 Update avatar if provided
  if (req.file) {
    user.avatar = {
      data: req.file.buffer,
      contentType: req.file.mimetype,
    };
  }

  await user.save();

  res.json({
    msg: 'Profile updated',
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: user.roles,
      ...(user.roles.includes('coach') && { coachProfile: user.coachProfile }),
    },
  });
});

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
