const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();

router.post('/assign-student', auth(['admin', 'trainer']), async (req, res) => {
    const { trainerId, studentId } = req.body;

    try {
        const trainer = await User.findById(trainerId);
        if (!trainer || trainer.role !== 'trainer') {
            return res.status(400).json({ msg: 'Invalid trainer' });
        }

        // Проверяем, что ученик существует
        const student = await User.findById(studentId);
        if (!student || student.role !== 'student') {
            return res.status(400).json({ msg: 'Invalid student' });
        }

        // Назначаем ученика тренеру
        student.trainer = trainerId;
        await student.save();

        // Добавляем ученика в список учеников тренера
        trainer.students.push(studentId);
        await trainer.save();

        res.json({ msg: 'Student assigned to trainer successfully' });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

router.get('/:trainerId/students', auth(['admin', 'trainer']), async (req, res) => {
    try {
        const trainer = await User.findById(req.params.trainerId).populate('students');
        if (!trainer || trainer.role !== 'trainer') {
            return res.status(400).json({ msg: 'Invalid trainer' });
        }

        res.json(trainer.students);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

module.exports = router;
