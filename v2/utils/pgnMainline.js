// v2/utils/pgnMainline.js
//
// Главная линия эталонного решения из PGN-movetext упражнения: варианты в (...), {комментарии},
// NAG ($1), номера ходов и результат отбрасываются; каждый ход проверяется chess.js на легальность.
// Это та же логика, что у фронтенда (features/Digitizer/utils/pgnTree.ts -> getMainline), но без дерева.

const { Chess } = require('chess.js');

const RESULT = /^(\*|1-0|0-1|1\/2-1\/2)$/;

/** Токены главной линии: SAN без аннотаций, всё внутри скобок и фигурных скобок пропущено */
const mainlineTokens = (movetext) => {
    const tokens = [];
    let depth = 0;
    let i = 0;
    while (i < movetext.length) {
        const ch = movetext[i];
        if (ch === '{') {
            const end = movetext.indexOf('}', i + 1);
            i = end === -1 ? movetext.length : end + 1;
            continue;
        }
        if (ch === ';') {
            const end = movetext.indexOf('\n', i);
            i = end === -1 ? movetext.length : end + 1;
            continue;
        }
        if (ch === '(') { depth++; i++; continue; }
        if (ch === ')') { depth = Math.max(0, depth - 1); i++; continue; }
        if (/\s/.test(ch)) { i++; continue; }

        const word = /^[^\s{}();]+/.exec(movetext.slice(i))[0];
        i += word.length;
        if (depth > 0 || /^\$\d+$/.test(word) || RESULT.test(word)) continue;
        const san = word.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
        if (san && !/^\d+$/.test(san) && !/^[!?]+$/.test(san)) tokens.push(san);
    }
    return tokens;
};

const toUci = (move) => `${move.from}${move.to}${move.promotion || ''}`;

/**
 * @returns {{ san: string[], uci: string[], sideToMove: 'w'|'b', error?: string }}
 *   error — первая проблема (битый FEN, нелегальный ход); san/uci содержат ходы до неё.
 */
const parseMainline = (fen, movetext = '') => {
    let game;
    try {
        game = new Chess(fen);
    } catch (e) {
        return { san: [], uci: [], sideToMove: 'w', error: `Invalid FEN: ${e.message}` };
    }
    const sideToMove = game.turn();
    const san = [];
    const uci = [];
    for (const token of mainlineTokens(movetext)) {
        let move = null;
        try {
            move = game.move(token);
        } catch {
            move = null;
        }
        if (!move) return { san, uci, sideToMove, error: `Illegal move "${token}" after ${san.length} half-move(s)` };
        san.push(move.san);
        uci.push(toUci(move));
    }
    return { san, uci, sideToMove };
};

module.exports = { parseMainline, mainlineTokens };
