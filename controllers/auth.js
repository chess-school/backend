const User = require('../models/User');
const Player = require('../models/Player');
const jwt = require('jsonwebtoken');
const Role = require('../models/Role');
const { auth } = require('../config/firebase');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');

const generateAccessToken = (id, roles) => {
    const payload = {
        id,
        roles
    };
    return jwt.sign(payload, process.env.JWT_SECRET, {expiresIn: "24h"} );
}

const transporter = nodemailer.createTransport({
    host: process.env.MAILTRAP_HOST,
    port: process.env.MAILTRAP_PORT,
    auth: {
        user: process.env.MAILTRAP_USER,
        pass: process.env.MAILTRAP_PASS,
    },
});

const sendVerificationEmail = async (email, token) => {
    const verificationUrl = `${process.env.BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
    const mailOptions = {
        from: '"Chess School" <no-reply@chess-school.com>',
        to: email,
        subject: 'Verify your email',
        html: `<p>Welcome to Chess School!</p>
               <p>Please confirm your email:</p>
               <a href="${verificationUrl}">${verificationUrl}</a>`,
    };

    await transporter.sendMail(mailOptions);
};

class AuthController {

    async firebaseLogin(req, res) {
        const { idToken } = req.body;

        try {
            const decodedToken = await auth.verifyIdToken(idToken);
            const { uid, email, name, email_verified } = decodedToken;

            if (!email_verified) {
                return res.status(403).json({ msg: 'Email not verified' });
            }

            let user = await User.findOne({ firebaseUID: uid });
            if (!user) {
                const userRole = await Role.findOne({ value: "user" });

                user = new User({
                    firebaseUID: uid,
                    email,
                    firstName: name ? name.split(' ')[0] : 'Unknown',
                    lastName: name ? name.split(' ')[1] || '' : '',
                    roles: [userRole.value],
                });
                await user.save();

                const player = new Player({
                    user: user._id,
                    bullet: {},
                    blitz: {},
                    rapid: {},
                    classic: {},
                });
                await player.save();
            }

            return res.status(200).json({ user, msg: 'OAuth Login successful' });
        } catch (error) {
            console.error('Ошибка Firebase Login:', error.message);
            res.status(403).json({ msg: 'Invalid Firebase token', error: error.message });
        }
    }

    async registration(req, res) {
        const { firstName, lastName, email, password } = req.body;
    
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
    
            const userRole = await Role.findOne({ value: "user" });
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ msg: 'User already exists' });
            }
    
            const saltRounds = 10;
    
            const verificationToken = await bcrypt.hash(Date.now().toString(), saltRounds);
    
            const user = new User({
                firstName,
                lastName,
                email,
                password,
                emailVerified: false,
                verificationToken,
                roles: [userRole.value]
            });
    
            await user.save();
    
            const player = new Player({
                user: user._id,
                bullet: {},
                blitz: {},
                rapid: {},
                classic: {},
            });
    
            await player.save();
    
            await sendVerificationEmail(email, verificationToken);
    
            return res.status(201).json({
                msg: 'Registration successful',
                email,
                firstName,
                lastName,
                token: encodeURIComponent(verificationToken),
            });
        } catch (err) {
            console.error('Registration error:', err);
            return res.status(500).json({ msg: 'Server error' });
        }
    }
    
    async login(req, res) {
        const { email, password } = req.body;
    
        try {
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(400).json({ msg: 'User not found' });
            }
    
            if (!user.emailVerified) {
                return res.status(400).json({ msg: 'Please verify your email first' });
            }
            const isPasswordMatch = await bcrypt.compare(password, user.password);
            console.log(isPasswordMatch)

            if (!isPasswordMatch) {
                return res.status(400).json({ msg: 'Invalid credentials' });
            }
    
            const token = generateAccessToken(user._id, user.roles);
            return res.status(200).json({ user, token });
        } catch (err) {
            console.error('Login error:', err);
            return res.status(500).json({ msg: 'Server error' });
        }
    }
    
    async verifyEmail(req, res) {
        const { token } = req.query; 
    
        try {
            const user = await User.findOne({ verificationToken: token, emailVerified: false });
            
            if (!user) {
                return res.status(400).json({ msg: 'Invalid or expired token' });
            }
    
            user.emailVerified = true;
            user.verificationToken = undefined;
            await user.save();
    
            res.json({ msg: 'Email verified successfully' });
        } catch (error) {
            console.error('Error verifying email:', error);
            res.status(500).json({ msg: 'Server error' });
        }
    }

    async resendVerificationEmail(req, res) {
        const { token } = req.body;
    
        try {
            const user = await User.findOne({ verificationToken: token });
    
            if (!user) {
                return res.status(404).json({ msg: 'User not found or token expired' });
            }
    
            if (user.emailVerified) {
                return res.status(200).json({ msg: 'Email is already verified.' });
            }
    
            const salt = await bcrypt.genSalt(10);
            const newToken = await bcrypt.hash(Date.now().toString(), salt);
            user.verificationToken = newToken;
    
            user.lastEmailSent = new Date();
            await user.save();
    
            const verificationUrl = `${process.env.BASE_URL}/auth/verify-email?token=${encodeURIComponent(newToken)}`;
            const mailOptions = {
                from: '"Chess School" <no-reply@chess-school.com>',
                to: user.email,
                subject: 'Verify your email',
                html: `<p>Please confirm your email:</p>
                       <a href="${verificationUrl}">${verificationUrl}</a>`,
            };
    
            await transporter.sendMail(mailOptions);
    
            res.json({ msg: 'Verification email resent successfully' });
        } catch (error) {
            console.error('Error resending verification email:', error);
            res.status(500).json({ msg: 'Server error' });
        }
    }    
    
    async checkVerificationStatus(req, res) {
        const { token } = req.body;
      
        try {
          const user = await User.findOne({ verificationToken: token });
      
          if (!user) {
            return res.status(404).json({ msg: 'Invalid or expired token' });
          }
      
          return res.json({ emailVerified: user.emailVerified });
        } catch (error) {
          console.error('Error checking verification status:', error);
          res.status(500).json({ msg: 'Server error' });
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
    
            if (newPassword) {
                if (!currentPassword) {
                    return res.status(400).json({ msg: 'Для смены пароля укажите текущий пароль' });
                }
    
                const isMatch = await bcrypt.compare(currentPassword, user.password);
                if (!isMatch) {
                    return res.status(400).json({ msg: 'Неверный текущий пароль' });
                }
                user.password = newPassword; 
            }
    
            if (firstName) user.firstName = firstName;
            if (lastName) user.lastName = lastName;
            if (email) user.email = email;
    
            await user.save();
    
            res.json({
                msg: 'Данные профиля обновлены',
                user: {
                    id: user._id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    roles: user.roles,
                    registrationDate: user.registrationDate,
                },
            });
        } catch (error) {
            console.error('Ошибка при обновлении профиля:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }
}


module.exports = new AuthController();