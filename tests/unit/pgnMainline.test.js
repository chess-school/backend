// Unit: главная линия решения из PGN-movetext (v2/utils/pgnMainline.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMainline, mainlineTokens } = require('../../v2/utils/pgnMainline');

// Упражнение 130 из оцифрованной книги: варианты, вложенные варианты, NAG, комментарии
const EX130_FEN = '2rr2k1/pbqnbppp/1p3n2/2pp4/3P4/1PNBPN2/PB2QPPP/2RR2K1 w - - 0 14';
const EX130 = '14. Bf5 $1 { Activating the bishop } 14... g6 15. Bh3 Ra8 { Moving out of the pin } '
    + '( 15... Ne4 { runs into: } 16. Nxe4 $1 16... dxe4 17. Nd2 $1 ( 17. Ne5 $2 Nxe5 $1 18. Bxc8 Nd3 $10 ) 17... Bf6 18. Ba3 ) '
    + '16. Ne5 ( 16. Ba1 $5 { was interesting } ) 16... Nxe5 17. dxe5 Ne4 18. Nxe4 dxe4 19. e6 *';

test('главная линия без вариантов, комментариев и NAG', () => {
    const line = parseMainline(EX130_FEN, EX130);
    assert.equal(line.error, undefined);
    assert.deepEqual(line.san, ['Bf5', 'g6', 'Bh3', 'Ra8', 'Ne5', 'Nxe5', 'dxe5', 'Ne4', 'Nxe4', 'dxe4', 'e6']);
    assert.equal(line.uci[0], 'd3f5');
    assert.equal(line.uci.length, 11);
    assert.equal(line.sideToMove, 'w');
});

test('очередь хода чёрных и ход в формате «15...»', () => {
    const line = parseMainline('4rrk1/1pqnbppp/pNbpp3/P7/4P3/4B1P1/1PP2PBP/R2QR1K1 b - - 0 15', '15... f5 $1 ( 15... Nxb6 ) 16. Nxd7 Qxd7');
    assert.equal(line.sideToMove, 'b');
    assert.deepEqual(line.san, ['f5', 'Nxd7', 'Qxd7']);
    assert.deepEqual(line.uci, ['f7f5', 'b6d7', 'c7d7']);
});

test('аннотации !, ?, !? после хода и отдельно', () => {
    const line = parseMainline('8/8/8/8/8/8/8/K6k w - - 0 1', '1. Kb2!? Kg2 ? 2. Kc3!');
    assert.deepEqual(line.san, ['Kb2', 'Kg2', 'Kc3']);
});

test('превращение пешки попадает в UCI', () => {
    const line = parseMainline('8/P6k/8/8/8/8/8/K7 w - - 0 1', '1. a8=Q');
    assert.deepEqual(line.uci, ['a7a8q']);
});

test('нелегальный ход: ошибка и ходы до неё', () => {
    const line = parseMainline('8/8/8/8/8/8/8/K6k w - - 0 1', '1. Kb2 Kxa1 2. Kc3');
    assert.match(line.error, /Illegal move "Kxa1"/);
    assert.deepEqual(line.san, ['Kb2']);
});

test('битый FEN', () => {
    const line = parseMainline('not a fen', '1. e4');
    assert.match(line.error, /Invalid FEN/);
});

test('пустое решение — пустая линия без ошибки', () => {
    assert.deepEqual(parseMainline('8/8/8/8/8/8/8/K6k w - - 0 1', '').san, []);
    assert.deepEqual(mainlineTokens('{ only a comment } *'), []);
});
