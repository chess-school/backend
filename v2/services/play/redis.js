// v2/services/play/redis.js
//
// Redis для онлайн-партий (ШАГ 1). Включается только когда задан REDIS_URL — иначе сервер
// работает как раньше (состояние в памяти процесса, запись в Mongo синхронно). Это сохраняет
// существующее поведение и зелёные тесты, а кластерный режим добавляется поверх.
//
// Даёт три вещи:
//   1) hot-state store — сериализованное состояние активной партии (fen/moves/clock/status) в Redis,
//      чтобы ЛЮБОЙ процесс кластера мог его прочитать (снапшот для зрителей/входящих, восстановление);
//   2) распределённый лок на партию — ходы одной партии сериализуются даже между процессами;
//   3) pub/sub клиенты для @socket.io/redis-adapter — рассылка ходов между процессами.

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || null;
const isClustered = () => !!REDIS_URL;

const GAME_KEY = (id) => `play:game:${id}`;
const LOCK_KEY = (id) => `play:lock:${id}`;
const STATE_TTL_S = 6 * 60 * 60; // активная партия живёт в Redis максимум 6 ч (страховка от утечки ключей)

let client = null;      // основной клиент (store + lock)
let pub = null;         // publisher для адаптера
let sub = null;         // subscriber для адаптера

const makeClient = (label) => {
    const c = new Redis(REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2, enableReadyCheck: true });
    c.on('error', (e) => console.error(`Redis (${label}) error:`, e.message));
    return c;
};

const getClient = () => {
    if (!isClustered()) return null;
    if (!client) client = makeClient('store');
    return client;
};

/** Пара клиентов для socket.io-адаптера (pub/sub нельзя делить с обычными командами) */
const getPubSub = () => {
    if (!isClustered()) return null;
    if (!pub) { pub = makeClient('pub'); sub = pub.duplicate(); }
    return { pub, sub };
};

// ------------------------------------------------------------------ hot-state store
const saveState = async (gameId, serialized) => {
    const c = getClient();
    if (!c) return;
    await c.set(GAME_KEY(gameId), JSON.stringify(serialized), 'EX', STATE_TTL_S);
};
const loadState = async (gameId) => {
    const c = getClient();
    if (!c) return null;
    const raw = await c.get(GAME_KEY(gameId));
    return raw ? JSON.parse(raw) : null;
};
const deleteState = async (gameId) => {
    const c = getClient();
    if (!c) return;
    await c.del(GAME_KEY(gameId));
};

// ------------------------------------------------------------------ распределённый лок
// SET key token NX PX ttl + освобождение через CAS (Lua), чтобы не снять чужой лок.
const RELEASE_LUA = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
let tokenSeq = 0;

/** Выполнить fn, держа распределённый лок на партию. Ждёт освобождения (с бэкоффом). */
const withRedisLock = async (gameId, fn, { ttlMs = 10000, waitMs = 8000 } = {}) => {
    const c = getClient();
    if (!c) return fn(); // некластерный режим — лок не нужен (один процесс, in-process очередь)
    const key = LOCK_KEY(gameId);
    const token = `${process.pid}-${++tokenSeq}-${gameId}`;
    const deadline = Date.now() + waitMs;
    let acquired = false;
    while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        if (await c.set(key, token, 'PX', ttlMs, 'NX')) { acquired = true; break; }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 15)));
    }
    if (!acquired) throw new Error(`Could not acquire lock for game ${gameId}`);
    try {
        return await fn();
    } finally {
        try { await c.eval(RELEASE_LUA, 1, key, token); } catch (e) { console.error('Lock release failed:', e.message); }
    }
};

const quit = async () => {
    await Promise.all([client, pub, sub].filter(Boolean).map((c) => c.quit().catch(() => {})));
    client = pub = sub = null;
};

module.exports = { isClustered, getClient, getPubSub, saveState, loadState, deleteState, withRedisLock, quit, GAME_KEY };
