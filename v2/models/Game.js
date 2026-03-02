const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    white: { type: String, index: true },
    black: { type: String, index: true },
    result: String,
    eco: String,
    an: String,
}, { versionKey: false });

module.exports = mongoose.models.Game || mongoose.model('Game', gameSchema);