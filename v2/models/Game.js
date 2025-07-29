// models/Game.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Схема для хода, ваша текущая очень хороша.
const MoveSchema = new Schema({
    // Мы можем убрать player, т.к. ход делается по очереди, его автор ясен из индекса.
    // Но если у вас система позволяет "предлагать" ход, то оставить стоит. Давайте оставим для гибкости.
    player: { type: Schema.Types.ObjectId, ref: 'Player' }, 
    move: { type: String, required: true }, // в SAN (Standard Algebraic Notation)
    fen: { type: String, required: true }, // FEN после хода - обязательно для восстановления позиции.
    clock: { type: Number }, // Время на часах игрока после хода
}, { _id: false, timestamps: true }); // Добавим timestamps к ходам

const GameSchema = new Schema({
    // --- УЧАСТНИКИ ---
    players: [new Schema({
        // Ссылаемся на 'Player', а не на 'User'. Это правильно!
        player: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
        color: { type: String, enum: ['white', 'black'], required: true },
        // Можно сохранить начальный рейтинг для расчета изменений
        rating: { type: Number },
    }, { _id: false })],
    
    // --- ПРАВИЛА ИГРЫ ---
    timeControl: {
        initial: { type: Number }, // в секундах
        increment: { type: Number }
    },
    
    // --- ХОД ИГРЫ ---
    moves: [MoveSchema],
    
    // --- РЕЗУЛЬТАТ ---
    status: {
        type: String,
        enum: ['waiting_for_players', 'in_progress', 'completed', 'aborted'],
        default: 'waiting_for_players',
    },
    result: {
        winnerColor: { type: String, enum: ['white', 'black', 'none'] },
        reason: { // Причина завершения
            type: String, 
            enum: ['checkmate', 'resignation', 'timeout', 'agreement', 'stalemate', 'abandonment'],
        }
    },

    // --- ИСТОРИЧЕСКИЕ ДАННЫЕ И МЕТАДАННЫЕ ---
    pgn: { type: String }, // Полный PGN партии, генерируется после окончания.
    
    // Опциональная связь с учебным процессом
    context: {
        type: { type: String, enum: ['training', 'tournament'] },
        refId: { type: Schema.Types.ObjectId } // Ссылка на TrainingContract или Tournament
    }

}, { timestamps: true });

// Индекс для поиска игр с участием конкретного игрока
GameSchema.index({ "players.player": 1 });

module.exports = mongoose.model('Game', GameSchema);