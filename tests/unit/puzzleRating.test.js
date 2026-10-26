// Unit: Elo-калькулятор рейтинга задач (v2/utils/puzzleRatingCalculator.js) — Module 4
const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedScore, computeRatingChange, MIN_RATING } = require('../../v2/utils/puzzleRatingCalculator');

test('expectedScore: равные рейтинги → 0.5, суммарно 1', () => {
    assert.equal(expectedScore(1500, 1500), 0.5);
    const a = expectedScore(1200, 1800);
    const b = expectedScore(1800, 1200);
    assert.ok(Math.abs(a + b - 1) < 1e-9);
    assert.ok(a < 0.5 && b > 0.5);
});

test('успех при равных рейтингах: ученик +16, задача -12', () => {
    const r = computeRatingChange({ userRating: 1500, puzzleRating: 1500, success: true });
    assert.equal(r.userDelta, 16);   // 32 * (1 - 0.5)
    assert.equal(r.puzzleDelta, -12); // 24 * (0.5 - 1)
    assert.equal(r.newUserRating, 1516);
    assert.equal(r.newPuzzleRating, 1488);
});

test('неудача при равных рейтингах: ученик -16, задача +12', () => {
    const r = computeRatingChange({ userRating: 1500, puzzleRating: 1500, success: false });
    assert.equal(r.userDelta, -16);
    assert.equal(r.puzzleDelta, 12);
});

test('слабый решает сильную задачу: большой прирост ученику, задача падает', () => {
    const r = computeRatingChange({ userRating: 1200, puzzleRating: 1800, success: true });
    assert.ok(r.userDelta > 25);     // ~ +29
    assert.ok(r.puzzleDelta < -20);  // задача ощутимо дешевеет
});

test('сильный проваливает слабую задачу: ощутимый штраф', () => {
    const r = computeRatingChange({ userRating: 1800, puzzleRating: 1200, success: false });
    assert.ok(r.userDelta < -25);
    assert.ok(r.puzzleDelta > 20);
});

test('рейтинг задачи не опускается ниже пола MIN_RATING', () => {
    const r = computeRatingChange({ userRating: 2800, puzzleRating: MIN_RATING, success: true });
    assert.ok(r.newPuzzleRating >= MIN_RATING);
});

test('нечисловой входной рейтинг трактуется как 1500 (дефолт)', () => {
    const r = computeRatingChange({ userRating: undefined, puzzleRating: undefined, success: true });
    assert.equal(r.newUserRating, 1516);
    assert.equal(r.newPuzzleRating, 1488);
});
