// Integration: медиатека клуба (#7, шаг 2) — /api/v2/site/media.
// Проверяем: загрузку с генерацией вариантов webp, публичную отдачу файла, список,
// изоляцию между клубами (клуб B не видит и не удаляет медиа клуба A), роль (ученик не грузит),
// удаление (файл перестаёт отдаваться) и валидацию (нет файла → 422).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'integration-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.STORAGE_DRIVER = 'mongo';

let mongo, server, ROOT, API, models;
const users = {};
const clubs = {};

const mkUser = async (key, roles) => {
    const u = await models.User.create({ firstName: key, lastName: 'T', email: `${key}@t.io`, password: 'secret123', roles });
    users[key] = { u, id: String(u._id), token: jwt.sign({ id: String(u._id), uuid: u.uuid, roles, sessionTokenVersion: 0 }, process.env.JWT_SECRET) };
    return u;
};

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 80, b: 224 } } }).png().toBuffer();

// multipart-загрузка через глобальные FormData/Blob/fetch (Node 18+).
const upload = async (who, clubId, buffer, { alt, filename = 'photo.png', type = 'image/png', withFile = true } = {}) => {
    const fd = new FormData();
    if (withFile) fd.append('file', new Blob([buffer], { type }), filename);
    if (alt !== undefined) fd.append('alt', alt);
    const res = await fetch(API + '/site/media', {
        method: 'POST',
        headers: { authorization: `Bearer ${users[who].token}`, ...(clubId ? { 'x-club-id': String(clubId) } : {}) },
        body: fd,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};

const call = async (method, url, who, clubId) => {
    const res = await fetch(API + url, {
        method,
        headers: { ...(who ? { authorization: `Bearer ${users[who].token}` } : {}), ...(clubId ? { 'x-club-id': String(clubId) } : {}) },
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
    ROOT = `http://127.0.0.1:${port}`;
    API = `${ROOT}/api/v2`;

    models = {
        User: require('../../v2/models/User'),
        Club: require('../../v2/models/Club'),
        ClubMembership: require('../../v2/models/ClubMembership'),
        MediaAsset: require('../../v2/models/MediaAsset'),
        MediaBlob: require('../../v2/models/MediaBlob'),
    };

    await mkUser('OwnerA', ['USER', 'COACH']);
    await mkUser('OwnerB', ['USER', 'COACH']);
    await mkUser('StudentA', ['USER']);

    clubs.a = await models.Club.create({ name: 'Club A', slug: 'club-a', owner: users.OwnerA.u._id });
    clubs.b = await models.Club.create({ name: 'Club B', slug: 'club-b', owner: users.OwnerB.u._id });
    await models.ClubMembership.create({ club: clubs.a._id, user: users.OwnerA.u._id, role: 'owner', status: 'active' });
    await models.ClubMembership.create({ club: clubs.b._id, user: users.OwnerB.u._id, role: 'owner', status: 'active' });
    await models.ClubMembership.create({ club: clubs.a._id, user: users.StudentA.u._id, role: 'student', status: 'active' });
});

test.after(async () => {
    await mongoose.disconnect();
    if (server) await new Promise((r) => server.close(r));
    if (mongo) await mongo.stop();
});

test('загрузка картинки 1200×800 → 201, три webp-варианта, основная ссылка = large', async () => {
    const res = await upload('OwnerA', clubs.a._id, await png(1200, 800), { alt: 'Our hall' });
    assert.equal(res.status, 201);
    const m = res.data.data;
    assert.equal(m.alt, 'Our hall');
    assert.equal(m.mimeType, 'image/webp');
    assert.ok(m.variants.thumb && m.variants.medium && m.variants.large, 'есть все три варианта');
    assert.equal(m.variants.thumb.width, 400);
    assert.equal(m.variants.medium.width, 1024);
    assert.equal(m.variants.large.width, 1200, 'не апскейлим выше оригинала');
    assert.equal(m.url, m.variants.large.url, 'основная ссылка — самый большой вариант');
});

test('публичная отдача файла: url открывается без входа и отдаёт image/webp', async () => {
    const up = await upload('OwnerA', clubs.a._id, await png(800, 600));
    const url = up.data.data.url;                          // /api/v2/site/media/file/media/<club>/.../large.webp
    const res = await fetch(ROOT + url);                   // БЕЗ авторизации
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, 'файл не пустой');
});

test('маленькая картинка 300×200 → только thumb (без дублей размеров)', async () => {
    const res = await upload('OwnerA', clubs.a._id, await png(300, 200));
    assert.equal(res.status, 201);
    const m = res.data.data;
    assert.ok(m.variants.thumb, 'thumb есть');
    assert.ok(!m.variants.medium && !m.variants.large, 'medium/large не создаются для мелкой картинки');
    assert.equal(m.variants.thumb.width, 300);
});

test('список скоупится по клубу: клуб B не видит медиа клуба A', async () => {
    const a = await call('GET', '/site/media', 'OwnerA', clubs.a._id);
    assert.equal(a.status, 200);
    assert.ok(a.data.data.length >= 3, 'в клубе A накопились загрузки');
    const b = await call('GET', '/site/media', 'OwnerB', clubs.b._id);
    assert.equal(b.status, 200);
    assert.equal(b.data.data.length, 0, 'в клубе B пусто');
});

test('изоляция удаления: владелец клуба B не удалит медиа клуба A (404)', async () => {
    const up = await upload('OwnerA', clubs.a._id, await png(500, 500));
    const id = up.data.data.id;
    const res = await call('DELETE', `/site/media/${id}`, 'OwnerB', clubs.b._id);
    assert.equal(res.status, 404);
    assert.equal(res.data.code, 'MEDIA_NOT_FOUND');
    // Запись клуба A на месте
    const still = await models.MediaAsset.findById(id).lean();
    assert.ok(still, 'медиа клуба A не удалено чужим клубом');
});

test('роль: ученик клуба не может загружать (403 NOT_CLUB_STAFF)', async () => {
    const res = await upload('StudentA', clubs.a._id, await png(600, 400));
    assert.equal(res.status, 403);
    assert.equal(res.data.code, 'NOT_CLUB_STAFF');
});

test('удаление владельцем: запись и файл исчезают (файл больше не отдаётся)', async () => {
    const up = await upload('OwnerA', clubs.a._id, await png(700, 500));
    const id = up.data.data.id;
    const url = up.data.data.url;

    const del = await call('DELETE', `/site/media/${id}`, 'OwnerA', clubs.a._id);
    assert.equal(del.status, 200);
    assert.equal(del.data.data.deleted, true);

    assert.equal(await models.MediaAsset.findById(id).lean(), null, 'запись удалена');
    const file = await fetch(ROOT + url);
    assert.equal(file.status, 404, 'файл больше не отдаётся');
});

test('валидация: загрузка без файла → 422 FILE_REQUIRED', async () => {
    const res = await upload('OwnerA', clubs.a._id, null, { withFile: false, alt: 'no file' });
    assert.equal(res.status, 422);
    assert.equal(res.data.code, 'FILE_REQUIRED');
});
