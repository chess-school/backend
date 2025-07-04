const mongoose = require('mongoose');
const { Schema } = mongoose;

const SavedGameSchema = new Schema({
  pgn: {
    type: String,
    // required: [true, 'PGN is required'],
  },
  title: {
    type: String,
    trim: true,
    default: 'Saved Game'
  },
  description: {
    type: String,
    // trim: true,
  },
  coach: {
    type: Schema.Types.ObjectId,
    ref: 'User', 
    required: true,
  },
  student: {
    type: Schema.Types.ObjectId,
    ref: 'User', 
    required: true,
  },
  dateSaved: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('SavedGame', SavedGameSchema);