const authController = require('./controllers/auth')
const coachController = require('./controllers/coach');
const adminController = require('./controllers/admin');
const scheduleController = require('./controllers/schedule');
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

router.get('/users', roleMiddleware(['admin']), authController.getUsers);

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

router.post('/admin/remove-role', authMiddleware, roleMiddleware(['admin']), adminController.removeRole);

// Создание записи в расписании (только для тренеров)
router.post(
    '/schedule/create',
    authMiddleware,
    roleMiddleware(['coach']),
    scheduleController.createSchedule
  );
  
  // Получение расписания для ученика (доступно для тренеров и учеников)
  router.get(
    '/schedule/student/:studentId',
    authMiddleware,
    roleMiddleware(['coach', 'student']),
    scheduleController.getSchedule
  );
  
  // Обновление записи в расписании (только для тренеров)
  router.put(
    '/schedule/:id',
    authMiddleware,
    roleMiddleware(['coach']),
    scheduleController.updateSchedule
  );
  
  // Удаление записи в расписании (только для тренеров)
  router.delete(
    '/schedule/:id',
    authMiddleware,
    roleMiddleware(['coach']),
    scheduleController.deleteSchedule
  );
  

module.exports = router;
