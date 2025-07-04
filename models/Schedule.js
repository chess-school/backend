const mongoose = require('mongoose');

const ScheduleSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  coach: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  link: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'missed'],
    default: 'scheduled'
  },
  type: {
    type: String,
    enum: ['individual_lesson', 'group_lesson', 'homework', 'opening_study', 'tournament_participation'],
    default: 'individual_lesson'
  }
}, { timestamps: true });

module.exports = mongoose.model('Schedule', ScheduleSchema);
