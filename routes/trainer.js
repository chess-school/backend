const express = require('express');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const User = require('../models/User');
const router = express.Router();

router.post('/assign-student', authMiddleware, roleMiddleware(['admin', 'coach']), async (req, res) => {
    const { coachEmail, studentEmail } = req.body;

    try {
        const coach = await User.findOne({ email: coachEmail });
        if (!coach || !coach.roles.includes('coach')) {
            return res.status(400).json({ msg: 'Invalid coach' });
        }

        const student = await User.findOne({ email: studentEmail });
        if (!student || !student.roles.includes('student')) {
            return res.status(400).json({ msg: 'Invalid student' });
        }

        student.trainer = coach._id;
        await student.save();

        coach.students.push(student._id);
        await coach.save();

        res.json({ msg: 'Student assigned to coach successfully' });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

router.get('/:coachEmail/students', authMiddleware, roleMiddleware(['admin', 'coach']), async (req, res) => {
    try {
        const coach = await User.findOne({ email: req.params.coachEmail }).populate('students');
        if (!coach || !coach.roles.includes('coach')) {
            return res.status(400).json({ msg: 'Invalid coach' });
        }

        res.json(coach.students);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

module.exports = router;
