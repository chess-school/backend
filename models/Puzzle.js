const mongoose = require('mongoose');

const PuzzleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  pgn: {
    type: String,
    required: true,
  },
  solution: {
    type: String,
    required: true,
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, { timestamps: true });

const CollectionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  puzzles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Puzzle',
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, { timestamps: true });

module.exports = {
  Puzzle: mongoose.model('Puzzle', PuzzleSchema),
  Collection: mongoose.model('Collection', CollectionSchema),
};
