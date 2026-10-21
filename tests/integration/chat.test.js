// Integration: личные сообщения тренер ↔ ученик — REST /api/v2/chat и socket.io namespace /chat
// на настоящих роутах и authV2 поверх in-memory MongoDB.
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

let mongo, server, io, BASE, API, models;
const users = {};
const sockets = [];

const listen = (srv) => new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));

const call = async (method, url, who, body) => {
    const res = await fetch(API + url, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${users[who].token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};

/** Подключение к /chat; резолвится после connect, отклоняется с ошибкой connect_error */
const socketOf = (token) => new Promise((resolve, reject) => {
    const s = connect(`${BASE}/chat`, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
});
const nextEvent = (s, event, ms = 3000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    s.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});
const emitAck = (s, event, payload) => new Promise((resolve) => s.emit(event, payload, resolve));

test.before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.t = (k) => k; next(); });
    app.use('/api/v2', require('../../v2/routes'));
    app.use('/api/v2', require('../../v2/middleware/errorHandlerV2').middleware);
    server = http.createServer(app);
    io = new Server(server);
    require('../../sockets/chat.sockets')(io);
    const port = await listen(server);
    BASE = `http://127.0.0.1:${port}`;
    API = `${BASE}/api/v2`;

    models = {
        User: require('../../v2/models/User'),
        Coach: require('../../v2/models/Coach'),
        TrainingContract: require('../../v2/models/TrainingContract'),
        ChatRoom: require('../../v2/models/ChatRoom'),
        ChatMessage: require('../../v2/models/ChatMessage'),
    };
    await Promise.all(Object.values(models).map((m) => m.syncIndexes()));

    const mk = async (name, roles) => {
        const u = await models.User.create({ firstName: name, lastName: 'Test', email: `${name.toLowerCase()}@school.io`, password: 'secret123', roles, sessionTokenVersion: 1 });
        users[name] = { u, id: String(u._id), token: jwt.sign({ id: u._id, roles, sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    };
    await mk('Coach', ['USER', 'COACH']);
    await mk('OtherCoach', ['USER', 'COACH']);
    await mk('Student', ['USER']);
    await mk('Cancelled', ['USER']);
    await mk('Stranger', ['USER']);
    await mk('Admin', ['USER', 'ADMIN']);

    const coach = await models.Coach.create({ user: users.Coach.u._id });
    const otherCoach = await models.Coach.create({ user: users.OtherCoach.u._id });
    // Записи на курс — без валидации схемы (цены/курс тут не важны), как их видит модуль students
    const contract = (student, coachId, status) => ({ student, coach: coachId, course: new mongoose.Types.ObjectId(), status, createdAt: new Date() });
    await models.TrainingContract.collection.insertMany([
        contract(users.Student.u._id, coach._id, 'active'),
        contract(users.Cancelled.u._id, coach._id, 'cancelled'),
        contract(users.Stranger.u._id, otherCoach._id, 'active'),
    ]);
});

test.after(async () => {
    sockets.forEach((s) => s.close());
    io.close();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
});

let room;

test('контакты: тренеру — его ученики (без отменённых), ученику — его тренер', async () => {
    const coach = await call('GET', '/chat/contacts', 'Coach');
    assert.equal(coach.status, 200);
    assert.deepEqual(coach.data.data.map((c) => c.firstName), ['Student']);
    assert.equal(coach.data.data[0].relation, 'student');
    assert.equal(coach.data.data[0].email, undefined, 'без лишних персональных данных');

    const student = await call('GET', '/chat/contacts', 'Student');
    assert.deepEqual(student.data.data.map((c) => [c.firstName, c.relation]), [['Coach', 'coach']]);

    assert.equal((await call('GET', '/chat/contacts')).status, 401);
});

test('создание комнаты: только пара тренер–ученик, идемпотентно, контекст — отдельная комната', async () => {
    const denied = await call('POST', '/chat/rooms', 'Student', { userId: users.Stranger.id });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, 'CHAT_NOT_ALLOWED');
    assert.equal((await call('POST', '/chat/rooms', 'Cancelled', { userId: users.Coach.id })).status, 403, 'отменённая запись — не пара');
    assert.equal((await call('POST', '/chat/rooms', 'Coach', { userId: users.Stranger.id })).status, 403, 'чужой ученик');
    assert.equal((await call('POST', '/chat/rooms', 'Student', { userId: users.Student.id })).data.code, 'CHAT_WITH_SELF');
    assert.equal((await call('POST', '/chat/rooms', 'Student', { userId: 'nope' })).status, 422);
    assert.equal((await call('POST', '/chat/rooms', 'Student', { userId: new mongoose.Types.ObjectId().toString() })).status, 404);

    const first = await call('POST', '/chat/rooms', 'Student', { userId: users.Coach.id });
    assert.equal(first.status, 201);
    room = first.data.data;
    assert.equal(room.interlocutor.firstName, 'Coach');
    assert.equal(room.context.kind, 'direct');

    const again = await call('POST', '/chat/rooms', 'Student', { userId: users.Coach.id });
    assert.equal(again.status, 200);
    assert.equal(again.data.data._id, room._id);
    const fromCoach = await call('POST', '/chat/rooms', 'Coach', { userId: users.Student.id });
    assert.equal(fromCoach.data.data._id, room._id, 'с другой стороны — та же комната');
    assert.equal(fromCoach.data.data.interlocutor.firstName, 'Student');

    const puzzle = await call('POST', '/chat/rooms', 'Student', { userId: users.Coach.id, context: { kind: 'puzzle', refId: 'book-42', title: 'Exercise 42' } });
    assert.equal(puzzle.status, 201);
    assert.notEqual(puzzle.data.data._id, room._id);
    assert.deepEqual(puzzle.data.data.context, { kind: 'puzzle', refId: 'book-42', title: 'Exercise 42' });
    assert.equal((await call('POST', '/chat/rooms', 'Student', { userId: users.Coach.id, context: { kind: 'homework' } })).status, 422, 'контекст без refId');

    const admin = await call('POST', '/chat/rooms', 'Admin', { userId: users.Stranger.id });
    assert.equal(admin.status, 201, 'админ пишет любому');
    assert.equal(await models.ChatRoom.countDocuments(), 3);
});

test('сообщения: валидация, пагинация курсором, порядок, дедупликация по clientId', async () => {
    assert.equal((await call('POST', `/chat/rooms/${room._id}/messages`, 'Student', { text: '   ' })).status, 422);
    assert.equal((await call('POST', `/chat/rooms/${room._id}/messages`, 'Student', { text: 'x'.repeat(4001) })).status, 422);
    assert.equal((await call('POST', '/chat/rooms/bad/messages', 'Student', { text: 'hi' })).status, 400);

    for (let i = 1; i <= 35; i++) {
        const r = await call('POST', `/chat/rooms/${room._id}/messages`, 'Student', { text: `msg ${i}` });
        assert.equal(r.status, 201);
    }
    const a = await call('POST', `/chat/rooms/${room._id}/messages`, 'Student', { text: 'once', clientId: 'c-1' });
    const b = await call('POST', `/chat/rooms/${room._id}/messages`, 'Student', { text: 'once', clientId: 'c-1' });
    assert.equal(a.data.data._id, b.data.data._id, 'повтор с тем же clientId — то же сообщение');
    assert.equal(a.data.data.clientId, 'c-1');

    const page1 = await call('GET', `/chat/rooms/${room._id}/messages?limit=30`, 'Coach');
    assert.equal(page1.status, 200);
    assert.equal(page1.data.data.length, 30);
    assert.equal(page1.data.hasMore, true);
    assert.equal(page1.data.data.at(-1).text, 'once', 'последняя страница — самые свежие, по возрастанию');
    const page2 = await call('GET', `/chat/rooms/${room._id}/messages?limit=30&before=${page1.data.data[0]._id}`, 'Coach');
    assert.equal(page2.data.data.length, 6);
    assert.equal(page2.data.hasMore, false);
    assert.equal(page2.data.data[0].text, 'msg 1');
    const all = [...page2.data.data, ...page1.data.data].map((m) => m._id);
    assert.equal(new Set(all).size, 36, 'страницы без пересечений');
});

test('чужой не видит и не пишет: 404 без утечки', async () => {
    for (const who of ['Stranger', 'OtherCoach']) {
        assert.equal((await call('GET', `/chat/rooms/${room._id}/messages`, who)).data.code, 'ROOM_NOT_FOUND');
        assert.equal((await call('POST', `/chat/rooms/${room._id}/messages`, who, { text: 'hack' })).status, 404);
        assert.equal((await call('POST', `/chat/rooms/${room._id}/read`, who)).status, 404);
    }
    const strangerRooms = await call('GET', '/chat/rooms', 'Stranger');
    assert.deepEqual(strangerRooms.data.data.map((r) => r.interlocutor.firstName), ['Admin']);
});

test('непрочитанные и прочтение', async () => {
    const before = await call('GET', '/chat/unread', 'Coach');
    assert.equal(before.data.data.total, 36);
    assert.equal(before.data.data.rooms[room._id], 36);
    assert.equal((await call('GET', '/chat/unread', 'Student')).data.data.total, 0, 'свои сообщения не непрочитанные');

    const rooms = await call('GET', '/chat/rooms', 'Coach');
    const direct = rooms.data.data.find((r) => r._id === room._id);
    assert.equal(direct.unreadCount, 36);
    assert.equal(direct.lastMessage.text, 'once');
    assert.equal(rooms.data.data[0]._id, room._id, 'комната с последним сообщением — первая');

    const read = await call('POST', `/chat/rooms/${room._id}/read`, 'Coach');
    assert.equal(read.data.data.updated, 36);
    assert.equal((await call('GET', '/chat/unread', 'Coach')).data.data.total, 0);
    const again = await call('POST', `/chat/rooms/${room._id}/read`, 'Coach');
    assert.equal(again.data.data.updated, 0);
    const history = await call('GET', `/chat/rooms/${room._id}/messages?limit=1`, 'Student');
    assert.ok(history.data.data[0].readAt, 'отправитель видит статус «прочитано»');
});

test('socket: неверный и отозванный токен отклоняются', async () => {
    await assert.rejects(socketOf('garbage'), (e) => e.data && e.data.code === 'TOKEN_INVALID');
    await assert.rejects(socketOf(undefined), (e) => e.data && e.data.code === 'TOKEN_REQUIRED');
    const revoked = jwt.sign({ id: users.Student.u._id, roles: ['USER'], sessionTokenVersion: 0 }, process.env.JWT_SECRET);
    await assert.rejects(socketOf(revoked), (e) => e.data && e.data.code === 'SESSION_REVOKED');
});

test('socket: сообщение доходит до собеседника, typing и прочтение — в реальном времени', async () => {
    const student = await socketOf(users.Student.token);
    const coach = await socketOf(users.Coach.token);
    const coachTab2 = await socketOf(users.Coach.token);
    const stranger = await socketOf(users.Stranger.token);
    let strangerGot = 0;
    stranger.on('message:new', () => { strangerGot++; });

    const incoming = nextEvent(coach, 'message:new');
    const incomingTab2 = nextEvent(coachTab2, 'message:new');
    const echo = nextEvent(student, 'message:new');
    const ack = await emitAck(student, 'message:send', { roomId: room._id, text: 'Через сокет', clientId: 'sock-1' });
    assert.equal(ack.ok, true);
    const got = await incoming;
    assert.equal(got.roomId, room._id);
    assert.equal(got.message._id, String(ack.data._id));
    assert.equal(got.message.text, 'Через сокет');
    assert.equal((await incomingTab2).message._id, got.message._id, 'во все вкладки');
    assert.equal((await echo).message.clientId, 'sock-1', 'отправитель получает эхо с clientId');
    assert.ok(await models.ChatMessage.exists({ _id: ack.data._id }), 'записано в БД');

    // REST тоже рассылает
    const viaRest = nextEvent(student, 'message:new');
    await call('POST', `/chat/rooms/${room._id}/messages`, 'Coach', { text: 'Ответ по REST' });
    assert.equal((await viaRest).message.text, 'Ответ по REST');

    const typing = nextEvent(coach, 'typing');
    await emitAck(student, 'typing', { roomId: room._id, typing: true });
    assert.deepEqual(await typing, { roomId: room._id, userId: users.Student.id, typing: true });

    const readEvent = nextEvent(student, 'message:read');
    const readAck = await emitAck(coach, 'message:read', { roomId: room._id });
    assert.equal(readAck.ok, true);
    assert.equal((await readEvent).readerId, users.Coach.id);

    const denied = await emitAck(stranger, 'message:send', { roomId: room._id, text: 'hack' });
    assert.deepEqual(denied, { ok: false, error: { msg: 'Chat room not found.', code: 'ROOM_NOT_FOUND' } });
    const empty = await emitAck(student, 'message:send', { roomId: room._id, text: '' });
    assert.equal(empty.error.code, 'VALIDATION_ERROR');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(strangerGot, 0, 'посторонний ничего не получил');
});

test('после отмены записи история видна, но писать в комнату нельзя (403)', async () => {
    const coach = await models.Coach.findOne({ user: users.Coach.u._id }).lean();
    const u = await models.User.create({ firstName: 'Leaving', lastName: 'Test', email: 'leaving@school.io', password: 'secret123', roles: ['USER'], sessionTokenVersion: 1 });
    users.Leaving = { u, id: String(u._id), token: jwt.sign({ id: u._id, roles: ['USER'], sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    const { insertedIds } = await models.TrainingContract.collection.insertMany([
        { student: u._id, coach: coach._id, course: new mongoose.Types.ObjectId(), status: 'active', createdAt: new Date() },
    ]);
    const opened = await call('POST', '/chat/rooms', 'Leaving', { userId: users.Coach.id });
    assert.ok([200, 201].includes(opened.status), JSON.stringify(opened.data));
    const roomId = opened.data.data._id;
    assert.equal((await call('POST', `/chat/rooms/${roomId}/messages`, 'Leaving', { text: 'Спасибо за урок' })).status, 201);

    await models.TrainingContract.collection.updateOne({ _id: insertedIds[0] }, { $set: { status: 'cancelled' } });
    for (const who of ['Leaving', 'Coach']) {
        const sent = await call('POST', `/chat/rooms/${roomId}/messages`, who, { text: 'ещё' });
        assert.equal(sent.status, 403);
        assert.equal(sent.data.code, 'CHAT_NOT_ALLOWED');
    }
    const history = await call('GET', `/chat/rooms/${roomId}/messages`, 'Leaving');
    assert.deepEqual(history.data.data.map((m) => m.text), ['Спасибо за урок']);
});
