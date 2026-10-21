// v2/utils/timeControl.js
//
// Контроль времени партии. Категория (пул рейтинга) — по ожидаемой длительности, как на Lichess:
// estimate = начальное время + 40 × добавка (40 ходов);
//   < 180 с — bullet, < 480 — blitz, < 1500 — rapid, иначе classical.
// Пресеты лобби — как на Lichess; кастомный контроль: 1–180 минут, добавка 0–60 секунд.

const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical'];

const PRESETS = [
    { id: '1+0', minutes: 1, increment: 0 },
    { id: '2+1', minutes: 2, increment: 1 },
    { id: '3+0', minutes: 3, increment: 0 },
    { id: '3+2', minutes: 3, increment: 2 },
    { id: '5+0', minutes: 5, increment: 0 },
    { id: '5+3', minutes: 5, increment: 3 },
    { id: '10+0', minutes: 10, increment: 0 },
    { id: '15+10', minutes: 15, increment: 10 },
    { id: '30+0', minutes: 30, increment: 0 },
];

const LIMITS = { minMinutes: 1, maxMinutes: 180, maxIncrement: 60 };

const speedOf = (initialSeconds, incrementSeconds) => {
    const estimate = initialSeconds + 40 * incrementSeconds;
    if (estimate < 180) return 'bullet';
    if (estimate < 480) return 'blitz';
    if (estimate < 1500) return 'rapid';
    return 'classical';
};

/**
 * Нормализованный контроль из ввода { minutes, increment } (или пресета).
 * null — вне допустимых пределов.
 */
const buildTimeControl = ({ minutes, increment }) => {
    const m = Number(minutes);
    const inc = Number(increment);
    if (!Number.isFinite(m) || !Number.isFinite(inc)) return null;
    if (m < LIMITS.minMinutes || m > LIMITS.maxMinutes || !Number.isInteger(m)) return null;
    if (inc < 0 || inc > LIMITS.maxIncrement || !Number.isInteger(inc)) return null;
    const initialSeconds = m * 60;
    const preset = PRESETS.find((p) => p.minutes === m && p.increment === inc);
    return {
        type: speedOf(initialSeconds, inc),
        initialSeconds,
        incrementSeconds: inc,
        custom: !preset,
    };
};

/** Подпись «3+2» */
const label = (tc) => `${tc.initialSeconds / 60}+${tc.incrementSeconds}`;

module.exports = { SPEEDS, PRESETS, LIMITS, speedOf, buildTimeControl, label };
