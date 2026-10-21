// v2/utils/ratingCalculator.js
//
// Рейтинг Glicko-2 (Mark Glickman, http://www.glicko.net/glicko/glicko2.pdf), как на Lichess:
// у игрока рейтинг r, отклонение RD (неуверенность в рейтинге) и волатильность σ.
// Новичок: 1500 / 350 / 0.06 — его рейтинг быстро «находит» уровень, у опытного меняется мало.
// Рейтинг пересчитывается после каждой партии (рейтинговый период = одна партия).
// result: 1 — победа, 0.5 — ничья, 0 — поражение (с точки зрения игрока).

const SCALE = 173.7178;          // перевод между шкалой Glicko и Glicko-2
const TAU = 0.75;                // ограничение изменения волатильности (Lichess использует 0.75)
const EPSILON = 0.000001;
const DEFAULT = Object.freeze({ rating: 1500, rd: 350, vol: 0.06 });
const RD_MIN = 45;               // RD не опускается ниже — рейтинг всегда может сдвинуться (как на Lichess)
const RD_MAX = 350;
const RATING_MIN = 400;
const RATING_MAX = 4000;

const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Новая волатильность — итерационный алгоритм Illinois из статьи (шаг 5) */
const newVolatility = (phi, sigma, delta, v, tau) => {
    const a = Math.log(sigma * sigma);
    const f = (x) => {
        const ex = Math.exp(x);
        return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau);
    };
    let A = a;
    let B;
    if (delta * delta > phi * phi + v) {
        B = Math.log(delta * delta - phi * phi - v);
    } else {
        let k = 1;
        while (f(a - k * tau) < 0) k++;
        B = a - k * tau;
    }
    let fA = f(A);
    let fB = f(B);
    for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
        const C = A + ((A - B) * fA) / (fB - fA);
        const fC = f(C);
        if (fC * fB <= 0) { A = B; fA = fB; } else { fA /= 2; }
        B = C;
        fB = fC;
    }
    return Math.exp(A / 2);
};

/**
 * Обновление рейтинга игрока по результатам периода (одной или нескольких партий).
 * player: { rating, rd, vol }; games: [{ rating, rd, score }] — соперники и результат.
 * Возвращает { rating, rd, vol } (не округлённые). tau — параметр системы (по умолчанию 0.75).
 */
const glicko2 = (player, games, tau = TAU) => {
    const mu = (player.rating - 1500) / SCALE;
    const phi = player.rd / SCALE;
    const sigma = player.vol;

    if (!games.length) {
        // Нет партий — растёт только неуверенность
        const phiStar = Math.sqrt(phi * phi + sigma * sigma);
        return { rating: player.rating, rd: Math.min(RD_MAX, phiStar * SCALE), vol: sigma };
    }

    const opponents = games.map((o) => ({ mu: (o.rating - 1500) / SCALE, phi: o.rd / SCALE, score: o.score }));
    const v = 1 / opponents.reduce((sum, o) => {
        const e = E(mu, o.mu, o.phi);
        return sum + g(o.phi) ** 2 * e * (1 - e);
    }, 0);
    const delta = v * opponents.reduce((sum, o) => sum + g(o.phi) * (o.score - E(mu, o.mu, o.phi)), 0);

    const sigmaNew = newVolatility(phi, sigma, delta, v, tau);
    const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
    const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const muNew = mu + phiNew * phiNew * opponents.reduce((sum, o) => sum + g(o.phi) * (o.score - E(mu, o.mu, o.phi)), 0);

    return { rating: muNew * SCALE + 1500, rd: phiNew * SCALE, vol: sigmaNew };
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const normalize = (r) => ({
    rating: Math.round(clamp(r.rating, RATING_MIN, RATING_MAX)),
    rd: Math.round(clamp(r.rd, RD_MIN, RD_MAX) * 100) / 100,
    vol: Math.round(r.vol * 1e6) / 1e6,
});

/**
 * Пересчёт после одной партии для обоих игроков.
 * white/black: { rating, rd, vol }; whiteScore: 1 | 0.5 | 0.
 * Возвращает { white: {rating, rd, vol}, black: {...}, diff: { white: Δ, black: Δ } }.
 */
const rateGame = (white, black, whiteScore) => {
    if (![0, 0.5, 1].includes(whiteScore)) throw new Error(`Invalid score: ${whiteScore}`);
    const w = normalize(glicko2(white, [{ rating: black.rating, rd: black.rd, score: whiteScore }]));
    const b = normalize(glicko2(black, [{ rating: white.rating, rd: white.rd, score: 1 - whiteScore }]));
    return { white: w, black: b, diff: { white: w.rating - Math.round(white.rating), black: b.rating - Math.round(black.rating) } };
};

/** Ожидаемый результат игрока против соперника (0..1) — для подсказок «+X / −Y» */
const expectedScore = (player, opponent) => {
    const mu = (player.rating - 1500) / SCALE;
    return E(mu, (opponent.rating - 1500) / SCALE, Math.sqrt((player.rd / SCALE) ** 2 + (opponent.rd / SCALE) ** 2));
};

/** Рейтинг «предварительный» (?) — пока RD высокий, как у Lichess */
const isProvisional = (r) => (r?.rd ?? DEFAULT.rd) > 110;

module.exports = { glicko2, rateGame, expectedScore, isProvisional, DEFAULT_RATING: DEFAULT };
