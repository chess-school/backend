// Integration: оцифрованная книга -> задачник (PuzzleBook) -> задачи раздела «Задачи» (Puzzle).
// Настоящие роуты /api/v2 (authV2 по БД, роли, валидация) на in-memory MongoDB;
// микросервис оцифровки заменён HTTP-заглушкой, отдающей PGN-фикстуру из tests/fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'integration-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

const FIXTURE = fs.readFileSync(path.join(__dirname, '../fixtures/digitized_book.pgn'), 'utf8');
const TASK_ID = 'a'.repeat(32);

let mongo, api, digitizer, API, models, coach, student;

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const call = async (method, url, token, body) => {
    const res = await fetch(API + url, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
};

test.before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    // Заглушка chess_pdf_digitizer: одна завершённая задача с одной главой
    digitizer = http.createServer((req, res) => {
        if (req.url === `/api/v1/tasks/${TASK_ID}`) {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({
                task_id: TASK_ID, status: 'completed', progress_percent: 100, current_page: 5, total_pages: 5,
                positions: 6, processed_positions_count: 6, files: ['book_part_1.pgn'],
                ready_chapters: [{ filename: 'book_part_1.pgn', first_page: 39, last_page: 104, positions: 6 }],
            }));
        }
        if (req.url === `/api/v1/tasks/${TASK_ID}/download/book_part_1.pgn`) {
            res.writeHead(200, { 'content-type': 'application/x-chess-pgn' });
            return res.end(FIXTURE);
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"detail":"not found"}');
    });
    process.env.DIGITIZER_URL = `http://127.0.0.1:${await listen(digitizer)}`;

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.t = (k) => k; next(); });
    app.use('/api/v2', require('../../v2/routes'));
    app.use('/api/v2', require('../../v2/middleware/errorHandlerV2').middleware);
    api = http.createServer(app);
    API = `http://127.0.0.1:${await listen(api)}/api/v2`;

    models = {
        User: require('../../v2/models/User'),
        Coach: require('../../v2/models/Coach'),
        Puzzle: require('../../v2/models/Puzzle'),
        PuzzleBook: require('../../v2/models/PuzzleBook'),
    };
    await Promise.all(Object.values(models).map((m) => m.syncIndexes()));

    const mk = async (email, roles) => {
        const u = await models.User.create({ firstName: 'T', lastName: 'U', email, password: 'secret123', roles, sessionTokenVersion: 1 });
        return { u, token: jwt.sign({ id: u._id, roles, sessionTokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
    };
    coach = await mk('coach@school.io', ['USER', 'COACH']);
    student = await mk('student@school.io', ['USER']);
    await models.Coach.create({ user: coach.u._id });

    // Задача из базы Lichess (без source) — для проверки фильтров
    await models.Puzzle.create({ _id: 'lichess-1', fen: 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24', moves: ['f2g3', 'e6e7'], rating: 1300, themes: ['mate'] });
});

test.after(async () => {
    api && api.close();
    digitizer && digitizer.close();
    await mongoose.disconnect();
    await mongo.stop();
});

let bookId;

test('создание курса из оцифровки регистрирует упражнения с решением как задачи', async () => {
    const r = await call('POST', `/digitizer/tasks/${TASK_ID}/course`, coach.token, { title: 'Tal: 300 exercises' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    bookId = r.data.data._id;
    assert.equal(r.data.data.exercisesCount, 6);
    // Exercise 1 — без решения, Exercise 999 — с нелегальным ходом: задачами не становятся
    assert.deepEqual(r.data.data.puzzles, { published: 4, skipped: 2 });

    const puzzles = await models.Puzzle.find({ 'source.book': bookId }).sort({ 'source.exerciseNumber': 1 }).lean();
    assert.deepEqual(puzzles.map((p) => p.source.exerciseNumber), [130, 131, 132, 133]);
    const ex130 = puzzles[0];
    assert.equal(ex130.fen, '2rr2k1/pbqnbppp/1p3n2/2pp4/3P4/1PNBPN2/PB2QPPP/2RR2K1 w - - 0 14');
    assert.equal(ex130.moves[0], 'd3f5');
    assert.deepEqual(ex130.source.solutionSan.slice(0, 4), ['Bf5', 'g6', 'Bh3', 'Ra8']);
    assert.equal(ex130.source.sideToMove, 'w');
    assert.deepEqual(ex130.themes, ['fromBook', 'whiteToMove']);
    assert.equal(ex130.source.title, 'Exercise 130');
    assert.equal(ex130.source.published, false);
    assert.equal(puzzles[1].source.sideToMove, 'b');
});

test('повторная синхронизация не дублирует задачи', async () => {
    const r = await call('POST', `/digitizer/tasks/${TASK_ID}/course`, coach.token, {});
    assert.equal(r.status, 200);
    assert.equal(await models.Puzzle.countDocuments({ 'source.book': bookId }), 4);
});

test('задачи неопубликованной книги не видны в потоке «Задачи»', async () => {
    const r = await call('GET', '/puzzles/random?source=book', student.token);
    assert.equal(r.status, 404);
    assert.equal(r.data.code, 'PUZZLE_NOT_FOUND');
});

test('после публикации книги её задачи выдаются по фильтру source=book', async () => {
    const pub = await call('PATCH', `/puzzle-books/${bookId}`, coach.token, { status: 'published' });
    assert.equal(pub.status, 200);
    const seen = new Set();
    for (let i = 0; i < 25; i++) {
        const r = await call('GET', '/puzzles/random?source=book', student.token);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(r.data.data.source.kind, 'book');
        assert.equal(r.data.data.startsWithOpponentMove, false);
        assert.equal(r.data.data.source.bookTitle, 'Tal: 300 exercises');
        seen.add(r.data.data.source.exerciseNumber);
    }
    assert.ok([...seen].every((n) => [130, 131, 132, 133].includes(n)));
    assert.ok(seen.size > 1, 'random should vary');
});

test('фильтры источника: lichess, bookId, exclude, рейтинг необязателен', async () => {
    let r = await call('GET', '/puzzles/random?source=lichess', student.token);
    assert.equal(r.data.data._id, 'lichess-1');
    assert.equal(r.data.data.startsWithOpponentMove, true);
    assert.equal(r.data.data.source.kind, 'lichess');

    r = await call('GET', `/puzzles/random?bookId=${bookId}`, student.token);
    assert.equal(r.data.data.source.kind, 'book');
    assert.equal(r.data.total, 4);

    // Без параметров — только Lichess (раньше без minRating был 400): старые режимы ждут ход соперника первым
    r = await call('GET', '/puzzles/random', student.token);
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 1);
    assert.equal(r.data.data.startsWithOpponentMove, true);

    r = await call('GET', '/puzzles/random?source=all', student.token);
    assert.equal(r.data.total, 5);

    // Рейтинговое окно режимов «Рейтинг»/«Выживание» вокруг 1500 не подмешивает книжные задачи
    r = await call('GET', '/puzzles/random?minRating=1450&maxRating=1550', student.token);
    assert.equal(r.status, 404);

    // Рейтинговое окно не действует на книжные задачи (режимы «Рейтинг»/«Выживание» с источником «книги»)
    r = await call('GET', '/puzzles/random?source=book&minRating=800&maxRating=900', student.token);
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 4);

    // «Все» + окно: окно фильтрует Lichess (1300 вне 800–900), книжные проходят
    r = await call('GET', '/puzzles/random?source=all&minRating=800&maxRating=900', student.token);
    assert.equal(r.data.total, 4);
    r = await call('GET', '/puzzles/random?source=all&minRating=1250&maxRating=1350', student.token);
    assert.equal(r.data.total, 5);

    // Фильтр по теме: темы Lichess и теги книжных задач
    r = await call('GET', '/puzzles/random?theme=mate', student.token);
    assert.equal(r.data.data._id, 'lichess-1');
    // В фикстуре ход чёрных в упражнениях 131 и 133
    for (let i = 0; i < 6; i++) {
        r = await call('GET', '/puzzles/random?source=all&theme=blackToMove', student.token);
        assert.equal(r.data.total, 2);
        assert.equal(r.data.data.source.sideToMove, 'b');
        assert.ok([131, 133].includes(r.data.data.source.exerciseNumber));
    }

    r = await call('GET', '/puzzles/random?source=lichess&exclude=lichess-1', student.token);
    assert.equal(r.status, 404);

    r = await call('GET', '/puzzles/random?source=bogus&bookId=x', student.token);
    assert.equal(r.status, 422);
});

test('правка решения в редакторе обновляет задачу; удаление решения снимает её', async () => {
    const book = await models.PuzzleBook.findById(bookId).lean();
    const ex131 = book.exercises.find((e) => e.number === 131);
    const url = `/puzzle-books/${bookId}/exercises/${ex131._id}`;

    let r = await call('PUT', url, coach.token, { solution: '15... Nxb6 16. Bxb6 Qd7 17. c4' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.puzzle.published, true);
    let puzzle = await models.Puzzle.findById(`book-${ex131._id}`).lean();
    assert.deepEqual(puzzle.source.solutionSan, ['Nxb6', 'Bxb6', 'Qd7', 'c4']);
    assert.equal(puzzle.moves[0], 'd7b6');

    r = await call('PUT', url, coach.token, { solution: '' });
    assert.equal(r.data.puzzle.published, false);
    assert.equal(r.data.puzzle.reason, 'no_solution');
    assert.equal(await models.Puzzle.exists({ _id: `book-${ex131._id}` }), null);
});

test('сервер отклоняет нелегальное решение и битый FEN (422), задача не портится', async () => {
    const book = await models.PuzzleBook.findById(bookId).lean();
    const ex130 = book.exercises.find((e) => e.number === 130);
    const url = `/puzzle-books/${bookId}/exercises/${ex130._id}`;

    let r = await call('PUT', url, coach.token, { solution: '14. Qh8' });
    assert.equal(r.status, 422);
    assert.equal(r.data.details[0].field, 'solution');

    r = await call('PUT', url, coach.token, { fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    assert.equal(r.status, 422);
    assert.equal(r.data.details[0].field, 'fen');

    const puzzle = await models.Puzzle.findById(`book-${ex130._id}`).lean();
    assert.equal(puzzle.moves[0], 'd3f5');
});

test('снятие книги с публикации убирает её задачи из потока', async () => {
    await call('PATCH', `/puzzle-books/${bookId}`, coach.token, { status: 'draft' });
    const r = await call('GET', '/puzzles/random?source=book', student.token);
    assert.equal(r.status, 404);
    const all = await call('GET', '/puzzles/random?source=all', student.token);
    assert.equal(all.data.total, 1, 'only the lichess puzzle stays visible');
});
