// Integration: мульти-арендность (#7) — клубы, членства, переключатель и изоляция групп по клубу.
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

// HTTP-вызов с опциональным активным клубом (заголовок X-Club-Id)
const call = async (method, url, who, body, clubId) => {
    const res = await fetch(API + url, {
        method,
        headers: {
            ...(who ? { authorization: `Bearer ${users[who].token}` } : {}),
            ...(clubId ? { 'x-club-id': String(clubId) } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};

const mkUser = async (key, roles) => {
    const u = await models.User.create({ firstName: key, lastName: 'T', email: `${key}@t.io`, password: 'secret123', roles });
    users[key] = { u, id: String(u._id), token: jwt.sign({ id: String(u._id), uuid: u.uuid, roles, sessionTokenVersion: 0 }, process.env.JWT_SECRET) };
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

    models = {
        User: require('../../v2/models/User'),
        Coach: require('../../v2/models/Coach'),
        Group: require('../../v2/models/Group'),
        Club: require('../../v2/models/Club'),
        ClubMembership: require('../../v2/models/ClubMembership'),
    };
    await mkUser('Owner', ['USER', 'COACH']);
    await mkUser('Owner2', ['USER', 'COACH']);
    await mkUser('Stranger', ['USER']);
});

test.after(async () => {
    await mongoose.disconnect();
    if (server) await new Promise((r) => server.close(r));
    if (mongo) await mongo.stop();
});

test('clubs: создание клуба делает создателя владельцем; /clubs/mine возвращает его клубы', async () => {
    const created = await call('POST', '/clubs', 'Owner', { name: 'Hetman Poznań', city: 'Poznań', plan: 'club' });
    assert.equal(created.status, 201);
    assert.equal(created.data.slug, 'hetman-poznan');
    assert.equal(created.data.plan, 'club');
    assert.deepEqual(created.data.limits, { maxStudents: 150, maxTrainers: 10, maxLessonSize: 30 });
    users.Owner.clubA = created.data._id;

    const mine = await call('GET', '/clubs/mine', 'Owner');
    assert.equal(mine.status, 200);
    assert.equal(mine.data.data.length, 1);
    assert.equal(mine.data.data[0].role, 'owner');
    assert.equal(mine.data.data[0].club.name, 'Hetman Poznań');

    // Членство owner реально создано
    const m = await models.ClubMembership.findOne({ club: created.data._id, user: users.Owner.id }).lean();
    assert.equal(m.role, 'owner');
});

test('clubs: slug уникален при коллизии (-2)', async () => {
    const dup = await call('POST', '/clubs', 'Owner2', { name: 'Hetman Poznań' });
    assert.equal(dup.status, 201);
    assert.equal(dup.data.slug, 'hetman-poznan-2');
    users.Owner2.clubB = dup.data._id;
});

test('clubs: чужой клуб не виден в /clubs/mine; детали чужого клуба — 404', async () => {
    const mine = await call('GET', '/clubs/mine', 'Owner2');
    assert.equal(mine.data.data.length, 1);
    assert.equal(mine.data.data[0].club._id, users.Owner2.clubB);
    // Owner2 не участник клуба A → 404
    const foreign = await call('GET', `/clubs/${users.Owner.clubA}`, 'Owner2');
    assert.equal(foreign.status, 404);
    assert.equal(foreign.data.code, 'CLUB_NOT_FOUND');
});

test('resolveClub: невалидный X-Club-Id → 400; чужой клуб → 403', async () => {
    await models.Coach.create({ user: users.Owner.u._id });
    const bad = await call('GET', '/coaches/me/groups', 'Owner', null, 'not-an-id');
    assert.equal(bad.status, 400);
    assert.equal(bad.data.code, 'INVALID_CLUB_ID');

    const foreign = await call('GET', '/coaches/me/groups', 'Owner', null, users.Owner2.clubB);
    assert.equal(foreign.status, 403);
    assert.equal(foreign.data.code, 'NOT_CLUB_MEMBER');
});

test('изоляция групп: группа создаётся в активном клубе и видна только в нём', async () => {
    // Owner состоит и в клубе A (владелец), и добавим его в клуб B как тренера
    await models.ClubMembership.create({ club: users.Owner2.clubB, user: users.Owner.u._id, role: 'trainer', status: 'active' });

    // Создаём группу в клубе A
    const g = await call('POST', '/groups', 'Owner', { name: 'Juniors A' }, users.Owner.clubA);
    assert.equal(g.status, 201);
    assert.equal(String(g.data.club), String(users.Owner.clubA));

    // Список групп в клубе A — группа видна
    const inA = await call('GET', '/coaches/me/groups', 'Owner', null, users.Owner.clubA);
    assert.equal(inA.data.data.length, 1);
    assert.equal(inA.data.data[0].name, 'Juniors A');

    // Список групп в клубе B (тот же тренер) — изоляция: группы клуба A не видны
    const inB = await call('GET', '/coaches/me/groups', 'Owner', null, users.Owner2.clubB);
    assert.equal(inB.data.data.length, 0, 'группа клуба A не видна в клубе B');
});
