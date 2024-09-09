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
        student.trainerEmail = coach.email;  
        await student.save();

        const studentExists = coach.students.find(s => s.email === student.email);
        if (!studentExists) {
            coach.students.push({
                _id: student._id,
                firstName: student.firstName,
                lastName: student.lastName,
                email: student.email
            });
            await coach.save();
        }

        res.json({ msg: 'Student assigned to coach successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

router.get('/:coachEmail/students', authMiddleware, roleMiddleware(['admin', 'coach']), async (req, res) => {
    try {
        const coach = await User.findOne({ email: req.params.coachEmail });
        if (!coach || !coach.roles.includes('coach')) {
            return res.status(400).json({ msg: 'Invalid coach' });
        }

        res.json(coach.students);  
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

module.exports = router;
