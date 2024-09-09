const authController = require('./controllers/auth')
const coachController = require('./controllers/coach');
const adminController = require('./controllers/admin');
const express = require('express');
const {check} = require('express-validator');
const router = express.Router();
const authMiddleware = require('./middleware/auth')
const roleMiddleware = require('./middleware/role')

router.post('/auth/register', [
    check('firstName', "Firstname cannot be empty").notEmpty(),
    check('lastName', "Lastname cannot be empty").notEmpty(),
    check('email', "Email cannot be empty").notEmpty(),
    check('password', "Password name cannot be empty").isLength({min: 8, max: 20}),

], authController.registration);

router.post('/auth/login', authController.login);

router.get('/auth/users', roleMiddleware(['admin']), authController.getUsers);

router.get('/protected/admin', authMiddleware, roleMiddleware(['admin']), (req, res) => {
    res.send('Welcome Admin');
});

router.get('/protected/coach', roleMiddleware(['coach', 'admin']), (req, res) => {
    res.send('Welcome Coach or Admin');
});

router.get('/protected/student', authMiddleware, roleMiddleware(['student']), (req, res) => {
    res.send('Welcome Student');
});

router.post('/trainer/assign-student', authMiddleware, roleMiddleware(['admin', 'coach']), coachController.assingStudent);

router.get('/trainer/:coachEmail/students', authMiddleware, roleMiddleware(['admin', 'coach']), coachController.getStudents);

router.post('/assign-user-to-student', authMiddleware, roleMiddleware(['admin']), adminController.assignStudent);

router.post('/admin/assign-coach', authMiddleware, roleMiddleware(['admin']), adminController.assignCoach);


module.exports = router;
