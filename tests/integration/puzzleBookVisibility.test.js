// Integration: область видимости задачников PuzzleBook (Module 1, фронт ложится на задачники)
// Проверяет GET /puzzle-books (список), GET /:id, POST /:id/attempts и PATCH /:id с полями доступа.
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
const book = {};
let group;

const call = async (method, url, who, body) => {
    const res = await fetch(API + url, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${users[who].token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};
const titlesOf = (data) => (data || []).map((b) => b.title).sort();

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
        Group: require('../../v2/models/Group'),
        PuzzleBook: require('../../v2/models/PuzzleBook'),
    };
    const mk = async (key, roles) => {
        const u = await models.User.create({ firstName: key, lastName: 'T', email: `${key.toLowerCase()}@school.io`, password: 'secret123', roles, sessionTokenVersion: 1 });
        users[key] = { u, id: String(u._id), token: jwt.sign({ id: u._id, roles, sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    };
    await mk('Coach', ['USER', 'COACH']);
    await mk('Stud1', ['USER']);  // allowedUsers приватного
    await mk('Stud2', ['USER']);  // участник группы
    await mk('Stud3', ['USER']);  // без доступа

    const coach = await models.Coach.create({ user: users.Coach.u._id, isVerified: true, headline: { en: 'C' } });
    group = await models.Group.create({ name: 'G', coach: coach._id, members: [users.Stud2.u._id] });

    const ex = () => ([{ title: 'Ex', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', solution: '' }]);
    const mkBook = async (key, extra) => {
        book[key] = await models.PuzzleBook.create({ title: key, createdBy: users.Coach.u._id, exercises: ex(), ...extra });
    };
    await mkBook('pub', { status: 'published', visibility: 'public' });
    await mkBook('legacyPub', { status: 'published' });                 // visibility=draft по умолчанию => старое правило
    await mkBook('priv', { status: 'draft', visibility: 'private', allowedUsers: [users.Stud1.u._id] });
    await mkBook('grp', { status: 'draft', visibility: 'group', allowedGroups: [group._id] });
    await mkBook('arch', { status: 'published', visibility: 'public', isArchived: true });
    await mkBook('draftBook', { status: 'draft', visibility: 'draft' });
});

test.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    await new Promise((r) => server.close(r));
});

test('ученик без доступа видит только публичные/легаси', async () => {
    const { data } = await call('GET', '/puzzle-books', 'Stud3');
    assert.deepEqual(titlesOf(data.data), ['legacyPub', 'pub']);
});

test('ученик из allowedUsers дополнительно видит приватный задачник', async () => {
    const { data } = await call('GET', '/puzzle-books', 'Stud1');
    assert.deepEqual(titlesOf(data.data), ['legacyPub', 'priv', 'pub']);
});

test('участник группы дополнительно видит групповой задачник', async () => {
    const { data } = await call('GET', '/puzzle-books', 'Stud2');
    assert.deepEqual(titlesOf(data.data), ['grp', 'legacyPub', 'pub']);
});

test('тренер видит все задачники, список содержит поля бейджей', async () => {
    const { data } = await call('GET', '/puzzle-books', 'Coach');
    assert.equal(data.data.length, 6);
    const pub = data.data.find((b) => b.title === 'pub');
    assert.equal(pub.visibility, 'public');
    assert.equal(typeof pub.allowedUsersCount, 'number');
});

test('прямой доступ: посторонний ученик к приватному → 404, свой → 200', async () => {
    assert.equal((await call('GET', `/puzzle-books/${book.priv._id}`, 'Stud3')).status, 404);
    assert.equal((await call('GET', `/puzzle-books/${book.priv._id}`, 'Stud1')).status, 200);
    assert.equal((await call('GET', `/puzzle-books/${book.grp._id}`, 'Stud2')).status, 200);
});

test('архивный задачник скрыт от ученика даже при public', async () => {
    assert.equal((await call('GET', `/puzzle-books/${book.arch._id}`, 'Stud3')).status, 404);
});

test('attempts к приватному: свой ученик 201, посторонний 404', async () => {
    const exId = String(book.priv.exercises[0]._id);
    const ok = await call('POST', `/puzzle-books/${book.priv._id}/attempts`, 'Stud1', { exerciseId: exId, solved: true });
    assert.equal(ok.status, 201);
    const no = await call('POST', `/puzzle-books/${book.priv._id}/attempts`, 'Stud3', { exerciseId: exId, solved: true });
    assert.equal(no.status, 404);
});

test('updateBook принимает поля доступа; кривой visibility → 400', async () => {
    const ok = await call('PATCH', `/puzzle-books/${book.draftBook._id}`, 'Coach', {
        visibility: 'private', allowedUsers: [users.Stud1.id], isArchived: false,
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.data.visibility, 'private');
    assert.equal(ok.data.data.allowedUsers.length, 1);

    const bad = await call('PATCH', `/puzzle-books/${book.draftBook._id}`, 'Coach', { visibility: 'xxx' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.code, 'INVALID_VISIBILITY');
});
