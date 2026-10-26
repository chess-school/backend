// Integration: область видимости и управление доступом к курсам (Module 1)
// Проверяет фильтрацию GET /api/v2/courses и прямой доступ GET /api/v2/courses/:id по ролям
// (admin / coach-автор / coach-посторонний / ученик в allowedUsers / ученик в группе / ученик без доступа / гость).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'integration-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

let mongo, server, API, models;
const users = {};
const course = {};
let annaCoach, borisCoach, group;

const call = async (method, url, who, body) => {
    const res = await fetch(API + url, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${users[who].token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};

// id'шники курсов, видимых в выдаче GET /courses
const idsOf = (data) => (data || []).map((c) => String(c._id)).sort();

test.before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.t = (k) => k; req.language = 'en'; next(); });
    app.use('/api/v2', require('../../v2/routes'));
    app.use('/api/v2', require('../../v2/middleware/errorHandlerV2').middleware);
    server = http.createServer(app);
    const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    API = `http://127.0.0.1:${port}/api/v2`;

    models = {
        User: require('../../v2/models/User'),
        Coach: require('../../v2/models/Coach'),
        Course: require('../../v2/models/Course'),
        Group: require('../../v2/models/Group'),
    };
    await Promise.all(Object.values(models).map((m) => m.syncIndexes()));

    const mk = async (key, roles) => {
        const u = await models.User.create({ firstName: key, lastName: 'T', email: `${key.toLowerCase()}@school.io`, password: 'secret123', roles, sessionTokenVersion: 1 });
        users[key] = { u, id: String(u._id), token: jwt.sign({ id: u._id, roles, sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    };
    await mk('Anna', ['USER', 'COACH']);   // автор курсов
    await mk('Boris', ['USER', 'COACH']);  // посторонний тренер
    await mk('Stud1', ['USER']);           // в allowedUsers приватного курса
    await mk('Stud2', ['USER']);           // в группе группового курса
    await mk('Stud3', ['USER']);           // без доступа
    await mk('Admin', ['USER', 'ADMIN']);

    annaCoach = await models.Coach.create({ user: users.Anna.u._id, isVerified: true, headline: { en: 'A' } });
    borisCoach = await models.Coach.create({ user: users.Boris.u._id, isVerified: true, headline: { en: 'B' } });

    group = await models.Group.create({ name: 'Grp', coach: annaCoach._id, members: [users.Stud2.u._id] });

    const mkCourse = async (key, extra) => {
        const c = await models.Course.create({
            title: key, description: 'd', price: { amount: 0, currency: 'USD' },
            authors: [annaCoach._id], ...extra,
        });
        course[key] = c;
        return c;
    };
    await mkCourse('public', { visibility: 'public' });
    await mkCourse('draft', { visibility: 'draft' });
    await mkCourse('private', { visibility: 'private', allowedUsers: [users.Stud1.u._id] });
    await mkCourse('group', { visibility: 'group', allowedGroups: [group._id] });
    await mkCourse('archived', { visibility: 'public', isArchived: true });
    // Приватный курс Бориса, куда персонально добавлена Anna (тренер, но не автор)
    course.borisPrivate = await models.Course.create({
        title: 'borisPrivate', description: 'd', price: { amount: 0, currency: 'USD' },
        authors: [borisCoach._id], visibility: 'private', allowedUsers: [users.Anna.u._id],
    });
    // Легаси-курс: нет поля visibility, но status === 'published' (вставляем в обход схемы)
    const legacyRes = await models.Course.collection.insertOne({
        title: 'legacy', description: 'd', price: { amount: 0, currency: 'USD' },
        authors: [annaCoach._id], status: 'published', createdAt: new Date(0), updatedAt: new Date(0),
    });
    course.legacy = { _id: legacyRes.insertedId };
});

test.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    await new Promise((r) => server.close(r));
});

// ---------------------- GET /courses (каталог) ----------------------

test('гость видит только публичные и легаси-опубликованные (без draft/private/group/archived)', async () => {
    const { status, data } = await call('GET', '/courses?limit=100');
    assert.equal(status, 200);
    assert.deepEqual(idsOf(data.data), [String(course.public._id), String(course.legacy._id)].sort());
});

test('админ видит все курсы', async () => {
    const { status, data } = await call('GET', '/courses?limit=100', 'Admin');
    assert.equal(status, 200);
    assert.equal(data.data.length, 7); // public, draft, private, group, archived, borisPrivate, legacy
});

test('тренер-автор видит свои (любые статусы+архив) + публичные + чужие где он в allowedUsers', async () => {
    const { status, data } = await call('GET', '/courses?limit=100', 'Anna');
    assert.equal(status, 200);
    const ids = idsOf(data.data);
    // свои: public, draft, private, group, archived, legacy + чужой borisPrivate (в allowedUsers)
    for (const k of ['public', 'draft', 'private', 'group', 'archived', 'borisPrivate', 'legacy']) {
        assert.ok(ids.includes(String(course[k]._id)), `ожидался курс ${k}`);
    }
    assert.equal(ids.length, 7);
});

test('посторонний тренер видит публичные + свой borisPrivate, но не чужие приватные/черновики', async () => {
    const { status, data } = await call('GET', '/courses?limit=100', 'Boris');
    assert.equal(status, 200);
    const ids = idsOf(data.data);
    assert.ok(ids.includes(String(course.public._id)));
    assert.ok(ids.includes(String(course.borisPrivate._id)));
    assert.ok(!ids.includes(String(course.draft._id)));
    assert.ok(!ids.includes(String(course.private._id)));
    assert.ok(!ids.includes(String(course.group._id)));
});

test('ученик в allowedUsers видит публичные + свой приватный, не групповой и не чужой приватный', async () => {
    const { data } = await call('GET', '/courses?limit=100', 'Stud1');
    const ids = idsOf(data.data);
    assert.ok(ids.includes(String(course.public._id)));
    assert.ok(ids.includes(String(course.private._id)));
    assert.ok(!ids.includes(String(course.group._id)));
    assert.ok(!ids.includes(String(course.borisPrivate._id)));
    assert.ok(!ids.includes(String(course.draft._id)));
});

test('ученик в группе видит публичные + групповой, не приватный', async () => {
    const { data } = await call('GET', '/courses?limit=100', 'Stud2');
    const ids = idsOf(data.data);
    assert.ok(ids.includes(String(course.group._id)));
    assert.ok(!ids.includes(String(course.private._id)));
});

test('ученик без доступа видит только публичные/легаси', async () => {
    const { data } = await call('GET', '/courses?limit=100', 'Stud3');
    assert.deepEqual(idsOf(data.data), [String(course.public._id), String(course.legacy._id)].sort());
});

// ---------------------- GET /courses/:id (прямой доступ) ----------------------

test('гость: публичный курс — 200', async () => {
    const { status } = await call('GET', `/courses/${course.public._id}`);
    assert.equal(status, 200);
});

test('гость: приватный курс — 403', async () => {
    const { status, data } = await call('GET', `/courses/${course.private._id}`);
    assert.equal(status, 403);
    assert.equal(data.code, 'COURSE_FORBIDDEN');
});

test('ученик из allowedUsers: приватный курс — 200', async () => {
    const { status } = await call('GET', `/courses/${course.private._id}`, 'Stud1');
    assert.equal(status, 200);
});

test('посторонний ученик: приватный курс — 403', async () => {
    const { status } = await call('GET', `/courses/${course.private._id}`, 'Stud3');
    assert.equal(status, 403);
});

test('админ: черновик — 200', async () => {
    const { status } = await call('GET', `/courses/${course.draft._id}`, 'Admin');
    assert.equal(status, 200);
});

test('несуществующий курс — 404, кривой id — 400', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const notFound = await call('GET', `/courses/${fakeId}`, 'Admin');
    assert.equal(notFound.status, 404);
    const bad = await call('GET', '/courses/not-an-id', 'Admin');
    assert.equal(bad.status, 400);
});

// ---------------------- создание/обновление с visibility ----------------------

test('createCourse принимает visibility/allowedUsers, updateCourse меняет видимость', async () => {
    const created = await call('POST', '/courses', 'Anna', {
        title: 'New', description: 'd', price: { amount: 0, currency: 'USD' },
        visibility: 'private', allowedUsers: [users.Stud1.id],
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.visibility, 'private');
    assert.equal(created.data.allowedUsers.length, 1);

    const upd = await call('PUT', `/courses/${created.data._id}`, 'Anna', { visibility: 'public' });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.visibility, 'public');
});

test('createCourse с кривым visibility — 400', async () => {
    const bad = await call('POST', '/courses', 'Anna', {
        title: 'X', description: 'd', price: { amount: 0, currency: 'USD' }, visibility: 'nonsense',
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.code, 'INVALID_VISIBILITY');
});
