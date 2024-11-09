const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Role = require('../models/Role');
const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');

const generateAccessToken = (id, roles) => {
    const payload = {
        id,
        roles
    };
    return jwt.sign(payload, process.env.JWT_SECRET, {expiresIn: "24h"} );
}

class AuthController {
    async registration(req, res) {
        const { firstName, lastName, email, password } = req.body;
    
        try {
            const errors = validationResult(req);
            if(!errors.isEmpty()) {
                return res.status(500).send(errors);
            }
            let user = await User.findOne({ email });
            if (user) {
                return res.status(400).json({ msg: 'User already exists' });
            }
            const userRole = await Role.findOne({value: "user"})
            if (!userRole) {
                return res.status(400).json({ msg: 'Role not found' });
            }
            user = new User({ firstName, lastName, email, password, roles: [userRole.value] });
            await user.save();

            const token = generateAccessToken(user._id, user.roles);
            return res.json({user, token});
        } catch (err) {
            res.status(500).send(err);
        }
    }

    async login(req, res) {
        const { email, password } = req.body;

        try {
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(400).json({ msg: 'User not found' });
            }
    
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ msg: 'Invalid credentials' });
            }
            const token = generateAccessToken(user._id, user.roles);
            return res.json({user, token});
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Server error');
        }
    }

    async getUsers(req, res) {
        try {
            const users = await User.find();
            res.json(users);
        } catch (err) {
            res.status(500).send(err);
        }
    }

    async getProfile(req, res) {
        try {
            const userId = req.user.id;
            const user = await User.findById(userId).select('-password');
            if (!user) {
                return res.status(404).json({ msg: 'Пользователь не найден' });
            }
            res.json(user);
        } catch (error) {
            console.error('Ошибка при получении профиля:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }

    async updateProfile(req, res) {
        const { firstName, lastName, email, currentPassword, newPassword } = req.body;
        try {
            const userId = req.user.id;
            const user = await User.findById(userId);

            if (!user) {
                return res.status(404).json({ msg: 'Пользователь не найден' });
            }

            if (currentPassword && newPassword) {
                const isMatch = await bcrypt.compare(currentPassword, user.password);
                if (!isMatch) {
                    return res.status(400).json({ msg: 'Неверный текущий пароль' });
                }
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(newPassword, salt);
            }

            if (firstName) user.firstName = firstName;
            if (lastName) user.lastName = lastName;
            if (email) user.email = email;

            await user.save();
            res.json({ msg: 'Данные профиля обновлены' });
        } catch (error) {
            console.error('Ошибка при обновлении профиля:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }  
}


module.exports = new AuthController();