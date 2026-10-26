// v2/services/classroom/classroomManager.js
//
// «Мозг» живого урока: авторизация участника группы и авторитетное состояние учебной доски.
// Состояние держится в Redis (ключ class:group:<id>), чтобы любой воркер pm2-кластера читал
// одно и то же; в некластерном режиме (нет REDIS_URL) — в памяти процесса, как у партий.
// Рассылку между воркерами делает @socket.io/redis-adapter (подключён на уровне io).
//
// Доска — тренер-авторитет: позицию меняет текущий «владелец хода» (controllerId), по умолчанию
// тренер. Тренер может передать ход ученику (grantControl) и забрать обратно. Ходы валидируются
// chess.js, но допускается и произвольная расстановка (board:set) — для разбора позиций.

const { Chess } = require('chess.js');
const { getClient, isClustered, withRedisLock } = require('../play/redis');
const Group = require('../../models/Group');
const Schedule = require('../../models/Schedule');
const { notFound, forbidden, badRequest } = require('../../utils/apiError');

// roomId — непрозрачный ключ комнаты: для группы это её _id, для индивидуального урока — `lesson-<eventId>`.
// Только authorize знает «вид» комнаты; остальной менеджер работает с roomId как со строкой.
const LESSON_PREFIX = 'lesson-';
const roomIdForLesson = (eventId) => `${LESSON_PREFIX}${eventId}`;
const isLessonRoom = (roomId) => String(roomId).startsWith(LESSON_PREFIX);

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CLASS_KEY = (groupId) => `class:group:${groupId}`;
const STATE_TTL_S = 12 * 60 * 60; // урок живёт в Redis максимум 12 ч (страховка от утечки ключей)
const LOCK_ID = (groupId) => `class:${groupId}`; // отдельное пространство от play-локов

const mem = new Map(); // fallback для некластерного режима

const CHAT_LIMIT = 100;      // храним последние N сообщений (для вошедших позже)
const MOVES_LIMIT = 400;     // страховка от разрастания истории
const freshState = (coachUserId) => ({
    status: 'idle',          // idle | live | ended
    startedAt: null,
    fen: START_FEN,
    lastMove: null,          // { from, to, san }
    annotations: [],         // [{ type:'arrow'|'square', ... }]
    moves: [],               // нотация сыгранной на доске партии: [{ san, from, to, fen }]
    material: null,          // что сейчас разбираем: { title, subtitle } | null (видно и ученику)
    chat: [],                // последние ПУБЛИЧНЫЕ сообщения урока: [{ id, userId, name, text, at }] (личные не хранятся)
    solve: null,             // режим решения: { line:[uci], index, startFen, sideToMove, status, wrong, hintAt, title, startedAt } | null
    note: null,              // комментарий тренера классу (видно всем)
    tree: null,              // общее дерево ходов (сериализованный GameTree фронта) для анализа/нотации | null
    cursor: null,            // id текущего узла дерева
    eval: null,              // оценка движка для класса: { scoreCp? , mate? } | null
    coachUserId,
    controllerId: coachUserId, // кто сейчас может менять доску
    hands: {},               // { userId: displayName } — поднятые руки
});

// Дозаполнение полей, добавленных позже freshState — чтобы состояния, лежащие в Redis с прошлой
// версии (без moves/chat/material), не роняли мутации и корректно отдавались клиенту.
const normalize = (state) => {
    if (!state) return state;
    if (!Array.isArray(state.annotations)) state.annotations = [];
    if (!Array.isArray(state.moves)) state.moves = [];
    if (!Array.isArray(state.chat)) state.chat = [];
    if (typeof state.material === 'undefined') state.material = null;
    if (typeof state.solve === 'undefined') state.solve = null;
    if (typeof state.note === 'undefined') state.note = null;
    if (typeof state.tree === 'undefined') state.tree = null;
    if (typeof state.cursor === 'undefined') state.cursor = null;
    if (typeof state.eval === 'undefined') state.eval = null;
    return state;
};

/** Публичная часть режима решения — БЕЗ строки решения (её ученикам не отдаём, чтобы не подсматривали) */
const publicSolve = (s) => (s ? {
    index: s.index, total: s.line.length, startFen: s.startFen, sideToMove: s.sideToMove,
    status: s.status, wrong: s.wrong, hintAt: s.hintAt, title: s.title, startedAt: s.startedAt,
} : null);

/** Снимок состояния для клиента — с вырезанным решением (snapshot/join отдают это, а не сырой state) */
const publicState = (state) => ({ ...state, solve: publicSolve(state.solve) });

const loadState = async (groupId) => {
    if (isClustered()) {
        const raw = await getClient().get(CLASS_KEY(groupId));
        return raw ? normalize(JSON.parse(raw)) : null;
    }
    return normalize(mem.get(groupId) || null);
};

const saveState = async (groupId, state) => {
    if (isClustered()) {
        await getClient().set(CLASS_KEY(groupId), JSON.stringify(state), 'EX', STATE_TTL_S);
    } else {
        mem.set(groupId, state);
    }
    return state;
};

/**
 * Авторизация участника комнаты. Возвращает { role, coachUserId }.
 * Групповая комната (roomId = groupId): тренер группы / участник / ADMIN.
 * Индивидуальная (roomId = `lesson-<eventId>`): тренер события / его ученик (context.refId) / ADMIN.
 * Едино с classroom.controller.js и сокетами.
 */
const authorize = async (roomId, user) => {
    const isAdmin = Array.isArray(user.roles) && user.roles.includes('ADMIN');

    if (isLessonRoom(roomId)) {
        const eventId = String(roomId).slice(LESSON_PREFIX.length);
        const event = await Schedule.findById(eventId).select('coach context').populate('coach', 'user');
        if (!event) throw notFound('Classroom not found.', 'CLASSROOM_NOT_FOUND');
        if (!event.context || event.context.type !== 'individual') {
            throw forbidden('This classroom is not an individual lesson.', 'NOT_AN_INDIVIDUAL_LESSON');
        }
        const coachUserId = event.coach && event.coach.user ? String(event.coach.user) : null;
        const studentUserId = String(event.context.refId);
        const isCoach = coachUserId === user.id;
        const isStudent = studentUserId === user.id;
        if (!isCoach && !isStudent && !isAdmin) {
            throw forbidden('You are not a participant of this classroom.', 'NOT_A_CLASSROOM_PARTICIPANT');
        }
        return { role: isCoach || isAdmin ? 'coach' : 'student', coachUserId };
    }

    const group = await Group.findById(roomId).populate('coach', 'user').select('coach members status');
    if (!group) throw notFound('Classroom not found.', 'CLASSROOM_NOT_FOUND');
    const coachUserId = group.coach ? String(group.coach.user) : null;
    const isCoach = coachUserId === user.id;
    const isMember = group.members.some((m) => String(m) === user.id);
    if (!isCoach && !isAdmin && !isMember) {
        throw forbidden('You are not a participant of this classroom.', 'NOT_A_CLASSROOM_PARTICIPANT');
    }
    return { role: isCoach || isAdmin ? 'coach' : 'student', coachUserId };
};

/** Снапшот состояния для вошедшего. Инициализирует доску при первом входе. */
const snapshot = async (groupId, coachUserId) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        let state = await loadState(groupId);
        if (!state) state = await saveState(groupId, freshState(coachUserId));
        return state;
    });

// Авторитет тренера: роль coach — это настоящий тренер группы (coachUserId) ИЛИ админ (ведёт как тренер).
const isCoachAuthority = (state, user) =>
    state.coachUserId === user.id || (Array.isArray(user.roles) && user.roles.includes('ADMIN'));
// Доску меняет текущий владелец хода ИЛИ тренер-авторитет (тренер/админ).
const isController = (state, user) => state.controllerId === user.id || isCoachAuthority(state, user);

// --- мутации доски (только текущий владелец хода или тренер) ---

const setBoard = (groupId, user, fen) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isController(state, user)) throw forbidden('You do not control the board.', 'NOT_BOARD_CONTROLLER');
        try { new Chess(fen); } catch { throw badRequest('Invalid FEN.', 'INVALID_FEN'); }
        state.fen = fen;
        state.lastMove = null;
        state.annotations = [];
        state.moves = []; // новая позиция — новая партия, нотация начинается заново
        state.solve = null; // загрузка произвольной позиции выходит из режима решения
        state.tree = null; state.cursor = null; state.eval = null; // дерево анализа пересоберётся от новой позиции
        return saveState(groupId, state);
    });

const move = (groupId, user, uci) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isController(state, user)) throw forbidden('You do not control the board.', 'NOT_BOARD_CONTROLLER');
        if (typeof uci !== 'string' || uci.length < 4) throw badRequest('uci must be like "e2e4".', 'INVALID_MOVE');
        const chess = new Chess();
        try { chess.load(state.fen); } catch { throw badRequest('Board position is corrupt.', 'INVALID_FEN'); }
        const from = uci.slice(0, 2), to = uci.slice(2, 4), promotion = uci.slice(4, 5) || undefined;
        let made;
        try { made = chess.move({ from, to, promotion }); } catch { made = null; }
        if (!made) throw badRequest('Illegal move in current position.', 'ILLEGAL_MOVE');
        state.fen = chess.fen();
        state.lastMove = { from, to, san: made.san };
        state.annotations = []; // новый ход — старые стрелки/кружки снимаем
        state.moves.push({ san: made.san, from, to, fen: state.fen });
        if (state.moves.length > MOVES_LIMIT) state.moves = state.moves.slice(-MOVES_LIMIT);
        return saveState(groupId, state);
    });

const resetBoard = (groupId, user) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isController(state, user)) throw forbidden('You do not control the board.', 'NOT_BOARD_CONTROLLER');
        state.fen = START_FEN;
        state.lastMove = null;
        state.annotations = [];
        state.moves = [];
        state.material = null; // сброс доски — убираем и «что разбираем»
        state.solve = null;
        state.tree = null; state.cursor = null; state.eval = null;
        return saveState(groupId, state);
    });

const annotate = (groupId, user, annotations) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isController(state, user)) throw forbidden('You do not control the board.', 'NOT_BOARD_CONTROLLER');
        state.annotations = Array.isArray(annotations) ? annotations.slice(0, 64) : [];
        return saveState(groupId, state);
    });

// --- общее дерево ходов (анализ/нотация): контроллер шлёт сериализованный GameTree, сервер ретранслирует ---

const TREE_MAX_BYTES = 300 * 1024; // страховка от разрастания
const setTree = (groupId, user, payload) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isController(state, user)) throw forbidden('You do not control the board.', 'NOT_BOARD_CONTROLLER');
        const { tree, cursor, fen, lastMove } = payload || {};
        if (!tree || typeof cursor !== 'string') throw badRequest('tree and cursor are required.', 'INVALID_TREE');
        if (JSON.stringify(tree).length > TREE_MAX_BYTES) throw badRequest('Tree is too large.', 'TREE_TOO_LARGE');
        try { new Chess(fen); } catch { throw badRequest('Invalid FEN.', 'INVALID_FEN'); }
        state.tree = tree;
        state.cursor = cursor;
        state.fen = fen;
        state.lastMove = lastMove || null;
        return saveState(groupId, state);
    });

// Оценка движка для класса (тренер транслирует). ev = { scoreCp?|mate? } | null
const setEval = (groupId, user, ev) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isCoachAuthority(state, user)) throw forbidden('Only the coach can share evaluation.', 'NOT_COACH');
        if (ev == null) state.eval = null;
        else state.eval = {
            ...(typeof ev.scoreCp === 'number' ? { scoreCp: ev.scoreCp } : {}),
            ...(typeof ev.mate === 'number' ? { mate: ev.mate } : {}),
        };
        return saveState(groupId, state);
    });

// --- режим решения (Solve Mode): задача на общей доске, ходы валидируются по решению ---

const uciEq = (a, b) => a.slice(0, 4) === b.slice(0, 4) && (a[4] || '').toLowerCase() === (b[4] || '').toLowerCase();
const applyUci = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] || 'q') });

// Тренер запускает решение: line — главная линия решения в UCI от startFen (ход решающей стороны первый).
const startSolve = (groupId, user, payload, startedAt) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isCoachAuthority(state, user)) throw forbidden('Only the coach can start solving.', 'NOT_COACH');
        const { line, startFen, title, solution } = payload || {};
        if (!Array.isArray(line) || line.length === 0) throw badRequest('Solution line is required.', 'INVALID_SOLVE');
        let chess;
        try { chess = new Chess(startFen); } catch { throw badRequest('Invalid FEN.', 'INVALID_FEN'); }
        // проверяем, что линия легальна от стартовой позиции
        const verify = new Chess(startFen);
        for (const uci of line) {
            try { if (!applyUci(verify, uci)) throw new Error('illegal'); }
            catch { throw badRequest('Solution line is illegal for this position.', 'INVALID_SOLVE'); }
        }
        state.fen = startFen;
        state.lastMove = null;
        state.annotations = [];
        state.moves = [];
        state.tree = null; state.cursor = null; state.eval = null;
        state.solve = {
            line: line.map(String), index: 0, startFen, sideToMove: chess.turn(),
            status: 'solving', wrong: 0, hintAt: null, title: String(title || '').slice(0, 200), startedAt,
            solution: String(solution || '').slice(0, 4000) || null, // текст решения — ТОЛЬКО тренеру
            answers: {},            // ответы учеников: { userId: { uci, san, correct, at } }
        };
        return saveState(groupId, state);
    });

// Ход решающего: сверяем с ожидаемым. Верный — применяем + авто-ответ соперника; неверный — не трогаем доску.
const solveMove = (groupId, user, uci) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!state.solve || state.solve.status !== 'solving') throw badRequest('Not in solve mode.', 'NOT_SOLVING');
        if (!isController(state, user)) throw forbidden('You do not control the board.', 'NOT_BOARD_CONTROLLER');
        if (typeof uci !== 'string' || uci.length < 4) throw badRequest('uci must be like "e2e4".', 'INVALID_MOVE');
        const s = state.solve;
        const expected = s.line[s.index];
        if (!uciEq(uci, expected)) {
            s.wrong += 1;
            await saveState(groupId, state);
            return { correct: false, state };
        }
        const chess = new Chess(state.fen);
        let made = applyUci(chess, expected);
        s.index += 1;
        state.moves.push({ san: made.san, from: made.from, to: made.to, fen: chess.fen() });
        // авто-ответ соперника (если есть следующий ход в линии)
        if (s.index < s.line.length) {
            made = applyUci(chess, s.line[s.index]);
            s.index += 1;
            state.moves.push({ san: made.san, from: made.from, to: made.to, fen: chess.fen() });
        }
        state.fen = chess.fen();
        state.lastMove = { from: made.from, to: made.to, san: made.san };
        s.hintAt = null;
        s.answers = {}; // задача продвинулась — сбрасываем ответы учеников под следующий ход
        if (s.index >= s.line.length) s.status = 'solved';
        await saveState(groupId, state);
        return { correct: true, state };
    });

// Ученик отправляет ответ (ход) на текущую задачу — НЕ меняя общую доску. Пишем попытку по userId.
const solveAnswer = (groupId, user, uci) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!state.solve || state.solve.status !== 'solving') throw badRequest('Not in solve mode.', 'NOT_SOLVING');
        if (typeof uci !== 'string' || uci.length < 4) throw badRequest('uci must be like "e2e4".', 'INVALID_MOVE');
        const s = state.solve;
        const correct = uciEq(uci, s.line[s.index]);
        let san = null;
        try { const c = new Chess(state.fen); const m = applyUci(c, uci); if (m) san = m.san; } catch { san = null; }
        if (!s.answers) s.answers = {};
        s.answers[user.id] = { uci: String(uci), san, correct, at: new Date().toISOString() };
        await saveState(groupId, state);
        return { correct, state };
    });

const solveReset = (groupId, user, startedAt) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!state.solve) throw badRequest('Not in solve mode.', 'NOT_SOLVING');
        if (!isController(state, user)) throw forbidden('You do not control the board.', 'NOT_BOARD_CONTROLLER');
        state.fen = state.solve.startFen;
        state.lastMove = null;
        state.annotations = [];
        state.moves = [];
        state.solve = { ...state.solve, index: 0, status: 'solving', wrong: 0, hintAt: null, startedAt, answers: {} };
        return saveState(groupId, state);
    });

// Подсказка: открыть поле «откуда» следующего верного хода (сам ход не показываем)
const solveHint = (groupId, user) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!state.solve || state.solve.status !== 'solving') throw badRequest('Not in solve mode.', 'NOT_SOLVING');
        if (!isController(state, user)) throw forbidden('You do not control the board.', 'NOT_BOARD_CONTROLLER');
        const expected = state.solve.line[state.solve.index];
        state.solve.hintAt = expected ? expected.slice(0, 2) : null;
        return saveState(groupId, state);
    });

const endSolve = (groupId, user) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isCoachAuthority(state, user)) throw forbidden('Only the coach can exit solve mode.', 'NOT_COACH');
        state.solve = null;
        return saveState(groupId, state);
    });

// Линия решения в SAN (для показа тренеру)
const sanOfLine = (startFen, line) => {
    try {
        const c = new Chess(startFen);
        return (line || []).map((u) => { const m = applyUci(c, u); return m ? m.san : u; });
    } catch { return []; }
};

/** Данные режима решения ТОЛЬКО для тренера: текст решения, линия в SAN и ответы учеников. */
const coachSolve = (state) => {
    const s = state && state.solve;
    if (!s) return null;
    return { solution: s.solution || null, lineSan: sanOfLine(s.startFen, s.line), answers: s.answers || {} };
};

// --- «что разбираем» (материал урока; задаёт тренер, видит и ученик) ---

const setMaterial = (groupId, user, material) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isCoachAuthority(state, user)) throw forbidden('Only the coach can set lesson material.', 'NOT_COACH');
        if (material == null) {
            state.material = null;
        } else {
            const title = String(material.title || '').trim().slice(0, 200);
            const subtitle = String(material.subtitle || '').trim().slice(0, 200);
            state.material = title || subtitle ? { title, subtitle } : null;
        }
        return saveState(groupId, state);
    });

// --- чат урока (любой участник) ---

const CHAT_MAX_LEN = 1000;
// to — userId адресата для личного сообщения (null/undefined = всем). Личные НЕ хранятся в state.chat.
const postChat = (groupId, user, text, name, to, toName) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        const clean = String(text || '').trim().slice(0, CHAT_MAX_LEN);
        if (!clean) throw badRequest('Message is empty.', 'EMPTY_MESSAGE');
        const message = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            userId: user.id,
            name: name || 'Участник',
            text: clean,
            at: new Date().toISOString(),
            ...(to ? { to: String(to), toName: toName || '' } : {}),
        };
        if (!to) {
            state.chat.push(message);
            if (state.chat.length > CHAT_LIMIT) state.chat = state.chat.slice(-CHAT_LIMIT);
            await saveState(groupId, state);
        }
        return { message, isPrivate: !!to };
    });

// Комментарий/оценка для всего класса (режим анализа). Задаёт тренер; null — убрать.
const setNote = (groupId, user, note) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isCoachAuthority(state, user)) throw forbidden('Only the coach can set a note.', 'NOT_COACH');
        state.note = note == null || !String(note).trim() ? null : String(note).slice(0, 500);
        return saveState(groupId, state);
    });

// --- передача хода (только тренер) ---

const grantControl = (groupId, user, targetUserId) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isCoachAuthority(state, user)) throw forbidden('Only the coach can grant control.', 'NOT_COACH');
        state.controllerId = targetUserId || state.coachUserId;
        return saveState(groupId, state);
    });

const revokeControl = (groupId, user) => grantControl(groupId, user, null);

// --- «поднять руку» ---

const raiseHand = (groupId, user, displayName) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        state.hands[user.id] = displayName || 'Участник';
        return saveState(groupId, state);
    });

const lowerHand = (groupId, user, targetUserId) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        // свою руку опускает любой; чужую — только тренер/админ
        const target = targetUserId && isCoachAuthority(state, user) ? targetUserId : user.id;
        delete state.hands[target];
        return saveState(groupId, state);
    });

// --- жизненный цикл урока (только тренер) ---

const startLesson = (groupId, user, now) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isCoachAuthority(state, user)) throw forbidden('Only the coach can start the lesson.', 'NOT_COACH');
        state.status = 'live';
        state.startedAt = now;
        return saveState(groupId, state);
    });

const endLesson = (groupId, user) =>
    withRedisLock(LOCK_ID(groupId), async () => {
        const state = (await loadState(groupId)) || freshState(user.id);
        if (!isCoachAuthority(state, user)) throw forbidden('Only the coach can end the lesson.', 'NOT_COACH');
        state.status = 'ended';
        state.hands = {};
        return saveState(groupId, state);
    });

module.exports = {
    START_FEN, authorize, snapshot, publicSolve, publicState,
    setBoard, move, resetBoard, annotate,
    setTree, setEval,
    setMaterial, postChat, setNote,
    startSolve, solveMove, solveAnswer, solveReset, solveHint, endSolve, coachSolve,
    grantControl, revokeControl,
    raiseHand, lowerHand,
    startLesson, endLesson,
    roomIdForLesson, isLessonRoom,
};
