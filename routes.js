const authController = require('./controllers/auth');
const coachController = require('./controllers/coach');
const adminController = require('./controllers/admin');
const scheduleController = require('./controllers/schedule');
const gameController = require('./controllers/game');
const playerController = require('./controllers/player');
const express = require('express');
const { check } = require('express-validator');
const passport = require('passport');
const router = express.Router();
const authMiddleware = require('./middleware/auth');
const roleMiddleware = require('./middleware/role');

// Аутентификация
router.post('/auth/register', [
    check('firstName', "Firstname cannot be empty").notEmpty(),
    check('lastName', "Lastname cannot be empty").notEmpty(),
    check('email', "Email cannot be empty").notEmpty(),
    check('password', "Password name cannot be empty").isLength({ min: 8, max: 20 }),
], authController.registration);

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/login' }),
    (req, res) => {
        res.redirect('/auth/profile');
    }
);

router.post('/auth/login', authController.login);
router.get('/auth/verify-email', authController.verifyEmail);
router.post('/auth/firebase-login', authController.firebaseLogin);

router.get('/users', roleMiddleware(['admin']), authController.getUsers);

router.get('/auth/profile', authMiddleware, authController.getProfile);
router.put('/auth/profile', authMiddleware, authController.updateProfile);

// Тренеры
router.post('/trainer/assign-student', authMiddleware, roleMiddleware(['admin', 'coach']), coachController.assignStudent);
router.get('/trainer/students', authMiddleware, roleMiddleware(['coach', 'admin']), coachController.getStudents);
router.delete('/trainer/remove-student', authMiddleware, roleMiddleware(['coach', 'admin']), coachController.removeStudent);
router.get('/trainer/student', authMiddleware, roleMiddleware(['coach', 'admin']), coachController.getStudentById);

// Администратор
router.post('/assign-user-to-student', authMiddleware, roleMiddleware(['admin']), adminController.assignStudent);
router.post('/admin/assign-coach', authMiddleware, roleMiddleware(['admin']), adminController.assignCoach);
router.post('/admin/remove-role', authMiddleware, roleMiddleware(['admin']), adminController.removeRole);
router.get('/admin/user', authMiddleware, roleMiddleware(['admin']), adminController.getUserDetails);

// Расписания
router.post('/schedule/create', authMiddleware, roleMiddleware(['coach']), scheduleController.createSchedule);
router.get('/schedule/student/:studentId', authMiddleware, roleMiddleware(['coach', 'student']), scheduleController.getSchedule);
router.put('/schedule/:id', authMiddleware, roleMiddleware(['coach']), scheduleController.updateSchedule);
router.delete('/schedule/:id', authMiddleware, roleMiddleware(['coach']), scheduleController.deleteSchedule);

// Игроки
router.get('/player/:playerId', authMiddleware, playerController.getPlayer);
router.get('/player/:playerId/rating/:format', authMiddleware, playerController.getRating); 
router.post('/player/:playerId/rating/:format', authMiddleware, playerController.updateRating); 
router.get('/player/:playerId/games', authMiddleware, playerController.getGames); 
router.post('/player/:playerId/active-game/:gameId', authMiddleware, playerController.setActiveGame); 
router.post('/player/:playerId/complete-active-game', authMiddleware, playerController.completeActiveGame); 

// Вызовы
router.get('/games', authMiddleware, gameController.getChallenges); // Получить список вызовов
router.post('/games', authMiddleware, gameController.createChallenge); // Создать вызов
router.post('/games/:gameId/accept', authMiddleware, gameController.acceptChallenge); // Принять вызов

// Игры
router.get('/games/:gameId', authMiddleware, gameController.getGame); // Получить данные об игре
// router.post('/games/:gameId/move', authMiddleware, gameController.makeMove); // Сделать ход
router.post('/games/:gameId/finish', authMiddleware, gameController.finishGame); // Завершить игру

module.exports = router;