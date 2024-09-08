const express = require('express');
const auth = require('../middleware/auth');
const router = express.Router();

// Роут доступен только для админа
router.get('/admin', auth('admin'), (req, res) => {
    res.send('Welcome Admin');
});

// Роут доступен для тренера и админа
router.get('/trainer', auth(['trainer', 'admin']), (req, res) => {
    res.send('Welcome Trainer');
});

// Роут доступен для ученика
router.get('/student', auth('student'), (req, res) => {
    res.send('Welcome Student');
});

module.exports = router;
