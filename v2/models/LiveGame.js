// v2/models/LiveGame.js
//
// Онлайн-партия человек против человека (/play). Модель называется LiveGame: имя Game уже занято
// базой партий мастеров (v2/models/Game.js, /book).
//
// Жизненный цикл: created (вызов ждёт соперника; открытый или по ссылке) -> active (идёт игра)
//   -> finished (есть результат) | aborted (отменена до первых ходов обоих / вызов отозван).
// Часы ведёт сервер (v2/services/play/clock.js): здесь хранится остаток на момент последнего хода
// и время начала хода — по ним партия восстанавливается после перезапуска сервера.

const mongoose = require('mongoose');
const { Schema } = mongoose;

const STATUSES = ['created', 'active', 'finished', 'aborted'];
const END_REASONS = ['checkmate', 'timeout', 'resignation', 'draw_agreement', 'stalemate', 'insufficient_material', 'threefold_repetition', 'fifty_moves', 'aborted'];
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const RatingSnapshotSchema = new Schema({
    before: Number,
    after: Number,
    diff: Number,
    provisional: Boolean,
}, { _id: false });

const LiveGameSchema = new Schema({
    whitePlayer: { type: Schema.Types.ObjectId, ref: 'TestUser', default: null },
    blackPlayer: { type: Schema.Types.ObjectId, ref: 'TestUser', default: null },
    /** Кто создал вызов; цвет создателя: white | black | random (разрешается при старте) */
    createdBy: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },
    creatorColor: { type: String, enum: ['white', 'black', 'random'], default: 'random' },
    /** Вызов по ссылке (не виден в открытом лобби) или из очереди автоподбора */
    source: { type: String, enum: ['challenge', 'lobby', 'pairing', 'rematch'], default: 'challenge' },
    isPrivate: { type: Boolean, default: true },
    isRated: { type: Boolean, default: true },
    timeControl: {
        // Категория рейтинга по ожидаемой длительности (v2/utils/timeControl.js)
        type: { type: String, enum: ['bullet', 'blitz', 'rapid', 'classical'], required: true },
        initialSeconds: { type: Number, required: true, min: 60, max: 10800 },
        incrementSeconds: { type: Number, required: true, min: 0, max: 60 },
        /** Не из пресетов лобби */
        custom: { type: Boolean, default: false },
    },
    fen: { type: String, default: START_FEN },
    /** Ходы в UCI и SAN; pgn — для экспорта/анализа */
    moves: [{ type: String }],
    sanMoves: [{ type: String }],
    pgn: { type: String, default: '' },
    status: { type: String, enum: STATUSES, default: 'created', index: true },
    winner: { type: String, enum: ['white', 'black', 'draw', null], default: null },
    endReason: { type: String, enum: [...END_REASONS, null], default: null },
    clock: {
        whiteMs: Number,
        blackMs: Number,
        /** Когда начался ход стороны, чей сейчас ход (null — часы стоят: до первого хода) */
        turnStartedAt: { type: Date, default: null },
    },
    /** Кто предложил ничью (действует до следующего хода предложившего) */
    drawOfferBy: { type: String, enum: ['white', 'black', null], default: null },
    ratingChanges: {
        white: { type: Number, default: null },
        black: { type: Number, default: null },
    },
    ratings: {
        white: RatingSnapshotSchema,
        black: RatingSnapshotSchema,
    },
    /** Диапазон рейтинга соперника для открытого вызова: ±N от рейтинга создателя (null — любой) */
    ratingRange: { type: Number, default: null },
    /** Реванш: id предыдущей партии */
    rematchOf: { type: Schema.Types.ObjectId, ref: 'LiveGame', default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
}, { timestamps: true });

LiveGameSchema.index({ whitePlayer: 1, createdAt: -1 });
LiveGameSchema.index({ blackPlayer: 1, createdAt: -1 });
LiveGameSchema.index({ status: 1, isPrivate: 1, createdAt: -1 });

const LiveGame = mongoose.model('LiveGame', LiveGameSchema);
LiveGame.STATUSES = STATUSES;
LiveGame.END_REASONS = END_REASONS;
LiveGame.START_FEN = START_FEN;

module.exports = LiveGame;
