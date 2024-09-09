const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Role = require('../models/Role');
const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');

const generateAccessToken = (id, roles) => {
    const payload = {
        id,
        roles
    }
    return jwt.sign(payload, process.env.JWT_SECRET, {expiresIn: "24h"} )
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
            const userRole = await Role.findOne({value: "student"})
            if (!userRole) {
                return res.status(400).json({ msg: 'Role not found' });
            }
            user = new User({ firstName, lastName, email, password, roles: [userRole.value] });
            await user.save();

            const token = generateAccessToken(user._id, user.roles);
            return res.json({token});
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
            return res.json({token});
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
    
}


module.exports = new AuthController()