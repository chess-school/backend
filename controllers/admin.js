const User = require('../models/User');

class AdminController {
    async assignStudent(req, res) {
        const { userEmail } = req.body;

        try {
            const user = await User.findOne({ email: userEmail });
            if (!user) {
                return res.status(400).json({ msg: 'User not found' });
            }

            if (user.roles.includes('student')) {
                return res.status(400).json({ msg: 'User is already a student' });
            }

            user.roles.push('student');
            await user.save();

            res.json({ msg: 'User assigned as student successfully' });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }

    async assignCoach(req, res) {
        const { userEmail } = req.body;

        try {
            const user = await User.findOne({ email: userEmail });
            if (!user) {
                return res.status(400).json({ msg: 'User not found' });
            }

            if (user.roles.includes('coach')) {
                return res.status(400).json({ msg: 'User is already a coach' });
            }

            user.roles.push('coach');
            await user.save();

            res.json({ msg: 'User assigned as coach successfully' });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }

    async removeRole(req, res) {
        const { userEmail, role } = req.body; 

        try {
            const user = await User.findOne({ email: userEmail });
            if (!user) {
                return res.status(400).json({ msg: 'User not found' });
            }

            if (!user.roles.includes(role)) {
                return res.status(400).json({ msg: `User does not have the role: ${role}` });
            }

            user.roles = user.roles.filter(userRole => userRole !== role);
            await user.save();

            res.json({ msg: `Role ${role} removed successfully from user` });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }

    async getUserDetails(req, res) {
        const { userId } = req.query; 

        if (!userId) {
            return res.status(400).json({ message: 'User ID is required' });
        }

        try {
            if (!req.user || !req.user.roles.includes('admin')) {
                return res.status(403).json({ message: 'Доступ запрещен' });
            }

            const user = await User.findById(userId).select('+password');
            if (!user) {
                return res.status(404).json({ message: 'Пользователь не найден' });
            }

            res.json({
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                password: user.password,
                roles: user.roles,
                students: user.students,
                trainer: user.trainer,
                trainerEmail: user.trainerEmail,
                createdAt: user.createdAt
            });
        } catch (error) {
            console.error('Ошибка при получении данных пользователя:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
}

module.exports = new AdminController();
