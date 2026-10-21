// v2/services/play/index.js — общий для процесса движок партий (REST и сокеты работают с одним).

const { createGameManager } = require('./gameManager');
const { emitToGame, emitToUser } = require('./playRealtime');

let manager = null;

const getGameManager = () => {
    if (!manager) manager = createGameManager({ emitToGame, emitToUser });
    return manager;
};

/** Подменить движок (тесты) */
const setGameManager = (m) => { manager = m; };

module.exports = { getGameManager, setGameManager };
