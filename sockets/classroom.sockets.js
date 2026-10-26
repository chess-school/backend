// sockets/classroom.sockets.js
//
// Интерактивный класс в реальном времени: socket.io namespace /classroom на общем HTTP-сервере.
// Подключение: io('<host>/classroom', { auth: { token: '<JWT>' } }) — та же проверка, что у REST.
// Видео/аудио/экран идут через LiveKit (см. classroom.controller.js); здесь — учебная доска,
// «поднять руку», передача хода ученику и жизненный цикл урока. Одна комната class:<groupId>.
//
// Клиент -> сервер (все с ack: { ok, data } | { ok:false, error:{ msg, code } }):
//   join_class { groupId }            — войти в урок; ack — { state, role }
//   leave_class { groupId }
//   board:set { groupId, fen }        — выставить позицию (владелец хода)
//   board:move { groupId, uci }       — сделать ход "e2e4"/"e7e8q" (владелец хода)
//   board:reset { groupId } / board:annotate { groupId, annotations }
//   material:set { groupId, material }  — что разбираем (только тренер); material=null чтобы убрать
//   chat:send { groupId, text, to? }    — сообщение в чат (to=userId → лично, иначе всем)
//   note:set { groupId, note }          — комментарий классу (тренер); note=null чтобы убрать
//   board:tree { groupId, tree, cursor, fen, lastMove } — общее дерево ходов (контроллер); нотация/варианты/навигация
//   eval:set { groupId, eval }          — оценка движка классу (тренер); eval=null убрать
//   solve:start { groupId, line, startFen, title } — режим решения (тренер); line — решение в UCI
//   solve:move { groupId, uci } — ход решающего (ack { correct }); solve:reset / solve:hint / solve:end
//   control:grant { groupId, userId } / control:revoke { groupId }   — только тренер
//   hand:raise { groupId } / hand:lower { groupId, userId? }
//   lesson:start { groupId } / lesson:end { groupId }                — только тренер
// Сервер -> клиенту (в комнату class:<groupId>):
//   board:update { fen, lastMove, annotations, moves }
//   material:update { material }
//   chat:new { message: { id, userId, name, text, at } }
//   control:update { controllerId }
//   hand:update { hands }
//   lesson:state { status, startedAt }
//   presence { participants: [{ userId, role, name }] }

const mongoose = require('mongoose');
const i18next = require('i18next');
const { verifyAccessToken } = require('../v2/utils/accessToken');
const { ApiError, badRequest } = require('../v2/utils/apiError');
const User = require('../v2/models/User');
const manager = require('../v2/services/classroom/classroomManager');
const { setClassroomNamespace, emitToClass, emitToClassCoaches, classRoom, coachRoom } = require('../v2/services/classroom/classroomRealtime');

// Переводчик сокета: язык из accept-language рукопожатия (как у REST). Если i18next ещё
// не инициализирован (например, в тестах без config/i18n), возвращаем исходный текст.
const translatorFor = (socket) => {
    const lng = socket.handshake && socket.handshake.headers && socket.handshake.headers['accept-language'];
    const fixedT = i18next.getFixedT(lng || 'en');
    return (key, defaultValue) => {
        const translated = i18next.isInitialized ? fixedT(key, { defaultValue }) : undefined;
        return translated || defaultValue;
    };
};

const toAckError = (error, t) => {
    if (error instanceof ApiError) {
        return { msg: t(`api.errors.${error.code}`, error.message), code: error.code };
    }
    console.error('Classroom socket error:', error);
    return { msg: t('api.errors.INTERNAL_ERROR', 'An unexpected server error occurred.'), code: 'INTERNAL_ERROR' };
};

const handle = (socket, event, fn) => {
    const t = translatorFor(socket);
    socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
            reply({ ok: true, data: await fn(payload || {}) });
        } catch (error) {
            reply({ ok: false, error: toAckError(error, t) });
        }
    });
};

// roomId: groupId (24-hex) ИЛИ индивидуальная комната `lesson-<eventId>` (lesson-<24-hex>)
const ROOM_ID_RE = /^(?:[a-f\d]{24}|lesson-[a-f\d]{24})$/i;
const groupIdOf = (payload) => {
    const id = payload.groupId;
    if (typeof id !== 'string' || !ROOM_ID_RE.test(id)) throw badRequest('groupId must be a valid id.', 'INVALID_ID');
    return id;
};

const boardPayload = (state) => ({
    fen: state.fen,
    lastMove: state.lastMove,
    annotations: state.annotations,
    moves: state.moves || [],
    tree: state.tree || null,     // общее дерево ходов (анализ/нотация)
    cursor: state.cursor || null,
    solve: manager.publicSolve(state.solve), // без строки решения — ученикам не показываем
});

// Список участников урока (adapter-aware: собирает сокеты со всех воркеров кластера)
const emitPresence = async (nsp, groupId) => {
    const sockets = await nsp.in(classRoom(groupId)).fetchSockets();
    const seen = new Map(); // одна запись на пользователя, даже если несколько вкладок
    for (const s of sockets) if (s.data && s.data.userId) seen.set(s.data.userId, s.data);
    emitToClass(groupId, 'presence', { participants: Array.from(seen.values()) });
};

const initializeClassroomSocket = (io) => {
    const nsp = io.of('/classroom');
    setClassroomNamespace(nsp);

    nsp.use(async (socket, next) => {
        try {
            socket.user = await verifyAccessToken(socket.handshake.auth && socket.handshake.auth.token);
            next();
        } catch (e) {
            const err = new Error(e.message || 'Unauthorized');
            err.data = { code: e.code || 'TOKEN_INVALID' };
            next(err);
        }
    });

    nsp.on('connection', (socket) => {
        const { user } = socket;

        handle(socket, 'join_class', async (p) => {
            const groupId = groupIdOf(p);
            const { role, coachUserId } = await manager.authorize(groupId, user);
            const profile = await User.findById(user.id).select('firstName lastName').lean();
            const name = profile ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Участник' : 'Участник';
            socket.data = { userId: user.id, role, name, groupId };
            socket.join(classRoom(groupId));
            const state = await manager.snapshot(groupId, coachUserId);
            await emitPresence(nsp, groupId);
            // Тренер входит в подкомнату тренеров и сразу получает решение + ответы учеников
            if (role === 'coach') {
                socket.join(coachRoom(groupId));
                socket.emit('solve:coach', manager.coachSolve(state));
            }
            return { state: manager.publicState(state), role }; // без строки решения — ученик не должен её видеть
        });

        handle(socket, 'leave_class', async (p) => {
            const groupId = groupIdOf(p);
            socket.leave(classRoom(groupId));
            await emitPresence(nsp, groupId);
            return { left: true };
        });

        handle(socket, 'board:set', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.setBoard(groupId, user, p.fen);
            emitToClass(groupId, 'board:update', boardPayload(state));
            return boardPayload(state);
        });
        handle(socket, 'board:move', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.move(groupId, user, p.uci);
            emitToClass(groupId, 'board:update', boardPayload(state));
            return boardPayload(state);
        });
        handle(socket, 'board:reset', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.resetBoard(groupId, user);
            emitToClass(groupId, 'board:update', boardPayload(state));
            return boardPayload(state);
        });
        handle(socket, 'board:annotate', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.annotate(groupId, user, p.annotations);
            emitToClass(groupId, 'board:update', boardPayload(state));
            return boardPayload(state);
        });

        handle(socket, 'solve:start', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.startSolve(groupId, user, { line: p.line, startFen: p.startFen, title: p.title, solution: p.solution }, new Date().toISOString());
            emitToClass(groupId, 'board:update', boardPayload(state));
            emitToClassCoaches(groupId, 'solve:coach', manager.coachSolve(state));
            return boardPayload(state);
        });
        handle(socket, 'solve:move', async (p) => {
            const groupId = groupIdOf(p);
            const { correct, state } = await manager.solveMove(groupId, user, p.uci);
            emitToClass(groupId, 'board:update', boardPayload(state));
            emitToClassCoaches(groupId, 'solve:coach', manager.coachSolve(state));
            return { correct, ...boardPayload(state) };
        });
        // Ученик отправляет свой ответ на задачу — доска не меняется; тренер видит ответ в панели
        handle(socket, 'solve:answer', async (p) => {
            const groupId = groupIdOf(p);
            const { correct, state } = await manager.solveAnswer(groupId, user, p.uci);
            emitToClassCoaches(groupId, 'solve:coach', manager.coachSolve(state));
            return { correct };
        });
        handle(socket, 'solve:reset', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.solveReset(groupId, user, new Date().toISOString());
            emitToClass(groupId, 'board:update', boardPayload(state));
            emitToClassCoaches(groupId, 'solve:coach', manager.coachSolve(state));
            return boardPayload(state);
        });
        handle(socket, 'solve:hint', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.solveHint(groupId, user);
            emitToClass(groupId, 'board:update', boardPayload(state));
            return boardPayload(state);
        });
        handle(socket, 'solve:end', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.endSolve(groupId, user);
            emitToClass(groupId, 'board:update', boardPayload(state));
            emitToClassCoaches(groupId, 'solve:coach', manager.coachSolve(state));
            return boardPayload(state);
        });

        handle(socket, 'material:set', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.setMaterial(groupId, user, p.material);
            emitToClass(groupId, 'material:update', { material: state.material });
            return { material: state.material };
        });

        handle(socket, 'chat:send', async (p) => {
            const groupId = groupIdOf(p);
            const name = socket.data && socket.data.name;
            const to = typeof p.to === 'string' && p.to ? p.to : null;
            // Имя адресата (для подписи «лично …») — из живых сокетов комнаты (adapter-aware)
            let toName = '';
            const roomSockets = await nsp.in(classRoom(groupId)).fetchSockets();
            if (to) {
                const rec = roomSockets.find((s) => s.data && s.data.userId === to);
                toName = (rec && rec.data && rec.data.name) || '';
            }
            const { message, isPrivate } = await manager.postChat(groupId, user, p.text, name, to, toName);
            if (!isPrivate) {
                emitToClass(groupId, 'chat:new', { message });
            } else {
                // Личное сообщение — только отправителю и адресату
                for (const s of roomSockets) {
                    if (s.data && (s.data.userId === user.id || s.data.userId === to)) s.emit('chat:new', { message });
                }
            }
            return { message };
        });

        handle(socket, 'board:tree', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.setTree(groupId, user, { tree: p.tree, cursor: p.cursor, fen: p.fen, lastMove: p.lastMove });
            emitToClass(groupId, 'board:update', boardPayload(state));
            return boardPayload(state);
        });

        handle(socket, 'eval:set', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.setEval(groupId, user, p.eval);
            emitToClass(groupId, 'eval:update', { eval: state.eval });
            return { eval: state.eval };
        });

        handle(socket, 'note:set', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.setNote(groupId, user, p.note);
            emitToClass(groupId, 'note:update', { note: state.note });
            return { note: state.note };
        });

        handle(socket, 'control:grant', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.grantControl(groupId, user, p.userId);
            emitToClass(groupId, 'control:update', { controllerId: state.controllerId });
            return { controllerId: state.controllerId };
        });
        handle(socket, 'control:revoke', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.revokeControl(groupId, user);
            emitToClass(groupId, 'control:update', { controllerId: state.controllerId });
            return { controllerId: state.controllerId };
        });

        handle(socket, 'hand:raise', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.raiseHand(groupId, user, socket.data && socket.data.name);
            emitToClass(groupId, 'hand:update', { hands: state.hands });
            return { hands: state.hands };
        });
        handle(socket, 'hand:lower', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.lowerHand(groupId, user, p.userId);
            emitToClass(groupId, 'hand:update', { hands: state.hands });
            return { hands: state.hands };
        });

        handle(socket, 'lesson:start', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.startLesson(groupId, user, new Date().toISOString());
            emitToClass(groupId, 'lesson:state', { status: state.status, startedAt: state.startedAt });
            return { status: state.status, startedAt: state.startedAt };
        });
        handle(socket, 'lesson:end', async (p) => {
            const groupId = groupIdOf(p);
            const state = await manager.endLesson(groupId, user);
            emitToClass(groupId, 'lesson:state', { status: state.status, startedAt: state.startedAt });
            emitToClass(groupId, 'hand:update', { hands: state.hands });
            return { status: state.status };
        });

        socket.on('disconnect', () => {
            const groupId = socket.data && socket.data.groupId;
            if (groupId) emitPresence(nsp, groupId).catch(() => {});
        });
    });

    return nsp;
};

module.exports = initializeClassroomSocket;
