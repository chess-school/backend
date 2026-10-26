// Integration: Интерактивный класс — REST /api/v2/classrooms/:id/token (LiveKit-доступ) и socket.io
// namespace /classroom (учебная доска, передача хода, «поднять руку», lifecycle урока) на настоящих
// роутах, authV2 и classroomManager поверх in-memory MongoDB. Redis не поднимаем — менеджер работает
// в некластерном режиме (состояние в памяти), рассылку делает дефолтный in-memory adapter socket.io.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'integration-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'secretsecretsecretsecretsecret32';
process.env.LIVEKIT_URL = 'ws://localhost:7880';

let mongo, server, io, BASE, API, models, group, coachDoc, groupEvent, individualEvent;
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

const socketOf = (token) => new Promise((resolve, reject) => {
    const s = connect(`${BASE}/classroom`, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
});
const nextEvent = (s, event, ms = 3000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    s.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});
const emitAck = (s, event, payload) => new Promise((resolve) => s.emit(event, payload, resolve));

// Подделка подписи LiveKit-вебхука так, как её проверяет WebhookReceiver: JWT (HS256 секретом,
// iss=apiKey, обязателен exp) с claim sha256 = base64(sha256(сырое тело)).
const livekitAuth = (body, secret = process.env.LIVEKIT_API_SECRET) =>
    jwt.sign({ sha256: crypto.createHash('sha256').update(body).digest('base64') }, secret, { issuer: process.env.LIVEKIT_API_KEY, expiresIn: '5m' });
const webhook = async (eventObj, auth) => {
    const body = JSON.stringify(eventObj);
    const res = await fetch(`${API}/classrooms/webhooks/livekit`, {
        method: 'POST',
        headers: { 'content-type': 'application/webhook+json', authorization: auth === undefined ? livekitAuth(body) : auth },
        body,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};

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
    require('../../sockets/classroom.sockets')(io);
    const port = await listen(server);
    BASE = `http://127.0.0.1:${port}`;
    API = `${BASE}/api/v2`;

    models = {
        User: require('../../v2/models/User'),
        Coach: require('../../v2/models/Coach'),
        Group: require('../../v2/models/Group'),
        Schedule: require('../../v2/models/Schedule'),
        ClassroomSession: require('../../v2/models/ClassroomSession'),
    };
    await Promise.all(Object.values(models).map((m) => m.syncIndexes()));

    const mk = async (name, roles) => {
        const u = await models.User.create({ firstName: name, lastName: 'Test', email: `${name.toLowerCase()}@school.io`, password: 'secret123', roles, sessionTokenVersion: 1 });
        users[name] = { u, id: String(u._id), token: jwt.sign({ id: u._id, roles, sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    };
    await mk('Coach', ['USER', 'COACH']);
    await mk('Student', ['USER']);
    await mk('Student2', ['USER']);
    await mk('Stranger', ['USER']);
    await mk('Admin', ['USER', 'ADMIN']);

    coachDoc = await models.Coach.create({ user: users.Coach.u._id });
    group = await models.Group.create({
        name: 'Группа А',
        coach: coachDoc._id,
        members: [users.Student.u._id, users.Student2.u._id],
        status: 'active',
    });
    // Событие расписания — точка входа в урок: групповое (refId=group) и индивидуальное (для негатива)
    groupEvent = await models.Schedule.create({
        title: 'Занятие группы А', date: new Date('2026-10-22T18:00:00Z'), durationMinutes: 60,
        coach: coachDoc._id, context: { type: 'group', refId: group._id },
    });
    individualEvent = await models.Schedule.create({
        title: 'Индивидуальное', date: new Date('2026-10-22T19:00:00Z'),
        coach: coachDoc._id, context: { type: 'individual', refId: users.Student.u._id },
    });
});

test.after(async () => {
    sockets.forEach((s) => s.close());
    io.close();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
});

// --- REST: выдача LiveKit-токена ---

test('token: роль по отношению к группе — coach/student/admin; посторонний 403; битый id 400', async () => {
    const coach = await call('POST', `/classrooms/${group._id}/token`, 'Coach');
    assert.equal(coach.status, 200);
    assert.equal(coach.data.role, 'coach');
    assert.equal(coach.data.room, `classroom-${group._id}`);
    assert.equal(coach.data.identity, users.Coach.id);
    assert.ok(coach.data.token && coach.data.url, 'есть JWT и url медиасервиса');

    assert.equal((await call('POST', `/classrooms/${group._id}/token`, 'Student')).data.role, 'student');
    assert.equal((await call('POST', `/classrooms/${group._id}/token`, 'Admin')).data.role, 'coach', 'админ получает права тренера');

    const stranger = await call('POST', `/classrooms/${group._id}/token`, 'Stranger');
    assert.equal(stranger.status, 403);
    assert.equal(stranger.data.code, 'NOT_A_CLASSROOM_PARTICIPANT');

    assert.equal((await call('POST', `/classrooms/${group._id}/token`)).status, 401, 'без токена');
    assert.equal((await call('POST', '/classrooms/not-an-id/token', 'Coach')).status, 400);
    assert.equal((await call('POST', `/classrooms/${new mongoose.Types.ObjectId()}/token`, 'Coach')).data.code, 'CLASSROOM_NOT_FOUND');

    // Индивидуальная комната 1-на-1: roomId = lesson-<eventId>
    const indRoom = `lesson-${individualEvent._id}`;
    const indCoach = await call('POST', `/classrooms/${indRoom}/token`, 'Coach');
    assert.equal(indCoach.status, 200);
    assert.equal(indCoach.data.role, 'coach');
    assert.equal(indCoach.data.room, `classroom-${indRoom}`);
    assert.equal((await call('POST', `/classrooms/${indRoom}/token`, 'Student')).data.role, 'student', 'ученик события — student');
    assert.equal((await call('POST', `/classrooms/${indRoom}/token`, 'Student2')).data.code, 'NOT_A_CLASSROOM_PARTICIPANT');
});

test('token: LiveKit не сконфигурирован → 503 LIVEKIT_NOT_CONFIGURED (конфиг сервера, не ошибка клиента)', async () => {
    const saved = process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_KEY;
    try {
        const res = await call('POST', `/classrooms/${group._id}/token`, 'Coach');
        assert.equal(res.status, 503);
        assert.equal(res.data.code, 'LIVEKIT_NOT_CONFIGURED');
    } finally {
        process.env.LIVEKIT_API_KEY = saved;
    }
});

// --- Socket: авторизация namespace ---

test('socket: неверный/отсутствующий/отозванный токен отклоняются на handshake', async () => {
    await assert.rejects(socketOf('garbage'), (e) => e.data && e.data.code === 'TOKEN_INVALID');
    await assert.rejects(socketOf(undefined), (e) => e.data && e.data.code === 'TOKEN_REQUIRED');
    const revoked = jwt.sign({ id: users.Student.u._id, roles: ['USER'], sessionTokenVersion: 0 }, process.env.JWT_SECRET);
    await assert.rejects(socketOf(revoked), (e) => e.data && e.data.code === 'SESSION_REVOKED');
});

test('socket: join_class — роль из группы, снапшот доски; посторонний не входит; presence', async () => {
    const coach = await socketOf(users.Coach.token);
    const presenceAfterSecond = nextEvent(coach, 'presence');

    const coachJoin = await emitAck(coach, 'join_class', { groupId: String(group._id) });
    assert.equal(coachJoin.ok, true);
    assert.equal(coachJoin.data.role, 'coach');
    assert.equal(coachJoin.data.state.fen, require('../../v2/services/classroom/classroomManager').START_FEN);
    assert.equal(coachJoin.data.state.controllerId, users.Coach.id, 'по умолчанию ходом владеет тренер');

    const student = await socketOf(users.Student.token);
    const studentJoin = await emitAck(student, 'join_class', { groupId: String(group._id) });
    assert.equal(studentJoin.data.role, 'student');

    const presence = await presenceAfterSecond;
    assert.ok(presence.participants.length >= 1 && presence.participants.some((p) => p.userId === users.Coach.id));

    const stranger = await socketOf(users.Stranger.token);
    const denied = await emitAck(stranger, 'join_class', { groupId: String(group._id) });
    assert.deepEqual(denied, { ok: false, error: { msg: 'You are not a participant of this classroom.', code: 'NOT_A_CLASSROOM_PARTICIPANT' } });

    assert.equal((await emitAck(coach, 'join_class', { groupId: 'bad' })).error.code, 'INVALID_ID');

    // Индивидуальная комната 1-на-1 (roomId = lesson-<eventId>) тоже принимает join_class (регресс спиннера)
    const indJoin = await emitAck(coach, 'join_class', { groupId: `lesson-${individualEvent._id}` });
    assert.equal(indJoin.ok, true, 'join_class принимает индивидуальную комнату');
    assert.equal(indJoin.data.role, 'coach');
});

test('socket: ход тренера рассылается всем; ученик без контроля получает отказ', async () => {
    const coach = await socketOf(users.Coach.token);
    const student = await socketOf(users.Student.token);
    await emitAck(coach, 'join_class', { groupId: String(group._id) });
    await emitAck(student, 'join_class', { groupId: String(group._id) });

    const broadcast = nextEvent(student, 'board:update');
    const ack = await emitAck(coach, 'board:move', { groupId: String(group._id), uci: 'e2e4' });
    assert.equal(ack.ok, true);
    assert.equal(ack.data.lastMove.san, 'e4');
    assert.equal((await broadcast).lastMove.san, 'e4', 'ход долетел до ученика');

    const denied = await emitAck(student, 'board:move', { groupId: String(group._id), uci: 'e7e5' });
    assert.equal(denied.error.code, 'NOT_BOARD_CONTROLLER');
});

test('socket: передача хода ученику, «поднять руку» и lifecycle урока — в реальном времени', async () => {
    const coach = await socketOf(users.Coach.token);
    const student = await socketOf(users.Student.token);
    await emitAck(coach, 'join_class', { groupId: String(group._id) });
    await emitAck(student, 'join_class', { groupId: String(group._id) });
    const g = String(group._id);

    // Тренер передаёт ход ученику → ученик получает control:update и может ходить
    const control = nextEvent(student, 'control:update');
    await emitAck(coach, 'control:grant', { groupId: g, userId: users.Student.id });
    assert.equal((await control).controllerId, users.Student.id);
    const studentMove = await emitAck(student, 'board:move', { groupId: g, uci: 'g8f6' });
    assert.equal(studentMove.ok, true, JSON.stringify(studentMove));

    // «Поднять руку» — событие всем участникам
    const hand = nextEvent(coach, 'hand:update');
    await emitAck(student, 'hand:raise', { groupId: g });
    assert.ok((await hand).hands[users.Student.id], 'рука ученика видна тренеру');

    // Старт и завершение урока; на финише руки опускаются
    const started = nextEvent(student, 'lesson:state');
    const startAck = await emitAck(coach, 'lesson:start', { groupId: g });
    assert.equal(startAck.data.status, 'live');
    assert.ok(startAck.data.startedAt);
    assert.equal((await started).status, 'live');

    const handsCleared = nextEvent(coach, 'hand:update');
    const endAck = await emitAck(coach, 'lesson:end', { groupId: g });
    assert.equal(endAck.data.status, 'ended');
    assert.deepEqual((await handsCleared).hands, {}, 'в конце урока все руки опущены');

    // Ученик не может стартовать урок
    assert.equal((await emitAck(student, 'lesson:start', { groupId: g })).error.code, 'NOT_COACH');
});

test('socket: ученик шлёт ответ (solve:answer) — тренер видит его в solve:coach; решение ученику не утекает', async () => {
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const coach = await socketOf(users.Coach.token);
    const student = await socketOf(users.Student.token);
    const g = String(group._id);
    await emitAck(coach, 'join_class', { groupId: g });
    await emitAck(student, 'join_class', { groupId: g });

    // Тренер стартует решение с текстом решения — получает solve:coach с решением и линией в SAN
    const started = nextEvent(coach, 'solve:coach');
    await emitAck(coach, 'solve:start', { groupId: g, startFen: START, line: ['e2e4'], title: 'Задача', solution: 'Сыграйте e4' });
    const extras = await started;
    assert.equal(extras.solution, 'Сыграйте e4', 'тренер получает текст решения');
    assert.deepEqual(extras.lineSan, ['e4'], 'линия решения в SAN');

    // Ученику решение/ответы не отдаются (publicSolve)
    const sJoin = await emitAck(student, 'join_class', { groupId: g });
    assert.ok(sJoin.data.state.solve, 'ученик видит факт режима решения');
    assert.equal(sJoin.data.state.solve.solution, undefined, 'ученику текст решения не отдаётся');
    assert.equal(sJoin.data.state.solve.answers, undefined, 'ученику ответы не отдаются');

    // Верный ответ ученика — тренер видит его в solve:coach
    const onCorrect = nextEvent(coach, 'solve:coach');
    const okAns = await emitAck(student, 'solve:answer', { groupId: g, uci: 'e2e4' });
    assert.equal(okAns.ok, true);
    assert.equal(okAns.data.correct, true, 'ответ верный');
    const afterCorrect = await onCorrect;
    assert.equal(afterCorrect.answers[users.Student.id].correct, true, 'тренер видит верный ответ ученика');
    assert.equal(afterCorrect.answers[users.Student.id].san, 'e4');

    // Неверный ответ перезаписывает статус
    const onWrong = nextEvent(coach, 'solve:coach');
    const badAns = await emitAck(student, 'solve:answer', { groupId: g, uci: 'd2d4' });
    assert.equal(badAns.data.correct, false, 'ответ неверный');
    assert.equal((await onWrong).answers[users.Student.id].correct, false);

    coach.close();
    student.close();
});

// --- Tier 2: сессии урока из расписания ---

test('from-schedule: вход создаёт одну live-сессию (идемпотентно), пишет присутствие; негативы', async () => {
    const url = `/classrooms/from-schedule/${groupEvent._id}`;

    const student = await call('POST', url, 'Student');
    assert.equal(student.status, 200);
    assert.equal(student.data.role, 'student');
    assert.equal(student.data.groupId, String(group._id));
    assert.equal(student.data.room, `classroom-${group._id}`);
    assert.equal(student.data.status, 'live');
    assert.ok(student.data.sessionId);

    // Тренер входит в то же событие — та же сессия, присутствие дополняется (идемпотентность)
    const coach = await call('POST', url, 'Coach');
    assert.equal(coach.data.sessionId, student.data.sessionId, 'одно событие — одна live-сессия');
    // Повторный вход ученика не плодит записи присутствия
    await call('POST', url, 'Student');
    const session = await models.ClassroomSession.findById(student.data.sessionId).lean();
    assert.equal(session.attendance.length, 2, 'ровно две записи присутствия: тренер и ученик');
    assert.deepEqual([...session.attendance.map((a) => a.role)].sort(), ['coach', 'student']);

    // Негативы (групповое событие)
    assert.equal((await call('POST', url, 'Stranger')).data.code, 'NOT_A_CLASSROOM_PARTICIPANT');
    assert.equal((await call('POST', `/classrooms/from-schedule/${new mongoose.Types.ObjectId()}`, 'Coach')).data.code, 'EVENT_NOT_FOUND');
    assert.equal((await call('POST', '/classrooms/from-schedule/bad-id', 'Coach')).status, 400);
    assert.equal((await call('POST', url)).status, 401);

    // Индивидуальный урок 1-на-1 тоже заходит в живой класс (roomId = lesson-<eventId>)
    const indUrl = `/classrooms/from-schedule/${individualEvent._id}`;
    const indCoach = await call('POST', indUrl, 'Coach');
    assert.equal(indCoach.status, 200);
    assert.equal(indCoach.data.role, 'coach');
    assert.equal(indCoach.data.groupId, `lesson-${individualEvent._id}`);
    assert.equal(indCoach.data.room, `classroom-lesson-${individualEvent._id}`);
    const indStudent = await call('POST', indUrl, 'Student');
    assert.equal(indStudent.data.role, 'student', 'ученик события (context.refId) входит как student');
    assert.equal(indStudent.data.sessionId, indCoach.data.sessionId, 'одно индивидуальное событие — одна live-сессия');
    // Чужой (не тренер и не тот ученик) — 403
    assert.equal((await call('POST', indUrl, 'Student2')).data.code, 'NOT_A_CLASSROOM_PARTICIPANT');
    assert.equal((await call('POST', indUrl, 'Stranger')).data.code, 'NOT_A_CLASSROOM_PARTICIPANT');
});

test('end-session: только тренер/админ; идемпотентно; фиксирует endedAt и выход участников', async () => {
    const entered = await call('POST', `/classrooms/from-schedule/${groupEvent._id}`, 'Coach');
    const sessionId = entered.data.sessionId;

    assert.equal((await call('POST', `/classrooms/sessions/${sessionId}/end`, 'Student')).data.code, 'NOT_COACH');

    const ended = await call('POST', `/classrooms/sessions/${sessionId}/end`, 'Coach');
    assert.equal(ended.status, 200);
    assert.equal(ended.data.status, 'ended');
    assert.ok(ended.data.endedAt);

    const stored = await models.ClassroomSession.findById(sessionId).lean();
    assert.ok(stored.attendance.every((a) => a.leftAt), 'у всех участников проставлен выход');

    // Идемпотентно: повторное завершение не падает и не меняет endedAt
    const again = await call('POST', `/classrooms/sessions/${sessionId}/end`, 'Coach');
    assert.equal(again.data.status, 'ended');
    assert.equal(new Date(again.data.endedAt).getTime(), new Date(ended.data.endedAt).getTime());

    assert.equal((await call('POST', `/classrooms/sessions/${new mongoose.Types.ObjectId()}/end`, 'Coach')).data.code, 'SESSION_NOT_FOUND');
});

test('from-schedule: после завершения вход создаёт НОВУЮ сессию; история группы — свежие первыми', async () => {
    // Предыдущий тест завершил сессию события groupEvent → новый вход начинает новую
    const fresh = await call('POST', `/classrooms/from-schedule/${groupEvent._id}`, 'Coach');
    const live = await models.ClassroomSession.find({ group: group._id, status: 'live' }).lean();
    assert.equal(live.length, 1, 'ровно одна живая сессия');
    assert.equal(String(live[0]._id), fresh.data.sessionId);

    const history = await call('GET', `/classrooms/${group._id}/sessions`, 'Student');
    assert.equal(history.status, 200);
    assert.ok(history.data.data.length >= 2, 'в истории минимум две сессии (завершённая + новая)');
    const times = history.data.data.map((s) => new Date(s.startedAt).getTime());
    assert.deepEqual([...times].sort((a, b) => b - a), times, 'отсортировано по убыванию startedAt');
    assert.equal(history.data.data[0].sessionId, fresh.data.sessionId, 'самая свежая сессия — первая');
    assert.equal((await call('GET', `/classrooms/${group._id}/sessions`, 'Stranger')).data.code, 'NOT_A_CLASSROOM_PARTICIPANT');
});

// --- Tier 2 / Шаг 3: LiveKit webhooks → посещаемость ---

test('webhook: подпись обязательна; событие вне классной комнаты игнорируется', async () => {
    const body = JSON.stringify({ event: 'participant_joined', room: { name: `classroom-${group._id}` }, participant: { identity: users.Student.id } });
    // Неверная подпись (чужой секрет) → 401
    const bad = await fetch(`${API}/classrooms/webhooks/livekit`, {
        method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: livekitAuth(body, 'wrong-secret') }, body,
    });
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).code, 'WEBHOOK_INVALID_SIGNATURE');

    // Валидная подпись, но комната не наша → 200, проигнорировано
    const other = await webhook({ event: 'participant_joined', room: { name: 'lobby-123' }, participant: { identity: users.Student.id } });
    assert.equal(other.status, 200);
    assert.equal(other.data.ignored, 'not-a-classroom-room');
});

test('webhook: join/left/room_finished обновляют посещаемость активной сессии', async () => {
    // Изолированная группа и своё событие расписания — чтобы не пересекаться с сессиями прошлых тестов
    const gw = await models.Group.create({ name: 'Группа W', coach: coachDoc._id, members: [users.Student.u._id, users.Student2.u._id], status: 'active' });
    const ev = await models.Schedule.create({ title: 'W', date: new Date('2026-10-23T10:00:00Z'), coach: coachDoc._id, context: { type: 'group', refId: gw._id } });
    const entered = await call('POST', `/classrooms/from-schedule/${ev._id}`, 'Coach'); // live-сессия + присутствие тренера
    const sessionId = entered.data.sessionId;
    const room = `classroom-${gw._id}`;

    // Ученик подключился к медиа напрямую (без HTTP-входа) — вебхук добавляет запись присутствия
    const joined = await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: users.Student.id, metadata: JSON.stringify({ role: 'student' }) } });
    assert.equal(joined.data.ok, 'joined');
    // Повторный join тренера (он уже есть из from-schedule) не плодит запись
    await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: users.Coach.id, metadata: JSON.stringify({ role: 'coach' }) } });

    let s = await models.ClassroomSession.findById(sessionId).lean();
    assert.equal(s.attendance.length, 2, 'тренер (из from-schedule) + ученик (из вебхука)');
    const student = s.attendance.find((a) => String(a.user) === users.Student.id);
    assert.equal(student.role, 'student');
    assert.equal(student.leftAt, null);

    // Ученик вышел → проставлен leftAt, сессия ещё live
    assert.equal((await webhook({ event: 'participant_left', room: { name: room }, participant: { identity: users.Student.id } })).data.ok, 'left');
    s = await models.ClassroomSession.findById(sessionId).lean();
    assert.ok(s.attendance.find((a) => String(a.user) === users.Student.id).leftAt, 'выход ученика зафиксирован');
    assert.equal(s.status, 'live');

    // Комната закрыта → сессия завершена, у всех проставлен выход
    assert.equal((await webhook({ event: 'room_finished', room: { name: room } })).data.ok, 'finished');
    s = await models.ClassroomSession.findById(sessionId).lean();
    assert.equal(s.status, 'ended');
    assert.ok(s.endedAt);
    assert.ok(s.attendance.every((a) => a.leftAt), 'выход проставлен всем участникам');

    // Нет живой сессии (уже завершена) → событие игнорируется
    assert.equal((await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: users.Student.id } })).data.ignored, 'no-live-session');
});
