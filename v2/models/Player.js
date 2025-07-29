// models/Player.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Вспомогательная схема для рейтингов. Она у вас уже есть, и она хороша.
const RatingSchema = new Schema({
    rating: { type: Number, default: 1200 },
    gamesPlayed: { type: Number, default: 0 },
    //... gamesWon, gamesDrawn, gamesLost
}, { _id: false }); // _id: false, так как это вложенный документ, ему не нужен свой ID.

const PlayerSchema = new Schema({
    // --- КЛЮЧЕВАЯ СВЯЗЬ 1-к-1 ---
    user: {
        type: Schema.Types.ObjectId,
        ref: 'TestUser',
        required: true,
        unique: true,
    },
    
    // --- ИГРОВЫЕ РЕЙТИНГИ ---
    // Ваша структура с bullet, blitz, rapid, classic - идеальна.
    ratings: {
        bullet: { type: RatingSchema, default: () => ({}) },
        blitz: { type: RatingSchema, default: () => ({}) },
        rapid: { type: RatingSchema, default: () => ({}) },
        classic: { type: RatingSchema, default: () => ({}) },
    },
    
    // --- ССЫЛКИ НА ИГРЫ ---
    // Убираем поле games: [], так как хранить все ID игр в профиле игрока 
    // неэффективно при большом количестве партий. Историю игр лучше
    // получать отдельным запросом к коллекции Games.
    
    // `activeGame` - поле хорошее, но им можно управлять на уровне кэша (Redis), 
    // а не в БД. Уберем для упрощения.
    
    // Можно добавить общую игровую статистику, если нужно
    stats: {
        totalWins: { type: Number, default: 0 },
        // и т.д.
    }

}, { timestamps: true });

// Индекс для быстрого поиска игрока по ID пользователя
PlayerSchema.index({ user: 1 });

module.exports = mongoose.model('PlayerV2', PlayerSchema);