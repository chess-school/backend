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
router.use('/admin', adminRoutes);

module.exports = router;