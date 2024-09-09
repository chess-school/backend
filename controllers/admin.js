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
}

module.exports = new AdminController();
