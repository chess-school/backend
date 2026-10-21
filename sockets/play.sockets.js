// sockets/play.sockets.js
//
// Онлайн-партии в реальном времени: socket.io namespace /play на общем HTTP-сервере.
// Подключение: io('<host>/play', { auth: { token: '<JWT>' } }) — та же проверка, что у REST.
// Каждый сокет сидит в комнате user:<id>; вошедший в партию — ещё и в game:<id>.
//
// Клиент -> сервер (все с ack: { ok: true, data } | { ok: false, error: { msg, code } }):
//   join_game { gameId }            — подписка на партию (игрок или зритель), ack — полное состояние
//   leave_game { gameId }
//   make_move { gameId, uci, ply? } — ход; ply — число ходов в позиции клиента (защита от устаревшей доски)
//   offer_draw / accept_draw / decline_draw / resign / abort { gameId }
//   seek { minutes, increment, rated, ratingRange? } / cancel_seek — очередь автоподбора (matchmaking)
//   rematch { gameId }              — предложить/принять реванш
// Сервер -> клиент:
//   move { gameId, uci, san, fen, ply, clock, drawOfferBy }      — в game:<id>
//   game_over { gameId, status, winner, endReason, ratingChanges, ratings, clock, pgn }
//   draw_offer { gameId, by } / draw_declined { gameId, by }
//   game_started { gameId } / rematch_offer { gameId, newGameId, by }  — в user:<id>
//   seek_state { seeking, timeControl? }

const mongoose = require('mongoose');
const { verifyAccessToken } = require('../v2/utils/accessToken');
const { ApiError, badRequest } = require('../v2/utils/apiError');
const { getGameManager } = require('../v2/services/play');
const { setPlayNamespace, gameRoom, userRoom } = require('../v2/services/play/playRealtime');

const toAckError = (error) => {
    if (error instanceof ApiError) return { msg: error.message, code: error.code };
    console.error('Play socket error:', error);
    return { msg: 'An unexpected server error occurred.', code: 'INTERNAL_ERROR' };
};

const handle = (socket, event, fn) => {
    socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
            reply({ ok: true, data: await fn(payload || {}) });
        } catch (error) {
            reply({ ok: false, error: toAckError(error) });
        }
    });
};

const gameIdOf = (payload) => {
    const id = payload.gameId;
    if (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) throw badRequest('gameId must be a valid id.', 'INVALID_ID');
    return id;
};

/**
 * services: { manager?, matchmaking?, challenges? } — внедряются в тестах;
 * по умолчанию — общий движок процесса и сервисы лобби.
 */
const initializePlaySocket = (io, services = {}) => {
    const nsp = io.of('/play');
    setPlayNamespace(nsp);
    const manager = () => services.manager || getGameManager();
    // Лобби подключается лениво: модули лобби зависят от движка
    const matchmaking = () => services.matchmaking || require('../v2/services/play/matchmaking').getMatchmaking();
    const challenges = () => services.challenges || require('../v2/services/play/challenge.service');

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
        socket.join(userRoom(user.id));

        handle(socket, 'join_game', async (p) => {
            const gameId = gameIdOf(p);
            const state = await manager().snapshot(gameId);
            socket.join(gameRoom(gameId));
            return state;
        });
        handle(socket, 'leave_game', async (p) => { socket.leave(gameRoom(gameIdOf(p))); return { left: true }; });
        handle(socket, 'make_move', (p) => manager().move(gameIdOf(p), user.id, p.uci, p.ply));
        handle(socket, 'offer_draw', (p) => manager().offerDraw(gameIdOf(p), user.id));
        handle(socket, 'accept_draw', (p) => manager().acceptDraw(gameIdOf(p), user.id));
        handle(socket, 'decline_draw', (p) => manager().declineDraw(gameIdOf(p), user.id));
        handle(socket, 'resign', (p) => manager().resign(gameIdOf(p), user.id));
        handle(socket, 'abort', (p) => manager().abort(gameIdOf(p), user.id));

        handle(socket, 'seek', (p) => matchmaking().seek(user, socket.id, p));
        handle(socket, 'cancel_seek', async () => matchmaking().cancel(user.id));
        handle(socket, 'rematch', (p) => challenges().rematch(user, gameIdOf(p)));

        socket.on('disconnect', () => {
            // Последняя вкладка ушла — убрать из очереди автоподбора
            const room = nsp.adapter.rooms.get(userRoom(user.id));
            if (!room || room.size === 0) matchmaking().cancel(user.id);
        });
    });

    return nsp;
};

module.exports = initializePlaySocket;
