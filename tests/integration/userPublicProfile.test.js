// Integration: публичный профиль пользователя по uuid (GET /api/v2/users/:uuid).
// Чужой профиль виден авторизованному, но БЕЗ секретов (email/phone); аноним — 401; нет — 404.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'integration-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

let mongo, server, API, User;
const users = {};

const call = async (method, url, who) => {
    const res = await fetch(API + url, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${users[who].token}` } : {}) },
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};

const mkUser = async (key, roles) => {
    const u = await User.create({ firstName: key, lastName: 'T', email: `${key}@t.io`, phone: '+380501112233', password: 'secret123', roles });
    users[key] = { u, id: String(u._id), uuid: u.uuid, token: jwt.sign({ id: String(u._id), uuid: u.uuid, roles, sessionTokenVersion: 0 }, process.env.JWT_SECRET) };
    return u;
};

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
    User = require('../../v2/models/User');

    await mkUser('Coach', ['COACH']);
    await mkUser('Student', ['USER']);
});

test.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    server.close();
});

test('users: авторизованный тренер видит публичный профиль ученика (без секретов)', async () => {
    const res = await call('GET', `/users/${users.Student.uuid}`, 'Coach');
    assert.equal(res.status, 200);
    assert.equal(res.data.uuid, users.Student.uuid);
    assert.equal(res.data.firstName, 'Student');
    assert.deepEqual(res.data.roles, ['USER']);
    assert.ok(res.data.ratings, 'ratings присутствуют');
    // Секреты НЕ раскрываются третьим лицам
    assert.equal(res.data.email, undefined);
    assert.equal(res.data.phone, undefined);
    assert.equal(res.data.password, undefined);
});

test('users: аноним не видит чужой профиль (401)', async () => {
    const res = await call('GET', `/users/${users.Student.uuid}`, null);
    assert.equal(res.status, 401);
});

test('users: несуществующий uuid — 404', async () => {
    const res = await call('GET', '/users/00000000-0000-0000-0000-000000000000', 'Coach');
    assert.equal(res.status, 404);
});
