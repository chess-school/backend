const Schedule = require('../models/Schedule');
const User = require('../models/User');

class ScheduleController {
  // Метод для создания новой записи в расписании
  async createSchedule(req, res) {
    const { studentId, date, title, notes } = req.body;
    const coachId = req.user.id;

    try {
      const student = await User.findById(studentId);
      if (!student || !student.roles.includes('student')) {
        return res.status(400).json({ msg: 'Invalid student' });
      }

      const schedule = new Schedule({
        student: studentId,
        coach: coachId,
        date,
        title,
        notes,
      });

      await schedule.save();
      return res.status(201).json(schedule);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to create schedule' });
    }
  }

  // Метод для получения расписания ученика
  async getSchedule(req, res) {
    const { studentId } = req.params;

    try {
      const schedule = await Schedule.find({ student: studentId }).sort('date');
      return res.json(schedule);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to get schedule' });
    }
  }

  // Метод для обновления записи в расписании
  async updateSchedule(req, res) {
    const { id } = req.params;
    const { date, title, notes, status } = req.body;

    try {
      const updatedSchedule = await Schedule.findByIdAndUpdate(
        id,
        { date, title, notes, status },
        { new: true }
      );
      return res.json(updatedSchedule);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to update schedule' });
    }
  }

  // Метод для удаления записи в расписании
  async deleteSchedule(req, res) {
    const { id } = req.params;

    try {
      await Schedule.findByIdAndDelete(id);
      return res.json({ message: 'Schedule deleted successfully' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to delete schedule' });
    }
  }
}

module.exports = new ScheduleController();
