// v2/models/PuzzleAttempt.js
//
// Одна зафиксированная попытка решения упражнения учеником — сырьё для статистики прогресса.
// Пишется с фронта при успешном решении или при сдаче (если тренер разрешил показ решения).

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PuzzleAttemptSchema = new Schema({
    student: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true, index: true },
    puzzleBook: { type: Schema.Types.ObjectId, ref: 'PuzzleBook', required: true },
    exerciseId: { type: String, required: true },      // _id упражнения внутри книги
    solved: { type: Boolean, default: true },          // true — решено самостоятельно, false — «сдался»
    timeTakenSeconds: { type: Number, default: 0, min: 0 },
    attemptsCount: { type: Number, default: 0, min: 0 }, // число ошибочных ходов
    usedHint: { type: Boolean, default: false },
}, { timestamps: true });

PuzzleAttemptSchema.index({ puzzleBook: 1, student: 1 });

module.exports = mongoose.model('PuzzleAttempt', PuzzleAttemptSchema);
