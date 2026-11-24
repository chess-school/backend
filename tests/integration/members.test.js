// Integration: управление участниками клуба (#7 роли) — список, приглашение, смена роли,
// удаление и проверки прав (clubPermissions).
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
        Club: require('../../v2/models/Club'),
        ClubMembership: require('../../v2/models/ClubMembership'),
    };
    await mkUser('Owner', ['USER']);        // роль COACH выдаст сам createClub
    await mkUser('Member', ['USER']);       // существующий пользователь для приглашения
    await mkUser('Outsider', ['USER']);
});

test.after(async () => {
    await mongoose.disconnect();
    if (server) await new Promise((r) => server.close(r));
    if (mongo) await mongo.stop();
});

test('создание клуба выдаёт владельцу глобальную роль COACH и коуч-профиль', async () => {
    const created = await call('POST', '/clubs', 'Owner', { name: 'Debiut Club', plan: 'club' });
    assert.equal(created.status, 201);
    users.Owner.club = created.data._id;

    const u = await models.User.findById(users.Owner.id).lean();
    assert.ok(u.roles.includes('COACH'), 'владелец получил глобальную роль COACH');
    const coach = await models.Coach.findOne({ user: users.Owner.id }).lean();
    assert.ok(coach, 'владельцу создан коуч-профиль');
});

test('владелец видит участников: в списке он сам с ролью owner', async () => {
    const res = await call('GET', '/members', 'Owner', null, users.Owner.club);
    assert.equal(res.status, 200);
    assert.equal(res.data.data.length, 1);
    assert.equal(res.data.data[0].role, 'owner');
    assert.equal(res.data.data[0].user.email, 'owner@t.io');
});

test('приглашение существующего пользователя по email делает его активным участником', async () => {
    const inv = await call('POST', '/members/invite', 'Owner', { email: 'member@t.io', role: 'trainer' }, users.Owner.club);
    assert.equal(inv.status, 201);
    assert.equal(inv.data.data.role, 'trainer');
    assert.equal(inv.data.data.status, 'active');

    // trainer — обучающая роль → получил COACH + коуч-профиль
    const mu = await models.User.findById(users.Member.id).lean();
    assert.ok(mu.roles.includes('COACH'));

    const list = await call('GET', '/members', 'Owner', null, users.Owner.club);
    assert.equal(list.data.data.length, 2);
});

test('приглашение несуществующего email → 404 USER_NOT_FOUND', async () => {
    const inv = await call('POST', '/members/invite', 'Owner', { email: 'nobody@t.io', role: 'student' }, users.Owner.club);
    assert.equal(inv.status, 404);
    assert.equal(inv.data.code, 'USER_NOT_FOUND');
});

test('владелец меняет роль участника (trainer → student)', async () => {
    const res = await call('PATCH', `/members/${users.Member.id}/role`, 'Owner', { role: 'student' }, users.Owner.club);
    assert.equal(res.status, 200);
    assert.equal(res.data.data.role, 'student');
});

test('нельзя назначить роль owner (валидация), нельзя сменить роль владельца', async () => {
    const toOwner = await call('PATCH', `/members/${users.Member.id}/role`, 'Owner', { role: 'owner' }, users.Owner.club);
    assert.equal(toOwner.status, 422); // owner не входит в assignableRoles

    const changeOwner = await call('PATCH', `/members/${users.Owner.id}/role`, 'Owner', { role: 'admin' }, users.Owner.club);
    assert.equal(changeOwner.status, 403);
    assert.equal(changeOwner.data.code, 'OWNER_IMMUTABLE');
});

test('участник без прав (student) не видит список и не управляет', async () => {
    // Member теперь student в этом клубе
    const list = await call('GET', '/members', 'Member', null, users.Owner.club);
    assert.equal(list.status, 403);
    assert.equal(list.data.code, 'MEMBERS_FORBIDDEN');
});

test('владелец удаляет участника; себя (owner) удалить нельзя', async () => {
    const rm = await call('DELETE', `/members/${users.Member.id}`, 'Owner', null, users.Owner.club);
    assert.equal(rm.status, 200);
    const list = await call('GET', '/members', 'Owner', null, users.Owner.club);
    assert.equal(list.data.data.length, 1, 'после удаления остался только владелец');

    const self = await call('DELETE', `/members/${users.Owner.id}`, 'Owner', null, users.Owner.club);
    assert.equal(self.status, 403);
    assert.equal(self.data.code, 'OWNER_IMMUTABLE');
});
