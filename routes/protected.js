const express = require('express');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const router = express.Router();

router.get('/admin', authMiddleware, roleMiddleware(['admin']), (req, res) => {
    res.send('Welcome Admin');
});

router.get('/coach', roleMiddleware(['coach', 'admin']), (req, res) => {
    res.send('Welcome Coach or Admin');
});

router.get('/student', authMiddleware, roleMiddleware(['student']), (req, res) => {
    res.send('Welcome Student');
});

module.exports = router;
