const User = require('../models/User');
const { findUserByEmail } = require('../utils/userUtils');
const errorHandler = require('../middleware/errorHandler');

// 🔁 1. Обновить роль пользователя
const updateUserRole = errorHandler(async (req, res) => {
  const { userEmail, role, action } = req.body;

  const user = await findUserByEmail(userEmail);

  if (action === 'add') {
    if (user.roles.includes(role)) {
      return res.status(400).json({ msg: 'User already has this role' });
    }
    user.roles.push(role);
  } else if (action === 'remove') {
    if (!user.roles.includes(role)) {
      return res.status(400).json({ msg: `User does not have role: ${role}` });
    }
    user.roles = user.roles.filter(r => r !== role);
  } else {
    return res.status(400).json({ msg: 'Invalid action' });
  }

  await user.save();
  res.json({ msg: `Role ${role} ${action === 'add' ? 'added' : 'removed'} successfully` });
});

// 🔁 2. Получить детали пользователя по ID
const getUserDetails = errorHandler(async (req, res) => {
  const user = await User.findById(req.query.userId).select('+password');
  if (!user) {
    return res.status(404).json({ msg: 'User not found' });
  }

  res.json({
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    password: user.password,
    roles: user.roles,
    students: user.students,
    trainer: user.trainer,
    trainerEmail: user.trainerEmail,
    createdAt: user.createdAt,
  });
});

// 🔁 3. Получить всех админов
const getAdmins = errorHandler(async (req, res) => {
  const admins = await User.find({ roles: 'admin' }).select('-password');
  if (!admins.length) {
    return res.status(404).json({ msg: 'No admins found' });
  }

  res.status(200).json(admins);
});

module.exports = {
  updateUserRole,
  getUserDetails,
  getAdmins,
};
