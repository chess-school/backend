// Integration: страница «Тренеры» — список/поиск GET /api/v2/coaches и заявки ученик -> тренер
// (отправка, свои заявки, список тренера, одобрение с записью на курс, отклонение) на настоящих роутах.
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
let anna, boris, unverified, course;

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
        Coach: require('../../v2/models/Coach'),
        Course: require('../../v2/models/Course'),
        TrainingContract: require('../../v2/models/TrainingContract'),
        CoachRequest: require('../../v2/models/CoachRequest'),
        Notification: require('../../v2/models/Notification'),
    };
    await Promise.all(Object.values(models).map((m) => m.syncIndexes()));

    const mk = async (key, firstName, lastName, roles) => {
        const u = await models.User.create({ firstName, lastName, email: `${key.toLowerCase()}@school.io`, password: 'secret123', roles, sessionTokenVersion: 1 });
        users[key] = { u, id: String(u._id), token: jwt.sign({ id: u._id, roles, sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    };
    await mk('Anna', 'Anna', 'Kowalska', ['USER', 'COACH']);
    await mk('Boris', 'Boris', 'Spassky', ['USER', 'COACH']);
    await mk('Hidden', 'Hidden', 'Coach', ['USER', 'COACH']);
    await mk('Student', 'Ivan', 'Petrov', ['USER']);
    await mk('Admin', 'Root', 'Admin', ['USER', 'ADMIN']);

    anna = await models.Coach.create({ user: users.Anna.u._id, isVerified: true, headline: { en: 'Endgame expert' }, bio: { en: 'FIDE trainer' }, platformRating: { average: 4.9, count: 10 } });
    boris = await models.Coach.create({ user: users.Boris.u._id, isVerified: true, headline: { en: 'Openings' }, platformRating: { average: 4.1, count: 3 } });
    unverified = await models.Coach.create({ user: users.Hidden.u._id, isVerified: false, headline: { en: 'Hidden' } });
    // Курс Анны — без валидации схемы (важны только автор, цена и статус)
    const { insertedId } = await models.Course.collection.insertOne({ title: { en: 'Endgames' }, authors: [anna._id], price: { amount: 0, currency: 'USD' }, status: 'published' });
    course = { _id: insertedId };
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
});

test('список: только верифицированные, рейтинг по убыванию, объект { data, pagination }; поиск по имени', async () => {
    const list = await call('GET', '/coaches');
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.data.data), 'data — массив (страница ждёт его, а не объект)');
    assert.deepEqual(list.data.data.map((c) => c.user.firstName), ['Anna', 'Boris']);
    assert.equal(list.data.data[0].headline, 'Endgame expert');
    assert.equal(list.data.pagination.totalCoaches, 2);
    assert.equal(list.data.data[0].payoutInfo, undefined, 'финансовые данные не утекают');

    const found = await call('GET', '/coaches?q=kowal');
    assert.deepEqual(found.data.data.map((c) => c.user.lastName), ['Kowalska']);
    const twoWords = await call('GET', '/coaches?q=boris%20spa');
    assert.deepEqual(twoWords.data.data.map((c) => c.user.firstName), ['Boris']);
    const special = await call('GET', '/coaches?q=' + encodeURIComponent('(.*'));
    assert.equal(special.status, 200, 'спецсимволы в поиске экранируются');
    assert.deepEqual(special.data.data, []);
    assert.equal((await call('GET', '/coaches?limit=500')).status, 422);
});

test('заявка: отправка, повтор — 409, себе — 422, неверифицированному — 404, валидация', async () => {
    const sent = await call('POST', `/coaches/${anna._id}/requests`, 'Student', { experience: 'Intermediate', goals: 'Хочу 2000 к лету' });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    assert.equal(sent.data.data.status, 'pending');
    const again = await call('POST', `/coaches/${anna._id}/requests`, 'Student', { experience: 'Beginner' });
    assert.equal(again.status, 409);
    assert.equal(again.data.code, 'REQUEST_PENDING');

    assert.equal((await call('POST', `/coaches/${anna._id}/requests`, 'Anna', { experience: 'Advanced' })).data.code, 'SELF_REQUEST');
    assert.equal((await call('POST', `/coaches/${unverified._id}/requests`, 'Student', { experience: 'Advanced' })).status, 404);
    assert.equal((await call('POST', `/coaches/${anna._id}/requests`, null, { experience: 'Advanced' })).status, 401);
    const bad = await call('POST', `/coaches/${boris._id}/requests`, 'Student', { experience: 'Grandmaster' });
    assert.equal(bad.status, 422);
    assert.equal(bad.data.details[0].field, 'experience');
    assert.equal((await call('POST', '/coaches/not-an-id/requests', 'Student', { experience: 'Advanced' })).status, 400);

    const mine = await call('GET', '/coaches/requests/sent', 'Student');
    assert.deepEqual(mine.data.data.map((r) => [r.coach.user.firstName, r.status]), [['Anna', 'pending']]);
    const notified = await models.Notification.findOne({ recipient: users.Anna.u._id, type: 'COACH_REQUEST' }).lean();
    assert.ok(notified, 'тренер получил уведомление');
});

test('тренер видит только свои заявки; одобрение требует курс и записывает ученика', async () => {
    const annaList = await call('GET', '/coaches/me/requests', 'Anna');
    assert.equal(annaList.data.data.length, 1);
    assert.equal(annaList.data.data[0].student.firstName, 'Ivan');
    assert.equal((await call('GET', '/coaches/me/requests', 'Boris')).data.data.length, 0);
    assert.equal((await call('GET', '/coaches/me/requests', 'Student')).status, 403);

    const id = annaList.data.data[0]._id;
    assert.equal((await call('PATCH', `/coaches/me/requests/${id}`, 'Boris', { status: 'rejected' })).status, 404, 'чужая заявка');
    const noCourse = await call('PATCH', `/coaches/me/requests/${id}`, 'Anna', { status: 'approved' });
    assert.equal(noCourse.status, 422);
    assert.equal(noCourse.data.details[0].field, 'courseId');

    const approved = await call('PATCH', `/coaches/me/requests/${id}`, 'Anna', { status: 'approved', courseId: String(course._id) });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.data.status, 'approved');
    const contract = await models.TrainingContract.findOne({ student: users.Student.u._id, coach: anna._id }).lean();
    assert.ok(contract, 'создана запись на курс — ученик в «Моих учениках»');
    assert.equal(String(approved.data.data.enrollment), String(contract._id));

    const twice = await call('PATCH', `/coaches/me/requests/${id}`, 'Anna', { status: 'rejected' });
    assert.equal(twice.data.code, 'REQUEST_ALREADY_DECIDED');
    // Уже ученик — новая заявка тому же тренеру не нужна
    assert.equal((await call('POST', `/coaches/${anna._id}/requests`, 'Student', { experience: 'Advanced' })).data.code, 'ALREADY_STUDENT');
    assert.ok(await models.Notification.exists({ recipient: users.Student.u._id, type: 'COACH_REQUEST_DECIDED' }));
});

test('отклонение; админ видит заявки всех тренеров; повторная заявка после отказа разрешена', async () => {
    const sent = await call('POST', `/coaches/${boris._id}/requests`, 'Student', { experience: 'Beginner' });
    const rejected = await call('PATCH', `/coaches/me/requests/${sent.data.data._id}`, 'Boris', { status: 'rejected' });
    assert.equal(rejected.data.data.status, 'rejected');
    assert.equal((await call('GET', '/coaches/me/requests', 'Admin')).data.data.length, 2);
    assert.equal((await call('GET', '/coaches/me/requests?status=pending', 'Admin')).data.data.length, 0);
    assert.equal((await call('POST', `/coaches/${boris._id}/requests`, 'Student', { experience: 'Beginner' })).status, 201);
});
