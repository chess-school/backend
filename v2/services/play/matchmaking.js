// v2/services/play/matchmaking.js
//
// Очередь автоподбора (Quick Pairing), как «Быстрый старт» на Lichess: игрок встаёт в очередь
// с контролем времени, рейтинговостью и диапазоном рейтинга соперника; сервер соединяет двух
// подходящих игроков (тот же контроль и тип партии, рейтинги взаимно в диапазонах) и сразу
// запускает партию. Кто ждёт дольше — того соединяют первым. Диапазон расширяется со временем
// ожидания (+100 каждые 10 с), чтобы не ждать вечно. Очередь — в памяти процесса.

const User = require('../../models/User');
const { buildTimeControl, LIMITS } = require('../../utils/timeControl');
const { DEFAULT_RATING } = require('../../utils/ratingCalculator');
const { unprocessable } = require('../../utils/apiError');

const WIDEN_EVERY_MS = 10000;
const WIDEN_STEP = 100;
const SWEEP_MS = 2000;

const createMatchmaking = ({
    createPairedGame,
    notifyUser = () => {},
    ratingOf = async (userId, speed) => {
        const u = await User.findById(userId).select('ratings').lean();
        return Math.round(u?.ratings?.[speed]?.rating ?? DEFAULT_RATING.rating);
    },
    now = Date.now,
    sweepEvery = SWEEP_MS,
} = {}) => {
    /** userId -> заявка в очереди */
    const queue = new Map();
    let pairing = Promise.resolve();

    const rangeOf = (entry, t) => (entry.range == null ? Infinity : entry.range + Math.floor((t - entry.since) / WIDEN_EVERY_MS) * WIDEN_STEP);
    const compatible = (a, b, t) => a.userId !== b.userId
        && a.key === b.key
        && Math.abs(a.rating - b.rating) <= Math.min(rangeOf(a, t), rangeOf(b, t));

    /** Найти и соединить пары; последовательно — одна заявка не попадёт в две партии */
    const sweep = () => {
        pairing = pairing.then(async () => {
            const t = now();
            const waiting = [...queue.values()].sort((a, b) => a.since - b.since);
            const used = new Set();
            for (const a of waiting) {
                if (used.has(a.userId)) continue;
                const b = waiting.find((x) => !used.has(x.userId) && compatible(a, x, t));
                if (!b) continue;
                used.add(a.userId);
                used.add(b.userId);
                queue.delete(a.userId);
                queue.delete(b.userId);
                try {
                    const gameId = await createPairedGame(a.userId, b.userId, a.timeControl, a.rated);
                    for (const e of [a, b]) notifyUser(e.userId, 'seek_state', { seeking: false, gameId });
                } catch (e) {
                    console.error('Pairing failed:', e);
                    for (const x of [a, b]) notifyUser(x.userId, 'seek_state', { seeking: false, error: 'PAIRING_FAILED' });
                }
            }
        }).catch((e) => console.error('Matchmaking sweep failed:', e));
        return pairing;
    };

    const timer = sweepEvery ? setInterval(() => { if (queue.size > 1) sweep(); }, sweepEvery) : null;
    if (timer && timer.unref) timer.unref();

    /** Встать в очередь: { minutes, increment, rated, ratingRange? } -> { seeking } | { gameId } */
    const seek = async (user, socketId, { minutes, increment, rated = true, ratingRange = null }) => {
        const tc = buildTimeControl({ minutes, increment });
        if (!tc) throw unprocessable(`Time control must be ${LIMITS.minMinutes}–${LIMITS.maxMinutes} minutes and 0–${LIMITS.maxIncrement} seconds increment.`, 'INVALID_TIME_CONTROL');
        const range = ratingRange == null || ratingRange === '' ? null : Number(ratingRange);
        if (range !== null && (!Number.isFinite(range) || range < 50 || range > 1000)) throw unprocessable('ratingRange must be 50–1000.', 'VALIDATION_ERROR');
        const entry = {
            userId: String(user.id),
            socketId,
            timeControl: tc,
            rated: !!rated,
            key: `${tc.initialSeconds}+${tc.incrementSeconds}:${rated ? 'rated' : 'casual'}`,
            rating: await ratingOf(user.id, tc.type),
            range,
            since: now(),
        };
        queue.set(entry.userId, entry); // повторный seek заменяет прежний
        await sweep();
        if (queue.has(entry.userId)) {
            notifyUser(entry.userId, 'seek_state', { seeking: true, timeControl: tc, rated: entry.rated });
            return { seeking: true, timeControl: tc };
        }
        return { seeking: false };
    };

    const cancel = (userId) => {
        const had = queue.delete(String(userId));
        if (had) notifyUser(String(userId), 'seek_state', { seeking: false });
        return { cancelled: had };
    };

    return { seek, cancel, sweep, size: () => queue.size, isSeeking: (id) => queue.has(String(id)), stop: () => timer && clearInterval(timer) };
};

let instance = null;
const getMatchmaking = () => {
    if (!instance) {
        // Ленивая загрузка: сервис вызовов зависит от движка партий
        const { createPairedGame } = require('./challenge.service');
        const { emitToUser } = require('./playRealtime');
        instance = createMatchmaking({ createPairedGame, notifyUser: emitToUser });
    }
    return instance;
};

module.exports = { createMatchmaking, getMatchmaking, WIDEN_EVERY_MS, WIDEN_STEP };
