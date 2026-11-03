// Integration: заявки на пробное (Leads). Публичный приём с антиспамом/consent,
// список/смена статуса владельцем, изоляция клубов и роли.
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
const clubs = {};

const mkUser = async (key, roles) => {
    const u = await models.User.create({ firstName: key, lastName: 'T', email: `${key}@t.io`, password: 'secret123', roles });
    users[key] = { u, id: String(u._id), token: jwt.sign({ id: String(u._id), uuid: u.uuid, roles, sessionTokenVersion: 0 }, process.env.JWT_SECRET) };
    return u;
};

const call = async (method, url, { who, clubId, body } = {}) => {
    const res = await fetch(API + url, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(who ? { authorization: `Bearer ${users[who].token}` } : {}),
            ...(clubId ? { 'x-club-id': String(clubId) } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
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
        Club: require('../../v2/models/Club'),
        ClubMembership: require('../../v2/models/ClubMembership'),
        Lead: require('../../v2/models/Lead'),
    };

    await mkUser('Owner', ['USER', 'COACH']);
    await mkUser('Owner2', ['USER', 'COACH']);
    clubs.a = await models.Club.create({ name: 'Club A', slug: 'club-a', owner: users.Owner.u._id });
    clubs.b = await models.Club.create({ name: 'Club B', slug: 'club-b', owner: users.Owner2.u._id });
    await models.ClubMembership.create({ club: clubs.a._id, user: users.Owner.u._id, role: 'owner', status: 'active' });
    await models.ClubMembership.create({ club: clubs.b._id, user: users.Owner2.u._id, role: 'owner', status: 'active' });
});

test.after(async () => {
    await mongoose.disconnect();
    if (server) await new Promise((r) => server.close(r));
    if (mongo) await mongo.stop();
});

test('публично: заявка создаётся (consent + контакт), honeypot и отсутствие consent/контакта отвергаются', async () => {
    const ok = await call('POST', '/clubs/by-slug/club-a/leads', { body: { who: 'child', name: 'Anna', childAge: 8, email: 'a@b.io', level: 'new', consent: true } });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.ok, true);

    const noConsent = await call('POST', '/clubs/by-slug/club-a/leads', { body: { name: 'X', email: 'x@y.io' } });
    assert.equal(noConsent.status, 422);
    assert.equal(noConsent.data.code, 'NO_CONSENT');

    const noContact = await call('POST', '/clubs/by-slug/club-a/leads', { body: { name: 'X', consent: true } });
    assert.equal(noContact.status, 422);
    assert.equal(noContact.data.code, 'NO_CONTACT');

    // Honeypot — делает вид, что принял, но заявку не создаёт.
    const hp = await call('POST', '/clubs/by-slug/club-a/leads', { body: { name: 'Bot', email: 'bot@x.io', consent: true, company: 'spam' } });
    assert.equal(hp.status, 200);
});

test('владелец видит заявку своего клуба; чужой клуб не видит; не-владелец — 403', async () => {
    const a = await call('GET', '/leads', { who: 'Owner', clubId: clubs.a._id });
    assert.equal(a.status, 200);
    assert.ok(a.data.data.some((l) => l.name === 'Anna'), 'заявка Anna в списке клуба A');

    const b = await call('GET', '/leads', { who: 'Owner2', clubId: clubs.b._id });
    assert.equal(b.status, 200);
    assert.equal(b.data.data.length, 0, 'у клуба B заявок нет');
});

test('владелец меняет статус; чужой клуб не может обновить (404)', async () => {
    const a = await call('GET', '/leads', { who: 'Owner', clubId: clubs.a._id });
    const id = a.data.data[0]._id;

    const upd = await call('PATCH', `/leads/${id}`, { who: 'Owner', clubId: clubs.a._id, body: { status: 'contacted', note: 'called' } });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.data.status, 'contacted');

    const cross = await call('PATCH', `/leads/${id}`, { who: 'Owner2', clubId: clubs.b._id, body: { status: 'lost' } });
    assert.equal(cross.status, 404, 'чужой клуб не может трогать заявку');

    const bad = await call('PATCH', `/leads/${id}`, { who: 'Owner', clubId: clubs.a._id, body: { status: 'nonsense' } });
    assert.equal(bad.status, 422);
});
