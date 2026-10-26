// Integration: пересчёт рейтинга при попытке решения (POST /api/v2/puzzle-books/:id/attempts) — Module 4
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
let book, exId;

const call = async (method, url, who, body) => {
    const res = await fetch(API + url, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${users[who].token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
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

    models = {
        User: require('../../v2/models/User'),
        PuzzleBook: require('../../v2/models/PuzzleBook'),
    };
    const mk = async (key, roles) => {
        const u = await models.User.create({ firstName: key, lastName: 'T', email: `${key.toLowerCase()}@school.io`, password: 'secret123', roles, sessionTokenVersion: 1 });
        users[key] = { u, id: String(u._id), token: jwt.sign({ id: u._id, roles, sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    };
    await mk('Coach', ['USER', 'COACH']);
    await mk('Stud', ['USER']);

    book = await models.PuzzleBook.create({
        title: 'B', createdBy: users.Coach.u._id, status: 'published',
        exercises: [{ title: 'Ex', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', solution: '', rating: 1500 }],
    });
    exId = String(book.exercises[0]._id);
});

test.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    await new Promise((r) => server.close(r));
});

test('успешная попытка: ученик растёт, задача падает, значения персистятся', async () => {
    const { status, data } = await call('POST', `/puzzle-books/${book._id}/attempts`, 'Stud', {
        exerciseId: exId, solved: true, usedHint: false, attemptsCount: 0, timeTakenSeconds: 12,
    });
    assert.equal(status, 201);
    assert.equal(data.data.rating.success, true);
    assert.equal(data.data.rating.userDelta, 16);
    assert.equal(data.data.rating.puzzleDelta, -12);
    assert.equal(data.data.rating.userRating, 1516);
    assert.equal(data.data.rating.puzzleRating, 1488);

    // Персист в БД
    const u = await models.User.findById(users.Stud.id).select('puzzleRating puzzleRatingGames');
    assert.equal(u.puzzleRating, 1516);
    assert.equal(u.puzzleRatingGames, 1);
    const b = await models.PuzzleBook.findById(book._id).select('exercises.rating exercises.ratingAttempts');
    assert.equal(b.exercises[0].rating, 1488);
    assert.equal(b.exercises[0].ratingAttempts, 1);
});

test('подсказка/ошибка не считаются успехом → ученик падает, задача растёт', async () => {
    const before = await models.User.findById(users.Stud.id).select('puzzleRating');
    const { data } = await call('POST', `/puzzle-books/${book._id}/attempts`, 'Stud', {
        exerciseId: exId, solved: true, usedHint: true, attemptsCount: 0,
    });
    assert.equal(data.data.rating.success, false);
    assert.ok(data.data.rating.userDelta < 0);
    assert.ok(data.data.rating.puzzleDelta > 0);
    const after = await models.User.findById(users.Stud.id).select('puzzleRating');
    assert.ok(after.puzzleRating < before.puzzleRating);
});

test('решение с ошибками (attemptsCount>0) — не успех', async () => {
    const { data } = await call('POST', `/puzzle-books/${book._id}/attempts`, 'Stud', {
        exerciseId: exId, solved: true, usedHint: false, attemptsCount: 3,
    });
    assert.equal(data.data.rating.success, false);
});

test('неизвестное упражнение → 400', async () => {
    const { status } = await call('POST', `/puzzle-books/${book._id}/attempts`, 'Stud', { exerciseId: 'deadbeef' });
    assert.equal(status, 400);
});
