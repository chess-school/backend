const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const coachRoutes = require('./coach.routes');
const courseRoutes = require('./course.routes');
const groupRoutes = require('./group.routes');
const enrollmentRoutes = require('./enrollment.routes');
const adminRoutes = require('./admin.routes'); 
const paymentRoutes = require('./payment.routes');
const scheduleRoutes = require('./schedule.routes');
const notificationRoutes = require('./notification.routes');
const chatRoutes = require('./chat.routes');
const chatRoomRoutes = require('./chatRoom.routes');
const puzzleRoutes = require('./puzzle.routes');
const chessDB = require('./chessDB.routes');
const digitizerRoutes = require('./digitizer.routes');
const puzzleBookRoutes = require('./puzzleBook.routes');
const studentRoutes = require('./student.routes');
const homeworkRoutes = require('./homework.routes');

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/coaches', coachRoutes);
router.use('/courses', courseRoutes);
router.use('/groups', groupRoutes);
router.use('/payments', paymentRoutes);
router.use('/', enrollmentRoutes); 
router.use('/schedule', scheduleRoutes);
router.use('/notifications', notificationRoutes);
router.use('/conversations', chatRoutes); 
router.use('/chat', chatRoomRoutes);
router.use('/admin', adminRoutes);
router.use('/puzzles', puzzleRoutes);
router.use('/chessdb', chessDB);
router.use('/digitizer', digitizerRoutes);
router.use('/puzzle-books', puzzleBookRoutes);
router.use('/students', studentRoutes);
// Онлайн-партии (лобби, вызовы); ходы и часы — socket.io namespace /play
router.use('/play', require('./play.routes'));
router.use('/assignments', homeworkRoutes.assignments);
router.use('/submissions', homeworkRoutes.submissions);

module.exports = router;