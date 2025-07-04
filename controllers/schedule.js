const Schedule = require('../models/Schedule');
const User = require('../models/User');
const Joi = require('joi');

class ScheduleController {
  async createSchedule(req, res) {
    const schema = Joi.object({
      studentId: Joi.string().required(),
      date: Joi.date().iso().required(),
      title: Joi.string().min(3).max(100).required(),
      description: Joi.string().allow('').optional(),
      link: Joi.string().uri().allow('').optional(),
      type: Joi.string().valid('individual_lesson', 'group_lesson', 'homework', 'opening_study', 'tournament_participation').required(),
      status: Joi.string().valid('scheduled', 'completed', 'missed').default('scheduled')
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ msg: error.details[0].message });

    const { studentId, date, title, description, link, type, status } = req.body;
    const coachId = req.user.id;

    try {
      const student = await User.findById(studentId);
      if (!student) return res.status(400).json({ msg: 'Invalid student' });

      const schedule = new Schedule({ 
        student: studentId, 
        coach: coachId, 
        date, 
        title, 
        description, 
        link, 
        type, 
        status 
      });

      await schedule.save();
      return res.status(201).json(schedule);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to create schedule' });
    }
  }

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
  
  async getCoachSchedule(req, res) {
    try {
      const schedule = await Schedule.find({ coach: req.user.id })
        .populate('student', 'firstName lastName email')
        .sort('date');
      return res.json(schedule);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to get coach schedule' });
    }
  }

  async getScheduleByDate(req, res) {
    const { date, type } = req.query;
    if (!date) return res.status(400).json({ msg: 'Date is required' });

    try {
      let query = { 
        date: { 
          $gte: new Date(date + 'T00:00:00.000Z'), 
          $lt: new Date(date + 'T23:59:59.999Z') 
        }
      };
      if (type) query.type = type;

      const schedule = await Schedule.find(query)
        .populate('student', 'firstName lastName email')
        .populate('coach', 'firstName lastName email')
        .sort('date');

      return res.json(schedule);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to get schedule for date' });
    }
  }

  async updateSchedule(req, res) {
    const { id } = req.params;
    const { date, title, description, link, type, status } = req.body;

    try {
      const schedule = await Schedule.findById(id);
      if (!schedule) return res.status(404).json({ msg: 'Schedule not found' });
      if (schedule.coach.toString() !== req.user.id) {
        return res.status(403).json({ msg: 'Unauthorized' });
      }

      schedule.date = date;
      schedule.title = title;
      schedule.description = description;
      schedule.link = link;
      schedule.type = type;
      schedule.status = status;

      await schedule.save();
      return res.json(schedule);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to update schedule' });
    }
  }

  async markComplete(req, res) {
    const { id } = req.params;
    try {
      const schedule = await Schedule.findById(id);
      if (!schedule) return res.status(404).json({ msg: 'Schedule not found' });
      if (schedule.coach.toString() !== req.user.id) {
        return res.status(403).json({ msg: 'Unauthorized' });
      }
      schedule.status = 'completed';
      await schedule.save();
      return res.json({ msg: 'Schedule marked as completed' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to update status' });
    }
  }

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

  async deleteStudentSchedule(req, res) {
    const { studentId } = req.params;
    try {
      await Schedule.deleteMany({ student: studentId });
      return res.json({ msg: 'All schedule entries deleted for this student' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to delete student schedule' });
    }
  }
}

module.exports = new ScheduleController();
