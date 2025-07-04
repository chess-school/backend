const mongoose = require('mongoose');

const RatingSchema = new mongoose.Schema({
    rating: {
        type: Number,
        default: 1200
    },
    gamesPlayed: {
        type: Number,
        default: 0
    },
    gamesWon: {
        type: Number,
        default: 0
    },
    gamesDrawn: {
        type: Number,
        default: 0
    },
    gamesLost: {
        type: Number,
        default: 0
    }
});

const PlayerSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    bullet: {
        type: RatingSchema,
        default: () => ({})
    },
    blitz: {
        type: RatingSchema,
        default: () => ({})
    },
    rapid: {
        type: RatingSchema,
        default: () => ({})
    },
    classic: {
        type: RatingSchema,
        default: () => ({})
    },
    activeGame: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Game',
        default: null
    },
    games: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Game',
        },
      ],
}, { timestamps: true });

module.exports = mongoose.model('Player', PlayerSchema);
