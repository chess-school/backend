// Integration: лобби и вызовы (REST /api/v2/play), партия через socket.io /play двумя клиентами,
// реванш, очередь автоподбора (юнит с фейковым временем и сквозной через сокеты).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'integration-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

let mongo, server, io, BASE, API, LiveGame, User;
const users = {};
const sockets = [];

const call = async (method, url, who, body) => {
    const res = await fetch(API + url, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${users[who].token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};
const socketOf = (who) => new Promise((resolve, reject) => {
    const s = connect(`${BASE}/play`, { auth: { token: users[who]?.token ?? who }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
});
const emit = (s, event, payload) => new Promise((resolve) => s.emit(event, payload, resolve));
const next = (s, event, ms = 3000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), ms);
    s.once(event, (p) => { clearTimeout(timer); resolve(p); });
});

test.before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const app = express();
    app.use(express.json());
    app.use((req, res, next2) => { req.t = (k) => k; next2(); });
    app.use('/api/v2', require('../../v2/routes'));
    app.use('/api/v2', require('../../v2/middleware/errorHandlerV2').middleware);
    server = http.createServer(app);
    io = new Server(server);
    require('../../sockets/play.sockets')(io);
    const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    BASE = `http://127.0.0.1:${port}`;
    API = `${BASE}/api/v2`;
    LiveGame = require('../../v2/models/LiveGame');
    User = require('../../v2/models/User');
    await Promise.all([LiveGame.syncIndexes(), User.syncIndexes()]);
    for (const key of ['Alice', 'Bob', 'Carol', 'Dave', 'Erin']) {
        const u = await User.create({ firstName: key, lastName: 'Player', email: `${key.toLowerCase()}@play.io`, password: 'secret123', sessionTokenVersion: 1 });
        users[key] = { u, id: String(u._id), token: jwt.sign({ id: u._id, roles: ['USER'], sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    }
});

test.after(async () => {
    sockets.forEach((s) => s.close());
    require('../../v2/services/play').getGameManager().shutdown();
    require('../../v2/services/play/matchmaking').getMatchmaking().stop();
    io.close();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
});

test('вызов: валидация контроля, ссылка, принятие (цвет создателя), повторное и своё принятие', async () => {
    assert.equal((await call('GET', '/play/presets')).data.data.presets[0].id, '1+0');
    for (const bad of [{ minutes: 0, increment: 0 }, { minutes: 181, increment: 0 }, { minutes: 5, increment: 61 }, { minutes: 5, increment: 0, color: 'green' }]) {
        assert.equal((await call('POST', '/play/challenges', 'Alice', bad)).status, 422, JSON.stringify(bad));
    }
    assert.equal((await call('POST', '/play/challenges', null, { minutes: 5, increment: 0 })).status, 401);

    const created = await call('POST', '/play/challenges', 'Alice', { minutes: 7, increment: 5, rated: false, color: 'white', isPrivate: true });
    assert.equal(created.status, 201);
    const challenge = created.data.data;
    assert.deepEqual(challenge.timeControl, { type: 'rapid', initialSeconds: 420, incrementSeconds: 5, custom: true });
    const pending = await call('GET', `/play/games/${challenge._id}`);
    assert.equal(pending.data.data.status, 'created');

    assert.equal((await call('POST', `/play/challenges/${challenge._id}/accept`, 'Alice')).data.code, 'OWN_CHALLENGE');
    const accepted = await call('POST', `/play/challenges/${challenge._id}/accept`, 'Bob');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal((await call('POST', `/play/challenges/${challenge._id}/accept`, 'Carol')).data.code, 'CHALLENGE_TAKEN');

    const game = (await call('GET', `/play/games/${accepted.data.data.gameId}`)).data.data;
    assert.equal(game.status, 'active');
    assert.equal(game.white.firstName, 'Alice');
    assert.equal(game.black.firstName, 'Bob');
    assert.equal(game.clock.whiteMs, 420000);
    assert.equal(game.white.rating, 1500);
    const mine = (await call('GET', '/play/me', 'Bob')).data.data;
    assert.deepEqual(mine.activeGames.map((g) => g._id), [game._id]);
    assert.equal(mine.ratings.blitz.rating, 1500);
});

test('лобби: открытый вызов виден всем; диапазон рейтинга; отзыв; лимит открытых вызовов', async () => {
    await User.updateOne({ _id: users.Erin.u._id }, { $set: { 'ratings.blitz.rating': 2100 } });
    const open = (await call('POST', '/play/challenges', 'Carol', { minutes: 3, increment: 2, rated: true, isPrivate: false, ratingRange: 200 })).data.data;
    const lobby = (await call('GET', '/play/challenges', 'Dave')).data.data;
    assert.ok(lobby.some((c) => c._id === open._id && !c.mine && c.creator.rating === 1500));
    assert.ok((await call('GET', '/play/challenges', 'Carol')).data.data.find((c) => c._id === open._id).mine);

    const far = await call('POST', `/play/challenges/${open._id}/accept`, 'Erin');
    assert.equal(far.status, 403);
    assert.equal(far.data.code, 'RATING_OUT_OF_RANGE');

    assert.equal((await call('DELETE', `/play/challenges/${open._id}`, 'Dave')).status, 404, 'чужой вызов не отозвать');
    assert.equal((await call('DELETE', `/play/challenges/${open._id}`, 'Carol')).status, 200);
    assert.ok(!(await call('GET', '/play/challenges', 'Dave')).data.data.some((c) => c._id === open._id));

    for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/play/challenges', 'Dave', { minutes: 5, increment: 0, isPrivate: false })).status, 201);
    assert.equal((await call('POST', '/play/challenges', 'Dave', { minutes: 5, increment: 0, isPrivate: false })).data.code, 'TOO_MANY_CHALLENGES');
});

test('сокеты: чужой токен отклонён; ходы доходят сопернику; нелегальный и чужой ход — ошибка в ack; сдача', async () => {
    await assert.rejects(socketOf('not-a-token'));
    const { gameId } = await (async () => {
        const ch = (await call('POST', '/play/challenges', 'Alice', { minutes: 3, increment: 0, rated: true, color: 'white' })).data.data;
        return (await call('POST', `/play/challenges/${ch._id}/accept`, 'Bob')).data.data;
    })();
    const alice = await socketOf('Alice');
    const bob = await socketOf('Bob');
    const carol = await socketOf('Carol');
    const joined = await emit(alice, 'join_game', { gameId });
    assert.equal(joined.ok, true);
    assert.equal(joined.data.white.firstName, 'Alice');
    await emit(bob, 'join_game', { gameId });
    await emit(carol, 'join_game', { gameId }); // зритель

    const bobSees = next(bob, 'move');
    const carolSees = next(carol, 'move');
    const moved = await emit(alice, 'make_move', { gameId, uci: 'e2e4', ply: 0 });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    assert.equal((await bobSees).san, 'e4');
    assert.equal((await carolSees).ply, 1);

    assert.equal((await emit(bob, 'make_move', { gameId, uci: 'e7e4' })).error.code, 'ILLEGAL_MOVE');
    assert.equal((await emit(alice, 'make_move', { gameId, uci: 'd2d4' })).error.code, 'NOT_YOUR_TURN');
    assert.equal((await emit(carol, 'make_move', { gameId, uci: 'e7e5' })).error.code, 'NOT_A_PLAYER');
    assert.equal((await emit(bob, 'make_move', { gameId: 'nope', uci: 'e7e5' })).error.code, 'INVALID_ID');
    assert.equal((await emit(bob, 'make_move', { gameId, uci: 'e7e5', ply: 1 })).ok, true);

    const overA = next(alice, 'game_over');
    const overB = next(bob, 'game_over');
    assert.equal((await emit(bob, 'resign', { gameId })).ok, true);
    const [a, b] = await Promise.all([overA, overB]);
    assert.deepEqual([a.winner, a.endReason], ['white', 'resignation']);
    assert.ok(b.ratingChanges.white > 0 && b.ratingChanges.black < 0);
    assert.equal(b.ratings.white.before, 1500);

    // Реванш: предложение -> соперник получает rematch_offer -> его согласие запускает партию со сменой цветов
    const offer = next(bob, 'rematch_offer');
    const proposed = await emit(alice, 'rematch', { gameId });
    assert.equal(proposed.data.accepted, false);
    const offered = await offer;
    assert.equal(offered.newGameId, proposed.data.gameId);
    const started = next(alice, 'game_started');
    const acceptedRematch = await emit(bob, 'rematch', { gameId });
    assert.equal(acceptedRematch.data.accepted, true);
    assert.equal((await started).gameId, proposed.data.gameId);
    const rematchGame = (await call('GET', `/play/games/${proposed.data.gameId}`)).data.data;
    assert.deepEqual([rematchGame.white.firstName, rematchGame.black.firstName, rematchGame.status], ['Bob', 'Alice', 'active']);
});

test('автоподбор через сокеты: двое с одинаковым контролем соединяются и получают game_started', async () => {
    const dave = await socketOf('Dave');
    const erin = await socketOf('Erin');
    const waiting = await emit(dave, 'seek', { minutes: 5, increment: 3, rated: false });
    assert.deepEqual([waiting.ok, waiting.data.seeking], [true, true]);
    const daveStarted = next(dave, 'game_started');
    const erinStarted = next(erin, 'game_started');
    const paired = await emit(erin, 'seek', { minutes: 5, increment: 3, rated: false });
    assert.equal(paired.data.seeking, false);
    const [d, e] = await Promise.all([daveStarted, erinStarted]);
    assert.equal(d.gameId, e.gameId);
    const game = (await call('GET', `/play/games/${d.gameId}`)).data.data;
    assert.equal(game.source, 'pairing');
    assert.deepEqual([game.white.firstName, game.black.firstName].sort(), ['Dave', 'Erin']);
    assert.equal((await emit(dave, 'seek', { minutes: 0, increment: 0 })).error.code, 'INVALID_TIME_CONTROL');
});

test('очередь (юнит): контроль и тип совпадают, диапазоны взаимны и расширяются со временем, себя не соединяет', async () => {
    const { createMatchmaking, WIDEN_EVERY_MS, WIDEN_STEP } = require('../../v2/services/play/matchmaking');
    let t = 0;
    const pairs = [];
    const ratings = { a: 1500, b: 1580, c: 1900, d: 1500 };
    const mm = createMatchmaking({
        createPairedGame: async (x, y) => { pairs.push([x, y].sort().join('-')); return 'g'; },
        ratingOf: async (id) => ratings[id],
        now: () => t,
        sweepEvery: 0,
    });
    const u = (id) => ({ id });
    await mm.seek(u('a'), 's', { minutes: 3, increment: 0, rated: true });
    await mm.seek(u('a'), 's2', { minutes: 3, increment: 0, rated: true }); // повтор — не пара с собой
    await mm.seek(u('d'), 's', { minutes: 3, increment: 0, rated: false });  // товарищеская — другая очередь
    await mm.seek(u('c'), 's', { minutes: 5, increment: 0, rated: true });   // другой контроль
    assert.deepEqual(pairs, []);
    assert.equal(mm.size(), 3);

    mm.cancel('c');
    await mm.seek(u('c'), 's', { minutes: 3, increment: 0, rated: true, ratingRange: 100 }); // 1900 vs 1500 — далеко
    assert.deepEqual(pairs, []);
    t += Math.ceil(300 / WIDEN_STEP) * WIDEN_EVERY_MS;                    // диапазон расширился до 400
    await mm.sweep();
    assert.deepEqual(pairs, ['a-c']);

    await mm.seek(u('b'), 's', { minutes: 3, increment: 0, rated: false });
    assert.deepEqual(pairs, ['a-c', 'b-d'], 'товарищеские 3+0 соединились');
    assert.equal(mm.size(), 0);
    await assert.rejects(mm.seek(u('a'), 's', { minutes: 3, increment: 0, ratingRange: 10 }), (e) => e.code === 'VALIDATION_ERROR');
});
