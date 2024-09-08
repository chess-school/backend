const express = require('express');
const router = express.Router();

// Простой тестовый маршрут
router.get('/ping', (req, res) => {
    res.json({ msg: 'Server is running' });
});

module.exports = router;