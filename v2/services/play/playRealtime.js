// v2/services/play/playRealtime.js — рассылка событий онлайн-партий через socket.io namespace /play.
// Комнаты: game:<id> — игроки и зрители партии, user:<id> — все вкладки пользователя.

let nsp = null;

const gameRoom = (id) => `game:${id}`;
const userRoom = (id) => `user:${id}`;

const setPlayNamespace = (namespace) => { nsp = namespace; };
const emitToGame = (gameId, event, payload) => { if (nsp) nsp.to(gameRoom(gameId)).emit(event, payload); };
const emitToUser = (userId, event, payload) => { if (nsp) nsp.to(userRoom(userId)).emit(event, payload); };

module.exports = { setPlayNamespace, emitToGame, emitToUser, gameRoom, userRoom };
