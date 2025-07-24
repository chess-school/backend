const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const Player = require('../models/Player');
const Role = require('../models/Role');
const { sendVerificationEmail } = require('../utils/nodemailer');
const mongoose = require('mongoose');

// 🔐 Generate JWT Token
const generateAccessToken = (id, roles, sessionTokenVersion) => {
    const payload = {
        id: id,
        roles: roles,
        sessionTokenVersion: sessionTokenVersion
    };
    
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '6h' });
};

// 📝 Registration 
const registration = async (req, res) => {
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

  await sendVerificationEmail(req.body.email, verificationToken, req.t);

  res.status(201).json({
    msg: req.t('api.registrationSuccess'),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    token: encodeURIComponent(verificationToken),
  });
};

// 🔐 Login
const login = async (req, res) => {
    const { t } = req;
    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    const user = await User.findOne({ email: email });
    if (!user) return res.status(400).json({ msg: t('api.auth.userNotFound') });

    if (!user.emailVerified) return res.status(400).json({ msg: t('api.auth.verifyEmailFirst') });

    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) return res.status(400).json({ msg: t('api.auth.invalidCredentials') });

    user.sessionTokenVersion = (user.sessionTokenVersion || 0) + 1;
    await user.save();

    const token = generateAccessToken(user._id, user.roles, user.sessionTokenVersion);

    res.status(200).json({ user, token });
};

// ✅ Verify email
const verifyEmail = async (req, res) => {
  const { t } = req;
  const user = await User.findOne({ verificationToken: req.query.token, emailVerified: false });
  if (!user) return res.status(400).json({ msg: t('api.auth.invalidToken') });

  user.emailVerified = true;
  user.verificationToken = undefined;
  await user.save();

  res.json({ msg: t('api.auth.emailVerifiedSuccess') });
};

// 🔁 Resend verification email
const resendVerificationEmail = async (req, res) => {
  const { t } = req;
  const user = await User.findOne({ email: req.body.email });
  if (!user) return res.status(404).json({ msg: t('api.auth.userNotFound') });

  if (user.emailVerified) {
    return res.status(200).json({ msg: t('api.auth.emailAlreadyVerified') });
  }

  const salt = await bcrypt.genSalt(10);
  const newToken = await bcrypt.hash(Date.now().toString(), salt);
  user.verificationToken = newToken;
  await user.save();

  await sendVerificationEmail(user.email, newToken, t);

  res.json({ msg: t('api.auth.verificationResentSuccess') });
};

// ✅ Check email verification status
const checkVerificationStatus = async (req, res) => {
  const { t } = req;
  const user = await User.findOne({ verificationToken: req.body.token });
  if (!user) return res.status(404).json({ msg: t('api.auth.invalidToken') });

  res.json({ emailVerified: user.emailVerified });
};

const getUsers = async (req, res) => {
  const users = await User.find();
  res.json(users);
};

// 👤 Get current user profile
const getProfile = async (req, res) => {
  const { t } = req;
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(404).json({ msg: t('api.auth.userNotFound') });

  const profile = user.toObject();
  profile.photoUrl = user.avatar?.data
    ? `${process.env.BASE_URL}/auth/avatar/${user._id}`
    : null;

  res.json(profile);
};

const getProfileById = async (req, res) => {
    const { userId } = req.params; 

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ msg: 'Invalid user ID format' });
    }

    const user = await User.findById(userId)
        .select('-password -verificationToken -sessionTokenVersion'); 
    
    if (!user) {
        return res.status(404).json({ msg: req.t('api.auth.userNotFound') });
    }

    const profile = user.toObject();

    profile.photoUrl = user.avatar?.data
        ? `${process.env.BASE_URL}/api/auth/avatar/${user._id}` 
        : null;

    res.json(profile);
};


// 🖼 Get avatar image by user ID
const getAvatar = async (req, res) => {
  const { t } = req;
  const user = await User.findById(req.params.id);
  if (!user || !user.avatar?.data) {
    return res.status(404).json({ msg: t('api.auth.avatarNotFound') });
  }

  res.set('Content-Type', user.avatar.contentType);
  res.send(user.avatar.data);
};

// ✏️ Update profile
const updateProfile = async (req, res) => {
  const { t } = req;
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ msg: t('api.auth.userNotFound') });

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

  if (req.body.newPassword) {
    if (!req.body.currentPassword) {
      return res.status(400).json({ msg: t('api.auth.currentPasswordRequired') });
    }

    const isMatch = await bcrypt.compare(req.body.currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: t('api.auth.invalidCurrentPassword') });
    }

    user.password = req.body.newPassword; 
  }

  user.firstName = req.body.firstName || user.firstName;
  user.lastName = req.body.lastName || user.lastName;
  user.email = req.body.email || user.email;

  if (req.file) {
    user.avatar = {
      data: req.file.buffer,
      contentType: req.file.mimetype,
    };
  }

  await user.save();

  res.json({
    msg: t('api.auth.profileUpdatedSuccess'),
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: user.roles,
      ...(user.roles.includes('coach') && { coachProfile: user.coachProfile }),
    },
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
  getProfileById,
  getAvatar,
  updateProfile,
};