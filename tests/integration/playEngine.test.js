// Integration: движок онлайн-партий на настоящей MongoDB (in-memory) с фейковыми часами и таймерами —
// списание времени и инкремент, флаг по серверному таймеру, нелегальные/чужие ходы, мат и рейтинг,
// ничья, сдача, отмена, восстановление после перезапуска, гонка двух ходов.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'integration-test-secret';

const { createGameManager, hasMatingMaterial } = require('../../v2/services/play/gameManager');
const { Chess } = require('chess.js');

let mongo, LiveGame, User;
const users = {};

// ---- фейковое время
let clockNow = 1_000_000;
let timers = [];
let timerSeq = 0;
const fake = {
    now: () => clockNow,
    setTimer: (fn, ms) => { const id = ++timerSeq; timers.push({ id, fn, at: clockNow + ms }); return id; },
    clearTimer: (id) => { timers = timers.filter((t) => t.id !== id); },
};
/** Сдвинуть время и выполнить наступившие таймеры (дожидаясь их обработки) */
const advance = async (ms) => {
    clockNow += ms;
    for (;;) {
        const due = timers.filter((t) => t.at <= clockNow).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        await due.fn();
    }
};

const events = [];
const makeManager = (overrides = {}) => createGameManager({ ...fake, emitToGame: (id, ev, p) => events.push({ id, ev, p }), ...overrides });
let manager;

const newGame = async ({ minutes = 3, increment = 2, rated = true, speed = 'blitz' } = {}) => {
    const doc = await LiveGame.create({
        whitePlayer: users.W._id, blackPlayer: users.B._id, createdBy: users.W._id, status: 'active', isRated: rated,
        timeControl: { type: speed, initialSeconds: minutes * 60, incrementSeconds: increment },
        clock: { whiteMs: minutes * 60000, blackMs: minutes * 60000, turnStartedAt: null }, startedAt: new Date(clockNow),
    });
    manager.activate(doc.toObject());
    return String(doc._id);
};
const W = () => String(users.W._id);
const B = () => String(users.B._id);
const rejects = async (promise, code) => {
    await assert.rejects(promise, (e) => { assert.equal(e.code, code); return true; });
};

test.before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    LiveGame = require('../../v2/models/LiveGame');
    User = require('../../v2/models/User');
    await Promise.all([LiveGame.syncIndexes(), User.syncIndexes()]);
    for (const [key, name] of [['W', 'White'], ['B', 'Black'], ['S', 'Stranger']]) {
        users[key] = await User.create({ firstName: name, lastName: 'P', email: `${key}@play.io`, password: 'secret123' });
    }
});
test.beforeEach(() => { manager = makeManager(); timers = []; events.length = 0; });
test.afterEach(() => manager.shutdown());
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('часы: до первых ходов обоих стоят; затем списывается время хода и добавляется инкремент', async () => {
    const id = await newGame({ minutes: 3, increment: 2 });
    await manager.move(id, W(), 'e2e4');
    await advance(5000);                 // чёрные думают 5 с над первым ходом — часы стоят
    const afterE5 = await manager.move(id, B(), 'e7e5');
    assert.equal(afterE5.clock.blackMs, 180000, 'первый ход чёрных без списания');
    assert.equal(afterE5.clock.running, true, 'после первого хода чёрных пошли часы белых');
    await advance(3000);
    const afterNf3 = await manager.move(id, W(), 'g1f3');
    assert.equal(afterNf3.clock.whiteMs, 180000 - 3000 + 2000);
    await advance(10000);
    const afterNc6 = await manager.move(id, B(), 'b8c6');
    assert.equal(afterNc6.clock.blackMs, 180000 - 10000 + 2000);
    await advance(1500);
    const snap = await manager.snapshot(id);
    assert.equal(snap.clock.whiteMs, 179000 - 1500, 'у стороны, чей ход, время тикает');
    assert.equal(snap.clock.blackMs, 172000);
    const doc = await LiveGame.findById(id).lean();
    assert.deepEqual(doc.moves, ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    assert.deepEqual(doc.sanMoves, ['e4', 'e5', 'Nf3', 'Nc6']);
    assert.equal(doc.clock.blackMs, 172000);
});

test('нелегальный ход, чужой ход, не игрок, битый формат, устаревшая позиция — отклонены, позиция цела', async () => {
    const id = await newGame();
    await rejects(manager.move(id, W(), 'e2e5'), 'ILLEGAL_MOVE');
    await rejects(manager.move(id, B(), 'e7e5'), 'NOT_YOUR_TURN');
    await rejects(manager.move(id, String(users.S._id), 'e2e4'), 'NOT_A_PLAYER');
    await rejects(manager.move(id, W(), 'castle!'), 'INVALID_MOVE_FORMAT');
    await rejects(manager.move(id, W(), 'e2e4', 3), 'STALE_POSITION');
    await manager.move(id, W(), 'e2e4', 0);
    await rejects(manager.move(id, W(), 'd2d4'), 'NOT_YOUR_TURN');
    const doc = await LiveGame.findById(id).lean();
    assert.deepEqual(doc.moves, ['e2e4']);
    await rejects(manager.move(new mongoose.Types.ObjectId().toString(), W(), 'e2e4'), 'GAME_NOT_FOUND');
});

test('гонка: два одновременных хода одного игрока — принят ровно один', async () => {
    const id = await newGame();
    const results = await Promise.allSettled([manager.move(id, W(), 'e2e4'), manager.move(id, W(), 'd2d4')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'NOT_YOUR_TURN');
    assert.equal((await LiveGame.findById(id).lean()).moves.length, 1);
});

test('флаг по серверному таймеру: поражение по времени и пересчёт рейтинга', async () => {
    const id = await newGame({ minutes: 1, increment: 0, speed: 'bullet' });
    await manager.move(id, W(), 'e2e4');
    await manager.move(id, B(), 'e7e5');
    await advance(59000);
    assert.equal((await LiveGame.findById(id).lean()).status, 'active');
    await advance(1500);
    const doc = await LiveGame.findById(id).lean();
    assert.equal(doc.status, 'finished');
    assert.equal(doc.winner, 'black');
    assert.equal(doc.endReason, 'timeout');
    assert.equal(doc.clock.whiteMs, 0);
    assert.ok(doc.ratingChanges.black > 0 && doc.ratingChanges.white < 0);
    const over = events.find((e) => e.ev === 'game_over' && e.id === id);
    assert.equal(over.p.winner, 'black');
    const [w, b] = await Promise.all([User.findById(users.W._id).lean(), User.findById(users.B._id).lean()]);
    assert.equal(w.ratings.bullet.games, 1);
    assert.equal(b.ratings.bullet.rating, 1500 + doc.ratingChanges.black);
    assert.equal(w.ratings.blitz.games, 0, 'другие категории не тронуты');
});

test('ход после падения флага не засчитывается (таймер ещё не сработал) — TIME_UP', async () => {
    manager = makeManager({ setTimer: () => 0, clearTimer: () => {} }); // таймеры «опаздывают»
    const id = await newGame({ minutes: 1, increment: 0, rated: false, speed: 'bullet' });
    await manager.move(id, W(), 'e2e4');
    await manager.move(id, B(), 'e7e5');
    clockNow += 61000;
    await rejects(manager.move(id, W(), 'g1f3'), 'TIME_UP');
    const doc = await LiveGame.findById(id).lean();
    assert.deepEqual([doc.status, doc.winner, doc.endReason, doc.moves.length], ['finished', 'black', 'timeout', 2]);
    assert.equal(doc.ratingChanges.white, null, 'товарищеская — без рейтинга');
});

test('мат (детский мат наоборот): победа, рейтинг; дальнейшие ходы — GAME_NOT_ACTIVE', async () => {
    const id = await newGame({ rated: true, speed: 'rapid', minutes: 10, increment: 0 });
    for (const [who, uci] of [[W, 'f2f3'], [B, 'e7e5'], [W, 'g2g4'], [B, 'd8h4']]) await manager.move(id, who(), uci);
    const doc = await LiveGame.findById(id).lean();
    assert.deepEqual([doc.winner, doc.endReason], ['black', 'checkmate']);
    assert.match(doc.pgn, /Qh4#/);
    assert.ok(doc.ratings.black.after > doc.ratings.black.before);
    assert.equal(doc.ratings.white.provisional, true);
    await rejects(manager.move(id, W(), 'e2e4'), 'GAME_NOT_ACTIVE');
});

test('ничья: предложение, ход соперника отклоняет его, встречное предложение = согласие; отказ', async () => {
    const id = await newGame({ rated: false });
    await rejects(manager.offerDraw(id, W()), 'DRAW_NOT_ALLOWED'); // до первых ходов
    await manager.move(id, W(), 'e2e4');
    await manager.move(id, B(), 'e7e5');
    await manager.offerDraw(id, B());
    assert.ok(events.some((e) => e.ev === 'draw_offer' && e.p.by === 'black'));
    await manager.move(id, W(), 'g1f3');                       // ход белых = отказ от ничьей
    await rejects(manager.acceptDraw(id, W()), 'NO_DRAW_OFFER');
    await manager.offerDraw(id, W());
    await manager.declineDraw(id, B());
    assert.equal((await LiveGame.findById(id).lean()).drawOfferBy, null);
    await manager.offerDraw(id, W());
    await manager.offerDraw(id, B());                          // встречное — согласие
    const doc = await LiveGame.findById(id).lean();
    assert.deepEqual([doc.status, doc.winner, doc.endReason], ['finished', 'draw', 'draw_agreement']);
});

test('сдача; сдача до первых ходов — отмена без рейтинга; таймер отмены первых ходов', async () => {
    let id = await newGame();
    await manager.move(id, W(), 'e2e4');
    await manager.move(id, B(), 'c7c5');
    await manager.resign(id, B());
    let doc = await LiveGame.findById(id).lean();
    assert.deepEqual([doc.winner, doc.endReason], ['white', 'resignation']);

    id = await newGame();
    await manager.resign(id, W());
    doc = await LiveGame.findById(id).lean();
    assert.deepEqual([doc.status, doc.endReason, doc.ratingChanges.white], ['aborted', 'aborted', null]);

    id = await newGame();
    await manager.move(id, W(), 'e2e4');
    await advance(29000);
    assert.equal((await LiveGame.findById(id).lean()).status, 'active');
    await advance(2000);                                        // чёрные не сделали первый ход за 30 с
    assert.equal((await LiveGame.findById(id).lean()).status, 'aborted');

    id = await newGame();
    await manager.move(id, W(), 'e2e4');
    await manager.move(id, B(), 'e7e5');
    await rejects(manager.abort(id, W()), 'ABORT_NOT_ALLOWED');
});

test('перезапуск сервера: партия и часы восстанавливаются из БД; флаг, упавший за время простоя, засчитывается', async () => {
    const id = await newGame({ minutes: 3, increment: 0 });
    await manager.move(id, W(), 'e2e4');
    await manager.move(id, B(), 'e7e5');
    await advance(4000);
    await manager.move(id, W(), 'g1f3');
    manager.shutdown();                                         // «падение» процесса

    clockNow += 7000;
    const restarted = makeManager();
    const snap = await restarted.snapshot(id);
    assert.equal(snap.status, 'active');
    assert.equal(snap.clock.blackMs, 180000 - 7000, 'время чёрных шло, пока сервер лежал');
    assert.equal(snap.clock.whiteMs, 176000);
    await restarted.move(id, B(), 'b8c6');
    assert.deepEqual((await LiveGame.findById(id).lean()).sanMoves, ['e4', 'e5', 'Nf3', 'Nc6']);
    restarted.shutdown();

    clockNow += 10 * 60000;                                     // долгий простой: флаг белых упал
    const again = makeManager();
    const after = await again.snapshot(id);
    assert.deepEqual([after.status, after.winner, after.endReason], ['finished', 'black', 'timeout']);
    again.shutdown();
});

test('флаг против «голого» короля — ничья (нечем поставить мат)', () => {
    const chess = new Chess('8/8/8/4k3/8/8/8/4K2R w - - 0 1');
    assert.equal(hasMatingMaterial(chess, 'white'), true);
    assert.equal(hasMatingMaterial(chess, 'black'), false);
    assert.equal(hasMatingMaterial(new Chess('8/8/8/4k3/8/8/2N5/4K3 w - - 0 1'), 'white'), false);
    assert.equal(hasMatingMaterial(new Chess('8/8/8/4k3/8/8/2NB4/4K3 w - - 0 1'), 'white'), true);
});
