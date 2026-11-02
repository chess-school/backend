// Integration: превью suspended-клуба. Публичная витрина /clubs/by-slug/:slug отдаёт
// suspended-клуб ТОЛЬКО владельцу/участнику (published:false); чужим/анонимам — 404.
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

const call = async (method, url, who, body) => {
    const res = await fetch(API + url, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${users[who].token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
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
    models = { User: require('../../v2/models/User'), Club: require('../../v2/models/Club') };

    await mkUser('Owner', ['USER']);
    await mkUser('Stranger', ['USER']);
});

test.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    server.close();
});

test('clubPreview: suspended-клуб виден владельцу (published:false), чужим/анонимам — 404', async () => {
    const created = await call('POST', '/clubs', 'Owner', { name: 'Hidden Club', city: 'Poznań' });
    assert.equal(created.status, 201);
    const slug = created.data.slug;

    // Активный — виден всем, published:true
    const active = await call('GET', `/clubs/by-slug/${slug}`, 'Stranger');
    assert.equal(active.status, 200);
    assert.equal(active.data.data.published, true);

    // Переводим в suspended
    await models.Club.updateOne({ _id: created.data._id }, { status: 'suspended' });

    // Владелец всё ещё видит — как превью
    const asOwner = await call('GET', `/clubs/by-slug/${slug}`, 'Owner');
    assert.equal(asOwner.status, 200);
    assert.equal(asOwner.data.data.published, false);
    assert.equal(asOwner.data.data.club.name, 'Hidden Club');

    // Чужой — 404
    const asStranger = await call('GET', `/clubs/by-slug/${slug}`, 'Stranger');
    assert.equal(asStranger.status, 404);

    // Аноним — 404
    const asAnon = await call('GET', `/clubs/by-slug/${slug}`, null);
    assert.equal(asAnon.status, 404);
});
