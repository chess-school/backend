const Schedule = require('../models/Schedule');
const User = require('../models/User');
const Joi = require('joi');

const createSchedule = async (req, res) => {
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
  if (error) {
    return res.status(400).json({ msg: error.details[0].message });
  }

  const { studentId, date, title, description, link, type, status } = req.body;
  const coachId = req.user.id;

  const student = await User.findById(studentId);
  if (!student) {
    return res.status(400).json({ msg: 'Invalid student' });
  }

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
  res.status(201).json(schedule);
};

const getSchedule = async (req, res) => {
  const { studentId } = req.params;
  const schedule = await Schedule.find({ student: studentId }).sort('date');
  res.json(schedule);
};

const getCoachSchedule = async (req, res) => {
  const schedule = await Schedule.find({ coach: req.user.id })
    .populate('student', 'firstName lastName email')
    .sort('date');
  res.json(schedule);
};

const getScheduleByDate = async (req, res) => {
  const { date, type } = req.query;
  if (!date) {
    return res.status(400).json({ msg: 'Date is required' });
  }

  let query = {
    date: {
      $gte: new Date(date + 'T00:00:00.000Z'),
      $lt: new Date(date + 'T23:59:59.999Z')
    }
  };
  if (type) {
    query.type = type;
  }

  const schedule = await Schedule.find(query)
    .populate('student', 'firstName lastName email')
    .populate('coach', 'firstName lastName email')
    .sort('date');

  res.json(schedule);
};

const updateSchedule = async (req, res) => {
  const { id } = req.params;
  const { date, title, description, link, type, status } = req.body;
  
  const schedule = await Schedule.findById(id);
  if (!schedule) {
    return res.status(404).json({ msg: 'Schedule not found' });
  }
  if (schedule.coach.toString() !== req.user.id) {
    return res.status(403).json({ msg: 'Unauthorized' });
  }

  const updateData = { date, title, description, link, type, status };
  Object.keys(updateData).forEach(key => {
    if (updateData[key] !== undefined) {
      schedule[key] = updateData[key];
    }
  });

  await schedule.save();
  res.json(schedule);
};

const markComplete = async (req, res) => {
  const { id } = req.params;
  
  const schedule = await Schedule.findById(id);
  if (!schedule) {
    return res.status(404).json({ msg: 'Schedule not found' });
  }
  if (schedule.coach.toString() !== req.user.id) {
    return res.status(403).json({ msg: 'Unauthorized' });
  }
  
  schedule.status = 'completed';
  await schedule.save();
  res.json({ msg: 'Schedule marked as completed' });
};

const deleteSchedule = async (req, res) => {
  const { id } = req.params;
  
  const result = await Schedule.findByIdAndDelete(id);
  if (!result) {
      return res.status(404).json({ msg: 'Schedule not found' });
  }

  res.json({ message: 'Schedule deleted successfully' });
};

const deleteStudentSchedule = async (req, res) => {
  const { studentId } = req.params;
  
  await Schedule.deleteMany({ student: studentId });
  res.json({ msg: 'All schedule entries deleted for this student' });
};

module.exports = {
  createSchedule,
  getSchedule,
  getCoachSchedule,
  getScheduleByDate,
  updateSchedule,
  markComplete,
  deleteSchedule,
  deleteStudentSchedule
};