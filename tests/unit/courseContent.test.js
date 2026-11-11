'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CONTENT_VERSION,
    isNewContent,
    validateCourseContent,
    normalizeCourseContent,
} = require('../../v2/domain/courseContent');

// --------------------------------------------------------------- isNewContent

test('isNewContent: распознаёт новый формат и отличает легаси', () => {
    assert.equal(isNewContent({ version: 1, chapters: [] }), true);
    assert.equal(isNewContent({ chapters: [] }), true);
    assert.equal(isNewContent([{ title: 'Модуль', lessons: [] }]), false); // легаси-массив
    assert.equal(isNewContent(null), false);
    assert.equal(isNewContent(undefined), false);
});

// --------------------------------------------------------------- validateCourseContent (happy path)

test('validateCourseContent: валидная глава с text|puzzle|game → канон, id проставлены, version выставлен', () => {
    const input = {
        version: 1,
        chapters: [{
            title: '  Вилки  ',
            description: 'Глава про вилки',
            blocks: [
                { type: 'text', title: 'Теория', body: 'Вилка — двойной удар.' },
                {
                    type: 'puzzle', source: 'pdf', puzzles: [
                        { kind: 'inline', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', solution: '1. Ka2', title: 'Задача 1', comment: 'c', hint: 'h', rating: 1400 },
                    ],
                },
                { type: 'game', pgn: '1. e4 e5 2. Nf3', study: 'free', orientation: 'white' },
            ],
        }],
    };
    const r = validateCourseContent(input);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(r.value.version, CONTENT_VERSION);
    assert.equal(r.value.chapters.length, 1);
    const ch = r.value.chapters[0];
    assert.equal(ch.title, 'Вилки'); // обрезан пробел
    assert.ok(typeof ch.id === 'string' && ch.id.length > 0);
    assert.equal(ch.blocks.length, 3);
    for (const b of ch.blocks) assert.ok(typeof b.id === 'string' && b.id.length > 0);
    assert.equal(ch.blocks[1].puzzles[0].fen, '8/8/8/8/8/8/8/K6k w - - 0 1');
    assert.equal(ch.blocks[1].puzzles[0].rating, 1400);
    assert.equal(ch.blocks[2].study, 'free');
});

test('validateCourseContent: принимает голый массив глав (лениво)', () => {
    const r = validateCourseContent([{ title: 'Гл', blocks: [{ type: 'text', body: 'x' }] }]);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(r.value.chapters[0].title, 'Гл');
});

test('validateCourseContent: game study по умолчанию free, невалидный orientation отбрасывается', () => {
    const r = validateCourseContent([{ title: 'Г', blocks: [{ type: 'game', pgn: '1. e4', study: 'bogus', orientation: 'sideways' }] }]);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(r.value.chapters[0].blocks[0].study, 'free');
    assert.equal(r.value.chapters[0].blocks[0].orientation, undefined);
});

// --------------------------------------------------------------- validateCourseContent (отказы)

test('validateCourseContent: глава без заголовка → ошибка', () => {
    const r = validateCourseContent([{ title: '   ', blocks: [] }]);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /title/);
});

test('validateCourseContent: неподдерживаемый тип блока → ошибка', () => {
    const r = validateCourseContent([{ title: 'Г', blocks: [{ type: 'blindfold', body: 'x' }] }]);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /blindfold|неподдерж/);
});

test('validateCourseContent: puzzle без fen и пустой puzzle-блок → ошибки', () => {
    const noFen = validateCourseContent([{ title: 'Г', blocks: [{ type: 'puzzle', source: 'manual', puzzles: [{ kind: 'inline', solution: '1. e4' }] }] }]);
    assert.equal(noFen.ok, false);
    assert.match(noFen.errors.join(' '), /fen/);

    const empty = validateCourseContent([{ title: 'Г', blocks: [{ type: 'puzzle', source: 'manual', puzzles: [] }] }]);
    assert.equal(empty.ok, false);
    assert.match(empty.errors.join(' '), /хотя бы одна|puzzle/);
});

test('validateCourseContent: game без pgn → ошибка', () => {
    const r = validateCourseContent([{ title: 'Г', blocks: [{ type: 'game', pgn: '   ' }] }]);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /pgn/);
});

test('validateCourseContent: puzzle-ссылка на базу (kind=ref) валидна', () => {
    const r = validateCourseContent([{ title: 'Г', blocks: [{ type: 'puzzle', source: 'base', puzzles: [{ kind: 'ref', puzzleId: 'abc123' }] }] }]);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(r.value.chapters[0].blocks[0].puzzles[0].puzzleId, 'abc123');
});

test('validateCourseContent: не-объект на входе → ошибка', () => {
    const r = validateCourseContent('nonsense');
    assert.equal(r.ok, false);
});

// --------------------------------------------------------------- normalizeCourseContent

test('normalizeCourseContent: легаси-модули {lessons} → главы с текстовыми блоками', () => {
    const legacy = [
        { title: 'Модуль 1', description: 'd', lessons: [
            { title: 'Урок 1', contentType: 'text', content: { textBody: 'Привет' } },
            { title: 'Видео', contentType: 'video', content: { videoUrl: 'https://youtu.be/x' } },
        ] },
    ];
    const out = normalizeCourseContent(legacy);
    assert.equal(out.version, CONTENT_VERSION);
    assert.equal(out.chapters.length, 1);
    assert.equal(out.chapters[0].title, 'Модуль 1');
    assert.equal(out.chapters[0].blocks.length, 2);
    assert.equal(out.chapters[0].blocks[0].type, 'text');
    assert.equal(out.chapters[0].blocks[0].body, 'Привет');
    assert.equal(out.chapters[0].blocks[1].body, '[video](https://youtu.be/x)'); // видео → markdown-ссылка
});

test('normalizeCourseContent: новый формат проходит насквозь (с проставлением id)', () => {
    const neu = { version: 1, chapters: [{ title: 'Г', blocks: [{ type: 'text', body: 'x' }] }] };
    const out = normalizeCourseContent(neu);
    assert.equal(out.chapters.length, 1);
    assert.ok(out.chapters[0].blocks[0].id);
});

test('normalizeCourseContent: null/мусор → пустой контент', () => {
    assert.deepEqual(normalizeCourseContent(null), { version: CONTENT_VERSION, chapters: [] });
    assert.deepEqual(normalizeCourseContent(42), { version: CONTENT_VERSION, chapters: [] });
});
