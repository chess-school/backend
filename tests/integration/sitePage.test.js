// Integration: страницы сайта клуба из блоков (#7, шаг 3) — /api/v2/site/pages.
// Проверяем: публичную отдачу только опубликованных страниц, санитайз блоков (срезка HTML/скриптов,
// выброс неизвестных типов, парсинг видео youtube/vimeo), версионирование и статус draft при сохранении,
// изоляцию между клубами (клуб B не видит страниц клуба A), роли (ученик/тренер не пишут — только owner),
// стартовый шаблон для редактора и валидацию slug.
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

// Запрос с опциональным токеном/клубом и json-телом.
const call = async (method, url, { who, clubId, body, slug } = {}) => {
    const q = slug ? `?slug=${encodeURIComponent(slug)}` : '';
    const res = await fetch(API + url + q, {
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
        SitePage: require('../../v2/models/SitePage'),
    };

    await mkUser('OwnerA', ['USER', 'COACH']);
    await mkUser('OwnerB', ['USER', 'COACH']);
    await mkUser('TrainerA', ['USER', 'COACH']);
    await mkUser('StudentA', ['USER']);

    clubs.a = await models.Club.create({ name: 'Club A', slug: 'club-a', owner: users.OwnerA.u._id });
    clubs.b = await models.Club.create({ name: 'Club B', slug: 'club-b', owner: users.OwnerB.u._id });
    await models.ClubMembership.create({ club: clubs.a._id, user: users.OwnerA.u._id, role: 'owner', status: 'active' });
    await models.ClubMembership.create({ club: clubs.b._id, user: users.OwnerB.u._id, role: 'owner', status: 'active' });
    await models.ClubMembership.create({ club: clubs.a._id, user: users.TrainerA.u._id, role: 'trainer', status: 'active' });
    await models.ClubMembership.create({ club: clubs.a._id, user: users.StudentA.u._id, role: 'student', status: 'active' });
});

test.after(async () => {
    await mongoose.disconnect();
    if (server) await new Promise((r) => server.close(r));
    if (mongo) await mongo.stop();
});

test('публично: нет опубликованной страницы → 404 PAGE_NOT_FOUND', async () => {
    const r = await call('GET', '/site/pages/home', { slug: 'club-a' });
    assert.equal(r.status, 404);
    assert.equal(r.data.code, 'PAGE_NOT_FOUND');
});

test('редактор без страницы получает стартовый шаблон (isNew=true)', async () => {
    const r = await call('GET', '/site/pages/admin/about', { who: 'OwnerA', clubId: clubs.a._id });
    assert.equal(r.status, 200);
    assert.equal(r.data.data.isNew, true);
    assert.ok(r.data.data.page.blocks.length > 0, 'шаблон непустой');
    assert.equal(r.data.data.page.blocks[0].type, 'heading');
});

test('owner сохраняет черновик: HTML/скрипты срезаны, мусорные блоки выброшены, видео распознано', async () => {
    const payload = {
        title: '  Главная  ',
        blocks: [
            { type: 'heading', props: { text: { en: 'Welcome <script>alert(1)</script>', pl: 'Witaj', uk: 'Вітаємо' }, level: 1, align: 'center' } },
            { type: 'text', props: { text: { en: 'Line with <b>bold</b> and <img src=x onerror=hack>' } } },
            { type: 'video', props: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
            { type: 'video', props: { url: 'https://evil.example.com/clip' } },   // не youtube/vimeo → выброс
            { type: 'evilhtml', props: { html: '<script>steal()</script>' } },     // неизвестный тип → выброс
            { type: 'divider', props: {} },
        ],
    };
    const r = await call('PUT', '/site/pages/home', { who: 'OwnerA', clubId: clubs.a._id, body: payload });
    assert.equal(r.status, 200);
    const page = r.data.data.page;
    assert.equal(page.status, 'draft', 'сохранение уводит в черновик');
    assert.equal(page.version, 1);
    assert.equal(page.title, 'Главная', 'title обрезан');

    // Остались только валидные блоки: heading, text, video(youtube), divider.
    assert.deepEqual(page.blocks.map((b) => b.type), ['heading', 'text', 'video', 'divider']);

    const heading = page.blocks[0];
    assert.ok(!/[<>]/.test(heading.props.text.en), 'в заголовке нет угловых скобок');
    assert.ok(!heading.props.text.en.includes('script'), 'тег script удалён');

    const txt = page.blocks[1];
    assert.ok(!/[<>]/.test(txt.props.text.en), 'в тексте нет HTML');
    assert.ok(!/onerror/.test(txt.props.text.en), 'нет onerror-инъекции');

    const video = page.blocks[2];
    assert.equal(video.props.provider, 'youtube');
    assert.equal(video.props.videoId, 'dQw4w9WgXcQ');
});

test('публикация делает страницу видимой публично, версия растёт при повторном сохранении', async () => {
    // Публикуем ранее сохранённый черновик home.
    const pub = await call('POST', '/site/pages/home/publish', { who: 'OwnerA', clubId: clubs.a._id });
    assert.equal(pub.status, 200);
    assert.equal(pub.data.data.page.status, 'published');

    const pubView = await call('GET', '/site/pages/home', { slug: 'club-a' });
    assert.equal(pubView.status, 200);
    assert.equal(pubView.data.data.slug, 'home');
    assert.ok(pubView.data.data.blocks.length >= 3);

    // Повторное сохранение инкрементит версию (и снова уводит в draft — но публичная копия уже отдана).
    const again = await call('PUT', '/site/pages/home', { who: 'OwnerA', clubId: clubs.a._id, body: { blocks: [{ type: 'divider', props: {} }] } });
    assert.equal(again.data.data.page.version, 2);
    assert.equal(again.data.data.page.status, 'draft');
});

test('черновик НЕ снимает страницу с публикации: публичная версия остаётся прежней до Publish', async () => {
    // На этом шаге home опубликована (≥3 блока), а сверху лежит черновик из одного divider (из теста выше).
    const pubBefore = await call('GET', '/site/pages/home', { slug: 'club-a' });
    assert.equal(pubBefore.status, 200);
    assert.ok(pubBefore.data.data.blocks.length >= 3, 'публичная версия — опубликованный снимок, не черновик');
    assert.notDeepEqual(pubBefore.data.data.blocks.map((b) => b.type), ['divider'], 'это не черновик');

    // Редактор видит ЧЕРНОВИК (divider) и статус draft.
    const admin = await call('GET', '/site/pages/admin/home', { who: 'OwnerA', clubId: clubs.a._id });
    assert.equal(admin.data.data.page.status, 'draft');
    assert.deepEqual(admin.data.data.page.blocks.map((b) => b.type), ['divider']);

    // После Publish публичная версия становится черновиком, а черновик очищается.
    await call('POST', '/site/pages/home/publish', { who: 'OwnerA', clubId: clubs.a._id });
    const pubAfter = await call('GET', '/site/pages/home', { slug: 'club-a' });
    assert.deepEqual(pubAfter.data.data.blocks.map((b) => b.type), ['divider']);
    const adminAfter = await call('GET', '/site/pages/admin/home', { who: 'OwnerA', clubId: clubs.a._id });
    assert.equal(adminAfter.data.data.page.status, 'published', 'после публикации несохранённого черновика нет');
});

test('изоляция: клуб B не видит страниц клуба A в своём списке', async () => {
    const a = await call('GET', '/site/pages', { who: 'OwnerA', clubId: clubs.a._id });
    assert.equal(a.status, 200);
    assert.ok(a.data.data.some((p) => p.slug === 'home'), 'у клуба A есть home');
    const b = await call('GET', '/site/pages', { who: 'OwnerB', clubId: clubs.b._id });
    assert.equal(b.status, 200);
    assert.equal(b.data.data.length, 0, 'у клуба B страниц нет');
});

test('роль: ученик не сохраняет (403), тренер не сохраняет (403 — только owner), тренер может читать список', async () => {
    const student = await call('PUT', '/site/pages/home', { who: 'StudentA', clubId: clubs.a._id, body: { blocks: [] } });
    assert.equal(student.status, 403);
    const trainerWrite = await call('PUT', '/site/pages/home', { who: 'TrainerA', clubId: clubs.a._id, body: { blocks: [] } });
    assert.equal(trainerWrite.status, 403);
    const trainerList = await call('GET', '/site/pages', { who: 'TrainerA', clubId: clubs.a._id });
    assert.equal(trainerList.status, 200);
});

test('валидация: битый slug страницы → 400 INVALID_ID', async () => {
    const r = await call('GET', '/site/pages/admin/not a slug!', { who: 'OwnerA', clubId: clubs.a._id });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'INVALID_ID');
});

test('удаление страницы владельцем; затем публичный запрос → 404', async () => {
    await call('PUT', '/site/pages/temp', { who: 'OwnerA', clubId: clubs.a._id, body: { blocks: [{ type: 'divider', props: {} }] } });
    await call('POST', '/site/pages/temp/publish', { who: 'OwnerA', clubId: clubs.a._id });
    const del = await call('DELETE', '/site/pages/temp', { who: 'OwnerA', clubId: clubs.a._id });
    assert.equal(del.status, 200);
    const gone = await call('GET', '/site/pages/temp', { slug: 'club-a' });
    assert.equal(gone.status, 404);
});
