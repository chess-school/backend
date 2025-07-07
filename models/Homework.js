const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const HomeworkSchema = new Schema({
  student: {
    type: Schema.Types.ObjectId,
    ref: 'User', 
    required: true,
  },
  coach: {
    type: Schema.Types.ObjectId,
    ref: 'User', 
    required: true,
  },
  schedule: {
    type: Schema.Types.ObjectId,
    ref: 'Schedule', 
    required: true,
  },
  text: {
    type: String,
    trim: true,
  },
  screenshot: {
    data: Buffer, 
    contentType: String
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending',
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  review: {
    comment: {
      type: String, 
      trim: true,
    },
    reviewedAt: {
      type: Date, 
    },
  },
});

module.exports = mongoose.model('Homework', HomeworkSchema);