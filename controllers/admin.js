const User = require('../models/User');
const { findUserByEmail } = require('../utils/userUtils');

// 🔁 1. Обновить роль пользователя
const updateUserRole = async (req, res) => {
  const { userEmail, role, action } = req.body;
  const { t } = req; 

  const user = await findUserByEmail(userEmail);

  if (action === 'add') {
    if (user.roles.includes(role)) {
      return res.status(400).json({ msg: t('api.admin.roleAlreadyExists') });
    }
    user.roles.push(role);
  } else if (action === 'remove') {
    if (!user.roles.includes(role)) {
      return res.status(400).json({ msg: t('api.admin.roleNotFound') });
    }
    user.roles = user.roles.filter(r => r !== role);
  } else {
    return res.status(400).json({ msg: t('api.admin.invalidAction') });
  }

  await user.save();
  const messageKey = action === 'add' ? 'api.admin.roleAddedSuccess' : 'api.admin.roleRemovedSuccess';
  res.json({ msg: t(messageKey, { role }) });
};

// 🔁 2. Получить детали пользователя по ID
const getUserDetails = async (req, res) => {
  const { t } = req;
  const user = await User.findById(req.query.userId).select('-password');
  if (!user) {
    return res.status(404).json({ msg: t('api.admin.userNotFound') });
  }
  res.json({
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    roles: user.roles,
    students: user.students,
    trainer: user.trainer,
    trainerEmail: user.trainerEmail,
    createdAt: user.createdAt,
  });
};

// 🔁 3. Получить всех админов
const getAdmins = async (req, res) => {
  const { t } = req;
  const admins = await User.find({ roles: 'admin' }).select('-password');

  res.status(200).json(admins);
};

module.exports = {
  updateUserRole,
  getUserDetails,
  getAdmins,
};
