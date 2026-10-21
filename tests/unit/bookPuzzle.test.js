// Unit: упражнение оцифрованной книги -> документ Puzzle (v2/services/bookPuzzle.service.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { exerciseToPuzzle, puzzleIdFor, BOOK_PUZZLE_RATING } = require('../../v2/services/bookPuzzle.service');

const book = { _id: new Types.ObjectId(), title: 'Tal: 300 exercises', status: 'draft' };
const exercise = (overrides = {}) => ({
    _id: new Types.ObjectId(),
    number: 131,
    title: 'Exercise 131',
    fen: '4rrk1/1pqnbppp/pNbpp3/P7/4P3/4B1P1/1PP2PBP/R2QR1K1 b - - 0 15',
    solution: '15... f5 $1 ( 15... Nxb6 16. Bxb6 ) 16. Nxd7 Qxd7',
    ...overrides,
});

test('упражнение с решением -> задача с FEN, решением, номером и очередью хода', () => {
    const ex = exercise();
    const { puzzle, skipped } = exerciseToPuzzle(book, ex);
    assert.equal(skipped, undefined);
    assert.equal(puzzle._id, puzzleIdFor(ex._id));
    assert.equal(puzzle.fen, ex.fen);
    assert.deepEqual(puzzle.moves, ['f7f5', 'b6d7', 'c7d7']);
    assert.equal(puzzle.rating, BOOK_PUZZLE_RATING);
    assert.deepEqual(puzzle.themes, ['fromBook', 'blackToMove']);
    assert.equal(puzzle.source.kind, 'book');
    assert.equal(puzzle.source.exerciseNumber, 131);
    assert.equal(puzzle.source.sideToMove, 'b');
    assert.deepEqual(puzzle.source.solutionSan, ['f5', 'Nxd7', 'Qxd7']);
    assert.equal(puzzle.source.bookTitle, 'Tal: 300 exercises');
});

test('черновик книги -> задача не опубликована; опубликованная книга -> опубликована', () => {
    assert.equal(exerciseToPuzzle(book, exercise()).puzzle.source.published, false);
    assert.equal(exerciseToPuzzle({ ...book, status: 'published' }, exercise()).puzzle.source.published, true);
});

test('без решения -> пропуск no_solution', () => {
    assert.deepEqual(exerciseToPuzzle(book, exercise({ solution: '' })).skipped, { reason: 'no_solution' });
    assert.deepEqual(exerciseToPuzzle(book, exercise({ solution: '{ White to move. }' })).skipped, { reason: 'no_solution' });
});

test('нелегальное решение -> пропуск invalid_solution с причиной', () => {
    const { skipped } = exerciseToPuzzle(book, exercise({ solution: '15... Qh1' }));
    assert.equal(skipped.reason, 'invalid_solution');
    assert.match(skipped.detail, /Illegal move "Qh1"/);
});

test('битый FEN -> пропуск invalid_solution', () => {
    assert.equal(exerciseToPuzzle(book, exercise({ fen: 'garbage' })).skipped.reason, 'invalid_solution');
});
