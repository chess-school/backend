// Integration: публичные настройки сайта клуба (#7, шаг 1) — GET /api/v2/site/settings.
// Проверяем: публичный доступ по slug, нейтральные дефолты (без «Mind Over Board»),
// перенос контента MOB, ограничение фактов до 3 и изоляцию по X-Club-Id (чужой клуб не читается).
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
        Club: require('../../v2/models/Club'),
        ClubMembership: require('../../v2/models/ClubMembership'),
        SiteSettings: require('../../v2/models/SiteSettings'),
    };
    await mkUser('Owner', ['USER', 'COACH']);
    await mkUser('Stranger', ['USER']);

    // Клуб MOB — с перенесёнными настройками
    clubs.mob = await models.Club.create({ name: 'Mind Over Board', slug: 'mob', owner: users.Owner.u._id, brand: { primaryColor: '#8A2B2B' } });
    await models.SiteSettings.create({
        club: clubs.mob._id,
        siteName: 'Mind Over Board',
        tagline: 'An online platform for strategic growth.',
        auth: {
            promoTitle: 'Think deeper. Play sharper.',
            promoSubtitle: 'Train with titled coaches.',
            facts: [
                { value: 'GM & IM', label: 'titled coaches' },
                { value: '50k+', label: 'tactics' },
                { value: '+250', label: 'avg. gain' },
            ],
        },
        footer: { legalName: 'Mind Over Board' },
    });

    // Клуб Chess Cocks — БЕЗ настроек (нейтральный шаблон)
    clubs.cocks = await models.Club.create({ name: 'Chess Cocks', slug: 'chess-cocks', owner: users.Stranger.u._id, brand: { primaryColor: '#E23' } });
    // Stranger — участник только Chess Cocks
    await models.ClubMembership.create({ club: clubs.cocks._id, user: users.Stranger.u._id, role: 'owner', status: 'active' });
});

test.after(async () => {
    await mongoose.disconnect();
    if (server) await new Promise((r) => server.close(r));
    if (mongo) await mongo.stop();
});

test('публичный доступ без входа; неизвестный slug → дефолты платформы (без MOB)', async () => {
    const res = await call('GET', '/site/settings?slug=does-not-exist');
    assert.equal(res.status, 200);
    assert.equal(res.data.data.isClub, false);
    assert.equal(res.data.data.siteName, 'debiut');
    assert.equal(res.data.data.footer.legalName, 'debiut');
    assert.deepEqual(res.data.data.auth.facts, []);
});

test('клуб MOB: переносит тексты и обрезает факты до 3', async () => {
    const res = await call('GET', '/site/settings?slug=mob');
    assert.equal(res.status, 200);
    assert.equal(res.data.data.isClub, true);
    assert.equal(res.data.data.siteName, 'Mind Over Board');
    assert.equal(res.data.data.auth.promoTitle, 'Think deeper. Play sharper.');
    assert.equal(res.data.data.auth.facts.length, 3);
    assert.equal(res.data.data.auth.facts[0].value, 'GM & IM');
    assert.equal(res.data.data.primaryColor, '#8A2B2B');
});

test('клуб без настроек (Chess Cocks): своё имя, факты скрыты, нигде нет «Mind Over Board»', async () => {
    const res = await call('GET', '/site/settings?slug=chess-cocks');
    assert.equal(res.status, 200);
    assert.equal(res.data.data.siteName, 'Chess Cocks');
    assert.equal(res.data.data.footer.legalName, 'Chess Cocks');
    assert.deepEqual(res.data.data.auth.facts, []);
    assert.deepEqual(res.data.data.socials, {});
    assert.ok(!JSON.stringify(res.data.data).includes('Mind Over Board'), 'в ответе нет MOB');
});

test('изоляция: чужой X-Club-Id (не участник) не отдаёт настройки клуба — дефолты', async () => {
    // Owner НЕ участник Chess Cocks. Пробует прочитать его настройки через заголовок X-Club-Id.
    const res = await call('GET', '/site/settings', 'Owner', null, clubs.cocks._id);
    assert.equal(res.status, 200);
    assert.equal(res.data.data.isClub, false, 'чужой клуб по X-Club-Id не резолвится');
    assert.equal(res.data.data.siteName, 'debiut');
});

test('свой X-Club-Id (участник) отдаёт настройки его клуба', async () => {
    const res = await call('GET', '/site/settings', 'Stranger', null, clubs.cocks._id);
    assert.equal(res.status, 200);
    assert.equal(res.data.data.isClub, true);
    assert.equal(res.data.data.siteName, 'Chess Cocks');
});
