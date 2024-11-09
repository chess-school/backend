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
  notes: {
    type: String
  },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'missed'],
    default: 'scheduled'
  }
}, { timestamps: true });

module.exports = mongoose.model('Schedule', ScheduleSchema);
