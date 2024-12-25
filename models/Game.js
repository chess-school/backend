const mongoose = require('mongoose');

const MoveSchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  move: { type: String, required: true }, // Например, e4, Nf3
  fen: { type: String }, // FEN позиция после хода
  timestamp: { type: Date, default: Date.now },
});

const GameSchema = new mongoose.Schema({
  players: [
    {
      player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
      color: { type: String, enum: ['white', 'black'], required: true }, // Цвет фигуры
    },
  ],
  moves: [MoveSchema], // История ходов
  status: {
    type: String,
    enum: ['waiting', 'in_progress', 'finished', 'draw', 'abandoned'],
    default: 'waiting',
  },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null }, // Победитель
  currentTurn: { type: String, enum: ['white', 'black'], default: 'white' },
  time: {
    white: { type: Number, default: 300 }, // Время в секундах
    black: { type: Number, default: 300 },
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Game', GameSchema);
