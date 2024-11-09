const User = require('../models/User');

class CoachController {
    // Назначение ученика тренеру
    async assignStudent(req, res) {
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

            // Назначаем тренера ученику
            student.trainer = coach._id;
            student.trainerEmail = coach.email;
            await student.save();

            // Проверяем, если ученик уже добавлен к тренеру
            const studentExists = coach.students.find(s => s.toString() === student._id.toString());
            if (!studentExists) {
                coach.students.push(student._id);
                await coach.save();
            }

            res.json({ msg: 'Student assigned to coach successfully' });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }

    // Получение списка учеников тренера по email
    async getStudents(req, res) {
        const { coachEmail } = req.query;

        if (!coachEmail) {
            return res.status(400).json({ msg: 'Coach email is required' });
        }

        try {
            const coach = await User.findOne({ email: coachEmail }).populate('students');
            if (!coach || !coach.roles.includes('coach')) {
                return res.status(404).json({ msg: 'Coach not found' });
            }

            res.json(coach.students);
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }

    // Удаление ученика у тренера
    async removeStudent(req, res) {
        const { coachEmail, studentId } = req.query;
    
        if (!coachEmail || !studentId) {
            return res.status(400).json({ msg: 'Coach email and student ID are required' });
        }
    
        try {
            // Находим тренера по email
            const coach = await User.findOne({ email: coachEmail }).populate('students');
            if (!coach || !coach.roles.includes('coach')) {
                return res.status(404).json({ msg: 'Coach not found' });
            }
    
            // Находим ученика по его ID
            const student = await User.findById(studentId);
            if (!student) {
                return res.status(404).json({ msg: 'Student not found' });
            }
    
            // Проверяем, привязан ли ученик к этому тренеру
            if (student.trainer?.toString() !== coach._id.toString()) {
                return res.status(400).json({ msg: 'Student not assigned to this coach' });
            }
    
            // Убираем тренера у ученика
            student.trainer = null;
            student.trainerEmail = null;
            await student.save();
    
            // Удаляем ученика из списка тренера
            coach.students = coach.students.filter(s => s._id.toString() !== studentId);
            await coach.save();
    
            return res.json({ msg: 'Student removed successfully' });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ msg: 'Server error' });
        }
    }
    

    // Получение информации об ученике по ID
    async getStudentById(req, res) {
        const { coachEmail, studentId } = req.query;

        if (!coachEmail || !studentId) {
            return res.status(400).json({ msg: 'Coach email and student ID are required' });
        }

        try {
            const coach = await User.findOne({ email: coachEmail });
            if (!coach || !coach.roles.includes('coach')) {
                return res.status(404).json({ msg: 'Coach not found' });
            }

            const student = await User.findById(studentId);
            if (!student || student.trainer.toString() !== coach._id.toString()) {
                return res.status(404).json({ msg: 'Student not assigned to this coach' });
            }

            res.json(student);
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }
}

module.exports = new CoachController();
