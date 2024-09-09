const controller = require('../controllers/auth')
const express = require('express');
const {check} = require('express-validator');
const router = express.Router();
const authMiddleware = require('../middleware/auth')
const roleMiddleware = require('../middleware/role')

router.post('/register', [
    check('firstName', "Firstname cannot be empty").notEmpty(),
    check('lastName', "Lastname cannot be empty").notEmpty(),
    check('email', "Email cannot be empty").notEmpty(),
    check('password', "Password name cannot be empty").isLength({min: 8, max: 20}),

], controller.registration);

router.post('/login', controller.login);

router.get('/users', roleMiddleware(['admin']), controller.getUsers);

module.exports = router;
