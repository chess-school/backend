#!/usr/bin/env node
// scripts/stressTest.js
//
// Нагрузочный тест онлайн-партий (/play). Поднимает N виртуальных игроков (ботов),
// соединяет их в N/2 партий через автоподбор (seek), и в цикле делает случайные
// ЛЕГАЛЬНЫЕ ходы (chess.js) за обе стороны с задержкой 500–1500 мс.
//
// Меряет: задержку сервера (RTT от make_move до ack), успешные ходы в секунду (RPS),
// рассинхроны FEN (локальная доска vs. ответ сервера) и ошибки по кодам. В конце — отчёт.
//
// Боты создаются временными в той же MongoDB (MONGO_URI), им выдаётся валидный JWT
// (та же подпись, что у логина), а по завершении боты и их партии удаляются.
//
// Запуск (сервер уже слушает SERVER_URL):
//   node scripts/stressTest.js --sockets 100 --duration 60 --url http://localhost:5000
//   node scripts/stressTest.js --minutes 5 --increment 3 --rated false

require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const { Chess } = require('chess.js');

const TestUser = require('../v2/models/User');
const LiveGame = require('../v2/models/LiveGame');

// ------------------------------------------------------------------ конфиг
const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
};
const CONFIG = {
    sockets: Math.max(2, parseInt(arg('sockets', process.env.STRESS_SOCKETS || '100'), 10) & ~1), // чётное
    durationMs: parseInt(arg('duration', process.env.STRESS_DURATION || '60'), 10) * 1000,
    url: arg('url', process.env.STRESS_URL || 'http://localhost:5000'),
    minutes: parseInt(arg('minutes', '5'), 10),
    increment: parseInt(arg('increment', '3'), 10),
    rated: arg('rated', 'false') === 'true',
    moveMinMs: 500,
    moveMaxMs: 1500,
    ackTimeoutMs: 10000,
};
const EMAIL_PREFIX = 'stress-bot-';
// Детерминированной случайности не нужно — но seed по индексу для воспроизводимого выбора ходов
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// ------------------------------------------------------------------ метрики
const metrics = {
    connected: 0,
    gamesStarted: 0,
    gamesEnded: 0,
    activeGames: 0,
    peakGames: 0,
    movesOk: 0,
    movesFailed: 0,
    desyncs: 0,
    latencies: [],
    errorsByCode: {},
};
// Уникальные id активных партий — оба игрока добавляют один и тот же id, поэтому размер = число партий
const activeGameIds = new Set();
const bumpError = (code) => { metrics.errorsByCode[code] = (metrics.errorsByCode[code] || 0) + 1; };
const trackGameOpen = (id) => { if (!activeGameIds.has(id)) metrics.gamesStarted++; activeGameIds.add(id); metrics.activeGames = activeGameIds.size; metrics.peakGames = Math.max(metrics.peakGames, activeGameIds.size); };
const trackGameClose = (id) => { if (activeGameIds.delete(id)) metrics.gamesEnded++; metrics.activeGames = activeGameIds.size; };

let stopping = false;

// ------------------------------------------------------------------ бот
class Bot {
    constructor(user, token) {
        this.userId = String(user._id);
        this.token = token;
        this.socket = null;
        this.game = null; // { id, chess, myColor, moveTimer, over }
    }

    connect() {
        return new Promise((resolve) => {
            // forceNew — каждый сокет своё соединение (иначе socket.io мультиплексирует в одно)
            this.socket = io(`${CONFIG.url}/play`, {
                auth: { token: this.token },
                transports: ['websocket'],
                forceNew: true,
                reconnection: false,
            });
            this.socket.on('connect', () => { metrics.connected++; resolve(true); });
            this.socket.on('connect_error', (e) => {
                bumpError(`CONNECT:${(e && e.data && e.data.code) || e.message || 'ERR'}`);
                resolve(false);
            });
            this.socket.on('game_started', ({ gameId }) => this.onGameStarted(gameId));
            this.socket.on('move', (p) => this.onMove(p));
            this.socket.on('game_over', (p) => this.onGameOver(p));
        });
    }

    seek() {
        if (stopping || !this.socket || !this.socket.connected) return;
        this.socket.emit('seek', { minutes: CONFIG.minutes, increment: CONFIG.increment, rated: CONFIG.rated }, (ack) => {
            if (ack && ack.ok === false) bumpError(`SEEK:${ack.error && ack.error.code}`);
        });
    }

    async onGameStarted(gameId) {
        if (stopping || (this.game && this.game.id === gameId)) return;
        this.socket.emit('join_game', { gameId }, (ack) => {
            if (!ack || ack.ok === false) { bumpError(`JOIN:${ack && ack.error && ack.error.code}`); return; }
            const state = ack.data;
            const chess = new Chess();
            for (const uci of state.moves || []) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
            const myColor = String(state.white && state.white._id) === this.userId ? 'white'
                : String(state.black && state.black._id) === this.userId ? 'black' : null;
            if (!myColor) { bumpError('NOT_A_PLAYER'); return; }
            this.game = { id: gameId, chess, myColor, moveTimer: null, over: state.status !== 'active' };
            trackGameOpen(gameId);
            this.maybeMove();
        });
    }

    onMove(p) {
        const g = this.game;
        if (!g || g.id !== p.gameId || g.over) return;
        const localPly = g.chess.history().length;
        if (p.ply === localPly + 1) {
            // Чужой ход (или наш, если не применяли оптимистично) — применяем
            try { g.chess.move({ from: p.uci.slice(0, 2), to: p.uci.slice(2, 4), promotion: p.uci[4] || undefined }); } catch { /* применится при сверке ниже */ }
        }
        // Сверка источника истины: наша доска должна совпасть с серверной
        if (g.chess.fen() !== p.fen) metrics.desyncs++;
        this.maybeMove();
    }

    onGameOver(p) {
        const g = this.game;
        if (!g || g.id !== p.gameId || g.over) return;
        g.over = true;
        if (g.moveTimer) clearTimeout(g.moveTimer);
        trackGameClose(p.gameId);
        this.game = null;
        // Поддерживаем нагрузку: встаём в очередь на новую партию
        if (!stopping) setTimeout(() => this.seek(), randInt(200, 600));
    }

    maybeMove() {
        const g = this.game;
        if (stopping || !g || g.over || g.moveTimer) return;
        const myTurn = (g.chess.turn() === 'w' ? 'white' : 'black') === g.myColor;
        if (!myTurn || g.chess.isGameOver()) return;
        g.moveTimer = setTimeout(() => { g.moveTimer = null; this.makeMove(); }, randInt(CONFIG.moveMinMs, CONFIG.moveMaxMs));
    }

    makeMove() {
        const g = this.game;
        if (stopping || !g || g.over) return;
        const legal = g.chess.moves({ verbose: true });
        if (!legal.length) return;
        const m = legal[randInt(0, legal.length - 1)];
        const uci = `${m.from}${m.to}${m.promotion || ''}`;
        const plyBefore = g.chess.history().length;

        // Оптимистично применяем локально (ход легален — сервер примет)
        g.chess.move(m);

        const t0 = Date.now();
        let acked = false;
        const timer = setTimeout(() => { if (!acked) { metrics.movesFailed++; bumpError('ACK_TIMEOUT'); } }, CONFIG.ackTimeoutMs);

        this.socket.emit('make_move', { gameId: g.id, uci, ply: plyBefore }, (ack) => {
            acked = true;
            clearTimeout(timer);
            metrics.latencies.push(Date.now() - t0);
            if (!ack || ack.ok === false) {
                metrics.movesFailed++;
                bumpError(`MOVE:${ack && ack.error && ack.error.code}`);
                try { g.chess.undo(); } catch { /* рассинхрон поймается на следующем move-событии */ }
                return;
            }
            metrics.movesOk++;
            if (ack.data && ack.data.fen && g.chess.fen() !== ack.data.fen) metrics.desyncs++;
        });
    }

    teardown() {
        if (this.game && this.game.moveTimer) clearTimeout(this.game.moveTimer);
        if (this.socket) this.socket.disconnect();
    }
}

// ------------------------------------------------------------------ сид / очистка
const seedBots = async (n) => {
    const stamp = Date.now().toString(36);
    const docs = Array.from({ length: n }, (_, i) => ({
        firstName: 'StressBot',
        lastName: `#${i}`,
        email: `${EMAIL_PREFIX}${stamp}-${i}@stress.local`,
        password: 'stress-test-not-a-real-login',
        emailVerified: true,
    }));
    const users = await TestUser.insertMany(docs);
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET не задан в .env');
    return users.map((u) => new Bot(u, jwt.sign({ id: String(u._id), sessionTokenVersion: 0 }, secret, { expiresIn: '1h' })));
};

const cleanup = async (bots) => {
    const ids = bots.map((b) => new mongoose.Types.ObjectId(b.userId));
    const games = await LiveGame.deleteMany({ $or: [{ createdBy: { $in: ids } }, { whitePlayer: { $in: ids } }, { blackPlayer: { $in: ids } }] });
    const users = await TestUser.deleteMany({ _id: { $in: ids } });
    console.log(`\n🧹 Очистка: удалено ботов ${users.deletedCount}, партий ${games.deletedCount}`);
};

// ------------------------------------------------------------------ отчёт
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const report = (elapsedMs) => {
    const L = [...metrics.latencies].sort((a, b) => a - b);
    const avg = L.length ? Math.round(L.reduce((s, x) => s + x, 0) / L.length) : 0;
    const rps = (metrics.movesOk / (elapsedMs / 1000)).toFixed(1);
    const line = '─'.repeat(54);
    console.log(`\n${line}`);
    console.log('           STRESS TEST — ОТЧЁТ');
    console.log(line);
    console.log(`Длительность:          ${(elapsedMs / 1000).toFixed(1)} с`);
    console.log(`Сервер:                ${CONFIG.url}/play`);
    console.log(`Контроль времени:      ${CONFIG.minutes}+${CONFIG.increment}  (${CONFIG.rated ? 'rated' : 'casual'})`);
    console.log(`Игроки (сокеты):       ${CONFIG.sockets}  (подключено: ${metrics.connected})`);
    console.log(`Партии (пик):          ${metrics.peakGames}  [цель ~${CONFIG.sockets / 2}]`);
    console.log(`Партий started/ended:  ${metrics.gamesStarted} / ${metrics.gamesEnded}`);
    console.log(`Ходов OK:              ${metrics.movesOk}`);
    console.log(`Ходов FAILED:          ${metrics.movesFailed}`);
    console.log(`Успешных ходов/с (RPS):${rps}`);
    console.log(`Задержка сервера (мс): avg ${avg} | p50 ${pct(L, 50)} | p95 ${pct(L, 95)} | p99 ${pct(L, 99)} | max ${L[L.length - 1] || 0}`);
    console.log(`Рассинхроны FEN:       ${metrics.desyncs}`);
    console.log(`Ошибки по кодам:       ${Object.keys(metrics.errorsByCode).length ? JSON.stringify(metrics.errorsByCode) : '—'}`);
    console.log(line);
    const verdict = avg <= 50 && metrics.desyncs === 0 && metrics.movesFailed === 0;
    console.log(verdict ? '✅ Цель достигнута: средняя задержка ≤ 50 мс, без рассинхронов и ошибок.'
        : '⚠️  Цель НЕ достигнута — см. задержку/ошибки/рассинхроны выше.');
    console.log(line);
};

// ------------------------------------------------------------------ main
const main = async () => {
    // Защита: скрипт создаёт реальных пользователей-ботов в БД. Не даём случайно запустить
    // его против боевой базы — нужен либо локальный/тестовый MONGO_URI, либо явный флаг.
    const uri = process.env.MONGO_URI || '';
    const looksLocalOrTest = /localhost|127\.0\.0\.1|test|stress/i.test(uri);
    const forced = process.argv.includes('--i-know-this-is-prod');
    if (!looksLocalOrTest && !forced) {
        console.error('✋ MONGO_URI не похож на локальную/тестовую базу. Нагрузочный тест создаёт реальных пользователей.');
        console.error('   Укажите тестовую БД в MONGO_URI или, осознанно, добавьте флаг --i-know-this-is-prod.');
        process.exit(1);
    }
    console.log(`→ Подключение к MongoDB…`);
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`→ Создание ${CONFIG.sockets} ботов…`);
    const bots = await seedBots(CONFIG.sockets);

    let interrupted = false;
    const onSig = () => { interrupted = true; stopping = true; };
    process.on('SIGINT', onSig);

    try {
        console.log(`→ Подключение ${CONFIG.sockets} сокетов к ${CONFIG.url}/play…`);
        const results = await Promise.all(bots.map((b) => b.connect()));
        const ok = results.filter(Boolean).length;
        console.log(`→ Подключено ${ok}/${CONFIG.sockets}. Старт автоподбора и игры на ${CONFIG.durationMs / 1000} с…`);
        if (ok < 2) throw new Error('Недостаточно подключений — сервер запущен и доступен по --url?');

        const started = Date.now();
        bots.forEach((b) => b.seek());

        // Периодический прогресс
        const progress = setInterval(() => {
            if (stopping) return;
            const el = ((Date.now() - started) / 1000).toFixed(0);
            process.stdout.write(`\r  t=${el}s | партий=${metrics.activeGames} | ходов OK=${metrics.movesOk} | desync=${metrics.desyncs}   `);
        }, 1000);

        // Ждём окончания (или Ctrl-C)
        await new Promise((resolve) => {
            const check = setInterval(() => {
                if (interrupted || Date.now() - started >= CONFIG.durationMs) { clearInterval(check); resolve(); }
            }, 200);
        });

        stopping = true;
        clearInterval(progress);
        const elapsed = Date.now() - started;
        // Дать «в полёте» ack-ам долететь
        await new Promise((r) => setTimeout(r, 500));
        report(elapsed);
    } finally {
        stopping = true;
        bots.forEach((b) => b.teardown());
        await new Promise((r) => setTimeout(r, 300));
        await cleanup(bots);
        await mongoose.disconnect();
        process.exit(0);
    }
};

main().catch((e) => { console.error('Фатальная ошибка:', e); process.exit(1); });
