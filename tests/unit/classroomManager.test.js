// Unit: авторитетная логика живого урока (classroomManager) без БД/Redis. В некластерном режиме
// (нет REDIS_URL) состояние держится в памяти процесса, поэтому логику доски, передачи хода,
// «поднять руку» и жизненного цикла урока можно проверять прямыми вызовами, без mongo/сокетов.
// Авторизацию участника (authorize/snapshot — ходят в Group) покрывает integration-тест.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.REDIS_URL; // гарантируем in-memory режим (кластерный путь — в integration)
const m = require('../../v2/services/classroom/classroomManager');

const coach = { id: 'coach-1', roles: ['USER', 'COACH'] };
const student = { id: 'student-1', roles: ['USER'] };
const student2 = { id: 'student-2', roles: ['USER'] };
const NOW = '2026-10-21T10:00:00.000Z';

let seq = 0;
const newGroup = () => `g${++seq}`; // уникальная группа на каждый тест — состояние изолировано
const code = (expected) => (e) => e.code === expected; // матчер для assert.rejects по коду ApiError

test('доска: тренер ходит, ход валидируется chess.js; нелегальный ход, битый uci и FEN отклоняются', async () => {
    const g = newGroup();
    // Первый вход тренера инициализирует состояние: он и владелец хода, и coachUserId
    let s = await m.setBoard(g, coach, m.START_FEN);
    assert.equal(s.controllerId, coach.id);
    assert.equal(s.status, 'idle');

    s = await m.move(g, coach, 'e2e4');
    assert.equal(s.lastMove.san, 'e4');
    assert.deepEqual({ from: s.lastMove.from, to: s.lastMove.to }, { from: 'e2', to: 'e4' });
    assert.match(s.fen, /4P3.* b /, 'пешка на e4, ход перешёл к чёрным');

    await assert.rejects(m.move(g, coach, 'e2e4'), code('ILLEGAL_MOVE'), 'пешки на e2 уже нет');
    await assert.rejects(m.move(g, coach, 'e7'), code('INVALID_MOVE'), 'uci короче 4 символов');
    await assert.rejects(m.setBoard(g, coach, 'not-a-fen'), code('INVALID_FEN'));

    // Произвольная расстановка (разбор позиции) разрешена, если FEN валиден; сбрасывает ход/аннотации
    const custom = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    s = await m.setBoard(g, coach, custom);
    assert.equal(s.fen, custom);
    assert.equal(s.lastMove, null);
    assert.deepEqual(s.annotations, []);
});

test('доска: превращение пешки через uci-суффикс (e7e8q)', async () => {
    const g = newGroup();
    await m.setBoard(g, coach, '6k1/4P3/8/8/8/8/8/4K3 w - - 0 1'); // чёрный король на g8, линия e свободна
    const s = await m.move(g, coach, 'e7e8q');
    assert.equal(s.lastMove.san, 'e8=Q+'); // ферзь даёт шах королю на g8 по 8-й горизонтали
    assert.match(s.fen, /^4Q1k1/);
});

test('доска: менять может только текущий владелец хода; ученик без прав — 403 NOT_BOARD_CONTROLLER', async () => {
    const g = newGroup();
    await m.setBoard(g, coach, m.START_FEN);
    await assert.rejects(m.move(g, student, 'e2e4'), code('NOT_BOARD_CONTROLLER'));
    await assert.rejects(m.setBoard(g, student, m.START_FEN), code('NOT_BOARD_CONTROLLER'));
    await assert.rejects(m.annotate(g, student, []), code('NOT_BOARD_CONTROLLER'));
    await assert.rejects(m.resetBoard(g, student), code('NOT_BOARD_CONTROLLER'));
});

test('передача хода: тренер выдаёт контроль ученику и забирает; сам тренер управляет всегда', async () => {
    const g = newGroup();
    await m.setBoard(g, coach, m.START_FEN);

    let s = await m.grantControl(g, coach, student.id);
    assert.equal(s.controllerId, student.id);
    assert.equal((await m.move(g, student, 'e2e4')).lastMove.san, 'e4', 'ученик с контролем ходит');
    assert.ok(await m.move(g, coach, 'e7e5'), 'тренер остаётся авторитетом даже когда контроль у ученика');

    await assert.rejects(m.grantControl(g, student, student2.id), code('NOT_COACH'), 'ученик не раздаёт контроль');

    s = await m.revokeControl(g, coach);
    assert.equal(s.controllerId, coach.id);
    await assert.rejects(m.move(g, student, 'g1f3'), code('NOT_BOARD_CONTROLLER'), 'после revoke ученик снова без прав');
});

test('аннотации: массив ограничен 64 элементами, не массив трактуется как пусто', async () => {
    const g = newGroup();
    await m.setBoard(g, coach, m.START_FEN);
    const many = Array.from({ length: 100 }, (_, i) => ({ type: 'square', square: `a${i}` }));
    assert.equal((await m.annotate(g, coach, many)).annotations.length, 64);
    assert.deepEqual((await m.annotate(g, coach, 'nope')).annotations, []);
});

test('поднять руку: свою опускает любой, чужую — только тренер', async () => {
    const g = newGroup();
    await m.startLesson(g, coach, NOW); // фиксируем coachUserId = coach

    await m.raiseHand(g, student, 'Вася');
    let s = await m.raiseHand(g, student2, 'Петя');
    assert.deepEqual(s.hands, { [student.id]: 'Вася', [student2.id]: 'Петя' });

    // Ученик пытается опустить чужую руку — опускается только его собственная
    s = await m.lowerHand(g, student, student2.id);
    assert.deepEqual(s.hands, { [student2.id]: 'Петя' }, 'своя снята, чужая осталась');

    s = await m.lowerHand(g, coach, student2.id); // тренер снимает чужую
    assert.deepEqual(s.hands, {});
});

test('урок: старт/финиш только тренер; статус idle→live→ended, на финише руки опускаются', async () => {
    const g = newGroup();
    assert.equal((await m.setBoard(g, coach, m.START_FEN)).status, 'idle');

    await assert.rejects(m.startLesson(g, student, NOW), code('NOT_COACH'));
    let s = await m.startLesson(g, coach, NOW);
    assert.equal(s.status, 'live');
    assert.equal(s.startedAt, NOW);

    await m.raiseHand(g, student, 'Вася');
    await assert.rejects(m.endLesson(g, student), code('NOT_COACH'));
    s = await m.endLesson(g, coach);
    assert.equal(s.status, 'ended');
    assert.deepEqual(s.hands, {}, 'руки опускаются в конце урока');
});

test('режим решения: валидация хода по решению, авто-ответ соперника, подсказка, сброс, выход', async () => {
    const g = newGroup();
    await m.setBoard(g, coach, m.START_FEN); // фиксируем coachUserId = coach
    const line = ['e2e4', 'e7e5', 'g1f3']; // решают белые; e7e5 — авто-ответ соперника

    await assert.rejects(m.startSolve(g, student, { line, startFen: m.START_FEN, title: 'T' }, NOW), code('NOT_COACH'));
    let s = await m.startSolve(g, coach, { line, startFen: m.START_FEN, title: 'T' }, NOW);
    assert.equal(s.solve.sideToMove, 'w');
    assert.equal(s.solve.status, 'solving');
    assert.equal(m.publicSolve(s.solve).total, 3);
    assert.equal(m.publicSolve(s.solve).line, undefined, 'решение не попадает в публичную часть');

    // неверный ход — доска не двигается, растёт счётчик ошибок
    let r = await m.solveMove(g, coach, 'd2d4');
    assert.equal(r.correct, false);
    assert.equal(r.state.solve.wrong, 1);
    assert.equal(r.state.fen, m.START_FEN);

    // подсказка открывает поле «откуда» (e2)
    s = await m.solveHint(g, coach);
    assert.equal(s.solve.hintAt, 'e2');

    // верный ход — применяется + авто-ответ e7e5, индекс += 2
    r = await m.solveMove(g, coach, 'e2e4');
    assert.equal(r.correct, true);
    assert.equal(r.state.solve.index, 2);
    assert.equal(r.state.solve.hintAt, null, 'подсказка сбрасывается после хода');
    assert.equal(r.state.moves.length, 2, 'в нотацию попали ход и авто-ответ');

    // завершающий верный ход — статус solved
    r = await m.solveMove(g, coach, 'g1f3');
    assert.equal(r.state.solve.status, 'solved');

    // сброс возвращает к старту
    s = await m.solveReset(g, coach, NOW);
    assert.equal(s.fen, m.START_FEN);
    assert.equal(s.solve.index, 0);
    assert.equal(s.solve.status, 'solving');

    // выход из режима — только тренер
    await assert.rejects(m.endSolve(g, student), code('NOT_COACH'));
    s = await m.endSolve(g, coach);
    assert.equal(s.solve, null);
});
