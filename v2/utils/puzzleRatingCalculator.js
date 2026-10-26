// v2/utils/puzzleRatingCalculator.js
//
// Динамический рейтинг задач по классической формуле Elo (Module 4).
// Ученик с рейтингом R_user «играет партию» против задачи с рейтингом R_puzzle:
//   S = 1  — задача решена с 1-й попытки без подсказок (успех ученика);
//   S = 0  — ошибка или использована подсказка (успех задачи).
// Матожидание результата ученика: E_user = 1 / (1 + 10^((R_puzzle - R_user)/400)).
// Новый рейтинг ученика:  R_user'  = R_user  + K_user  * (S - E_user).
// Новый рейтинг задачи:   R_puzzle'= R_puzzle+ K_puzzle* ((1 - S) - (1 - E_user))  (= K_puzzle * (E_user - S)).
// Т.е. решил — рейтинг задачи чуть падает, не решил — растёт.
//
// Примечание: модуль называется «rating calculator» и реализует Elo согласно ТЗ Module 4
// (для онлайн-партий в проекте отдельно живёт Glicko-2 — v2/utils/ratingCalculator.js).

const DEFAULT_RATING = 1500;
const MIN_RATING = 400;     // пол рейтинга, чтобы задачи/ученики не уходили в абсурд
const MAX_RATING = 3500;
const DEFAULT_K_USER = 32;
const DEFAULT_K_PUZZLE = 24;

const clampRating = (r) => Math.max(MIN_RATING, Math.min(MAX_RATING, Math.round(r)));

/** Матожидание результата игрока A с рейтингом rA против рейтинга rB. */
function expectedScore(rA, rB) {
    return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

/**
 * Пересчёт рейтингов ученика и задачи после одной попытки.
 * @param {object} p
 * @param {number} p.userRating    текущий рейтинг ученика
 * @param {number} p.puzzleRating  текущий рейтинг задачи
 * @param {boolean} p.success      true — решено с 1-й попытки без подсказок
 * @param {number} [p.kUser]       коэффициент K для ученика
 * @param {number} [p.kPuzzle]     коэффициент K для задачи
 * @returns {{ expected:number, success:boolean,
 *             userDelta:number, puzzleDelta:number,
 *             newUserRating:number, newPuzzleRating:number }}
 */
function computeRatingChange({ userRating, puzzleRating, success, kUser = DEFAULT_K_USER, kPuzzle = DEFAULT_K_PUZZLE }) {
    const rUser = Number.isFinite(userRating) ? userRating : DEFAULT_RATING;
    const rPuzzle = Number.isFinite(puzzleRating) ? puzzleRating : DEFAULT_RATING;
    const S = success ? 1 : 0;

    const E = expectedScore(rUser, rPuzzle);

    const newUserRating = clampRating(rUser + kUser * (S - E));
    // (1 - S) - (1 - E) === E - S  — рейтинг задачи движется в противоположную ученику сторону
    const newPuzzleRating = clampRating(rPuzzle + kPuzzle * (E - S));

    return {
        expected: E,
        success: !!success,
        userDelta: newUserRating - clampRating(rUser),
        puzzleDelta: newPuzzleRating - clampRating(rPuzzle),
        newUserRating,
        newPuzzleRating,
    };
}

module.exports = {
    expectedScore,
    computeRatingChange,
    DEFAULT_RATING,
    MIN_RATING,
    MAX_RATING,
    DEFAULT_K_USER,
    DEFAULT_K_PUZZLE,
};
