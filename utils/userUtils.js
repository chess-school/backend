const User = require('../models/User');

const findUserByEmail = async (email) => {
    const user = await User.findOne({ email });
    if (!user) throw new Error('User not found');
    return user;
};

const findUserById = async (id) => {
    const user = await User.findById(id);
    if (!user) throw new Error('User not found');
    return user;
};

const checkUserRole = (user, role) => {
    if (!user.roles.includes(role)) throw new Error(`User is not a ${role}`);
};

module.exports = { findUserByEmail, findUserById, checkUserRole };
