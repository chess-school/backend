const authController = require('./controllers/auth');
const notificationsController = require('./controllers/notifications');
const coachController = require('./controllers/coach');
const adminController = require('./controllers/admin');
const savedGames = require('./controllers/savedGame');
const scheduleController = require('./controllers/schedule');
const gameController = require('./controllers/game');
const playerController = require('./controllers/player');
const puzzleController = require('./controllers/puzzles');
const express = require('express');
const { check } = require('express-validator');
const router = express.Router();
const authMiddleware = require('./middleware/auth');
const roleMiddleware = require('./middleware/role');
const validateRequest = require('./middleware/validateRequest');
const upload = require('./middleware/upload');
const HomeworkController  = require('./controllers/homework');
const errorHandler = require('./middleware/errorHandler');

//Auth
router.post(
    '/auth/register',
    validateRequest(['firstName', 'lastName', 'email', 'password']),
    check('password', "Password must be between 8 and 20 characters").isLength({ min: 8, max: 20 }),
    authController.registration
);

router.post(
    '/auth/login',
    validateRequest(['email', 'password']),
    authController.login
);

router.get(
    '/auth/verify-email',
    validateRequest(['token']),
    authController.verifyEmail
);

router.post(
    '/auth/resend-verification',
    validateRequest(['token']),
    authController.resendVerificationEmail
);

router.post(
    '/auth/check-verification',
    validateRequest(['token']),
    authController.checkVerificationStatus
);

router.get(
    '/users',
    authMiddleware,
    roleMiddleware(['admin']),
    authController.getUsers
);

router.get(
    '/auth/avatar/:id',
    authController.getAvatar
  );  

router.get(
    '/auth/profile',
    authMiddleware,
    authController.getProfile
);

router.put(
    '/auth/profile',
    authMiddleware,
    upload.single('avatar'),
    authController.updateProfile
  );  

// Тренеры
router.post(
    '/trainer/assign-student',
    authMiddleware,
    roleMiddleware(['admin', 'coach']),
    validateRequest(['coachEmail', 'studentEmail']),
    coachController.assignStudent
);

router.get(
    '/trainer/students',
    authMiddleware,
    roleMiddleware(['coach', 'admin']),
    validateRequest(['coachEmail']),
    coachController.getStudents
);

router.get('/coaches', coachController.getCoaches);

router.put(
    '/coach/profile', 
    authMiddleware,
    roleMiddleware(['coach', 'admin']), 
    coachController.updateCoachProfile
);

router.post('/auth/coaches-by-email', coachController.getCoachesByEmail);

router.get('/coach/:id', validateRequest(['id']), coachController.getCoachById);

router.delete(
    '/trainer/remove-student',
    authMiddleware,
    roleMiddleware(['coach', 'admin']),
    validateRequest(['coachEmail', 'studentId']),
    coachController.removeStudent
);

router.get(
    '/trainer/student',
    authMiddleware,
    roleMiddleware(['coach', 'admin']),
    validateRequest(['coachEmail', 'studentId']),
    coachController.getStudentById
);

router.get(
    '/trainer/requests',
    authMiddleware,
    roleMiddleware(['coach', 'admin']),
    coachController.getRequests
);

router.post(
    '/trainer/request', 
    authMiddleware, 
    validateRequest(['coachId', 'experience', 'goals']), 
    coachController.createRequest
);

router.patch(
    '/trainer/request',
    authMiddleware,
    roleMiddleware(['coach', 'admin']),
    validateRequest(['request_id', 'status']),
    coachController.handleRequest
);

//Notifications
router.post('/notifications', 
    authMiddleware, 
    validateRequest(['recipient', 'type', 'content']), 
    notificationsController.createNotification
);

router.get('/notifications', 
    authMiddleware, 
    notificationsController.getNotifications
);

router.patch('/notifications', 
    authMiddleware, 
    validateRequest(['notification_id']), 
    notificationsController.markAsRead
);

router.delete('/notifications', 
    authMiddleware, 
    validateRequest(['notification_id']), 
    notificationsController.deleteNotification
);

//Admin
router.put('/admin/update-role', 
    authMiddleware, 
    roleMiddleware(['admin']), 
    validateRequest(['userEmail', 'role', 'action']), 
    adminController.updateUserRole
);

router.get('/admin/user', 
    authMiddleware, 
    roleMiddleware(['admin']), 
    validateRequest(['userId']), 
    adminController.getUserDetails
);

router.get('/admins',
    adminController.getAdmins
);

router.post('/save-game', 
    authMiddleware, 
    // roleMiddleware(['coach', 'admin']),
    // validateRequest(['studentId', 'pgn']), 
    savedGames.saveGameForStudent
);


router.get('/my-games', 
    authMiddleware, 
    savedGames.getMySavedGames
);

// Расписания
router.post('/schedule/create', authMiddleware, roleMiddleware(['coach']), scheduleController.createSchedule);
router.get('/schedule/student/:studentId', authMiddleware, roleMiddleware(['coach', 'student']), scheduleController.getSchedule);
router.get('/schedule/coach', authMiddleware, roleMiddleware(['coach']), scheduleController.getCoachSchedule);
router.get('/schedule/date', authMiddleware, scheduleController.getScheduleByDate);
router.put('/schedule/:id', authMiddleware, roleMiddleware(['coach']), scheduleController.updateSchedule);
router.patch('/schedule/:id/complete', authMiddleware, roleMiddleware(['coach']), scheduleController.markComplete);
router.delete('/schedule/:id', authMiddleware, roleMiddleware(['coach']), scheduleController.deleteSchedule);
router.delete('/schedule/student/:studentId', authMiddleware, roleMiddleware(['coach']), scheduleController.deleteStudentSchedule);

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


// Пазлы и подборки
router.post('/puzzles', authMiddleware, roleMiddleware(['coach', 'admin']), puzzleController.createPuzzle); // Создать пазл

router.delete('/puzzles/:puzzleId', authMiddleware, roleMiddleware(['coach', 'admin']), puzzleController.deletePuzzle); // Удалить пазл

router.put('/puzzles/:puzzleId', authMiddleware, roleMiddleware(['coach', 'admin']), puzzleController.updatePuzzle); // Обновить пазл

router.post('/collections', authMiddleware, roleMiddleware(['coach', 'admin']), puzzleController.createCollection); // Создать подборку

router.delete('/collections/:collectionId', authMiddleware, roleMiddleware(['coach', 'admin']), puzzleController.deleteCollection); // Удалить подборку

router.put('/collections/:collectionId', authMiddleware, roleMiddleware(['coach', 'admin']), puzzleController.updateCollection); // Обновить подборку

router.get('/collections/:collectionId/puzzles', authMiddleware, roleMiddleware(['coach', 'admin']), puzzleController.getCollectionPuzzles); // Получить пазлы из подборки

router.post(
  '/homework/send', 
  authMiddleware,
  upload.single('screenshot'),
  HomeworkController.sendHomework
);

router.get('/homework/coach', authMiddleware, HomeworkController.getHomeworkForReview);

router.put('/homework/:homeworkId/review', authMiddleware, HomeworkController.reviewHomework);

router.get('/homework/:id/screenshot', authMiddleware, HomeworkController.getHomeworkScreenshot);

const MIDDLEWARE_NAMES_TO_SKIP = [
  'authMiddleware',
  'roleMiddleware',
  'validateRequest',
  'upload',
  'check' 
];

router.stack.forEach(layer => {
  if (layer.route) {
    layer.route.stack.forEach(handlerLayer => {
      const handlerName = handlerLayer.handle.name;

      if (!handlerName || !MIDDLEWARE_NAMES_TO_SKIP.includes(handlerName)) {
        handlerLayer.handle = errorHandler(handlerLayer.handle);
      }
    });
  }
});

module.exports = router;