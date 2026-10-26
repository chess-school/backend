// v2/services/play/gameManager.js
//
// Движок онлайн-партий (сервер — источник истины):
//   — ход проверяется chess.js на сервере: только свой цвет, только в свою очередь, только легальный;
//   — часы ведёт сервер (clock.js); флаг падает по серверному таймеру, а не по сообщению клиента;
//   — ходы одной партии обрабатываются строго по очереди (per-game lock) — нет гонок двух ходов;
//   — конец партии: мат, пат, недостаточный материал, троекратное повторение, 50 ходов, время,
//     сдача, ничья по соглашению; отмена (abort), если первые ходы не сделаны за abortTimeoutMs;
//   — флаг при «голом» короле (или короле с одной лёгкой фигурой) у соперника — ничья, как на Lichess;
//   — рейтинговая партия пересчитывает Glicko-2 обоих игроков в категории контроля времени.
//
// Два режима хранения активной партии (ШАГ 1):
//   • одиночный (по умолчанию, тесты): состояние живёт в Map процесса, каждый ход пишется в Mongo
//     синхронно (оптимистичная блокировка по $size) — прежнее, проверенное поведение;
//   • кластерный (REDIS_URL задан): авторитетное состояние (fen/moves/clock) живёт в Redis, ход
//     сериализуется распределённым локом на партию, ack не ждёт Mongo — запись в Mongo идёт
//     «вдогонку» (write-behind), а полный итог фиксируется в Mongo при завершении партии. Так любой
//     процесс кластера может вести любую партию, а задержка хода не упирается в round-trip к БД.
// Зависимости (время, таймеры, рассылка, redis) внедряются — часы и таймауты проверяются в тестах.

const { Chess } = require('chess.js');
const LiveGame = require('../../models/LiveGame');
const User = require('../../models/User');
const { GameClock } = require('./clock');
const redisModule = require('./redis');
const { rateGame, isProvisional, DEFAULT_RATING } = require('../../utils/ratingCalculator');
const { badRequest, conflict, forbidden, notFound } = require('../../utils/apiError');

const ABORT_TIMEOUT_MS = 30000;
// Кластер: как часто максимум сбрасывать промежуточное состояние активной партии в Mongo.
// Запись коалесцируется (пишется только последнее состояние), т.к. авторитет — Redis, а полный
// итог партии всё равно фиксируется в Mongo при finish.
const WRITE_BEHIND_MS = 1500;
const PLAYER_FIELDS = 'uuid firstName lastName avatarUrl ratings';

const opposite = (color) => (color === 'white' ? 'black' : 'white');
const colorOfTurn = (chess) => (chess.turn() === 'w' ? 'white' : 'black');
const movesOf = (chess) => chess.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`);

/** Может ли сторона в принципе поставить мат (иначе флаг соперника — ничья) */
const hasMatingMaterial = (chess, color) => {
    const c = color === 'white' ? 'w' : 'b';
    let minors = 0;
    for (const row of chess.board()) {
        for (const piece of row) {
            if (!piece || piece.color !== c || piece.type === 'k') continue;
            if (piece.type === 'p' || piece.type === 'r' || piece.type === 'q') return true;
            minors++;
        }
    }
    return minors >= 2;
};

const playerDto = (user, speed) => {
    if (!user) return null;
    const perf = user.ratings?.[speed] ?? DEFAULT_RATING;
    return {
        _id: user._id,
        uuid: user.uuid,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl || null,
        rating: Math.round(perf.rating ?? DEFAULT_RATING.rating),
        provisional: isProvisional(perf),
    };
};

const createGameManager = ({
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    emitToGame = () => {},
    emitToUser = () => {},
    abortTimeoutMs = ABORT_TIMEOUT_MS,
    writeBehindMs = WRITE_BEHIND_MS,
    redis = redisModule,
    clustered,
} = {}) => {
    const isClustered = clustered !== undefined ? clustered : redis.isClustered();

    /** gameId -> состояние активной партии (кэш одиночного режима) */
    const games = new Map();
    /** gameId -> цепочка промисов (последовательная обработка в этом процессе) */
    const locks = new Map();
    /** gameId -> id серверного таймера (флаг/отмена). Вынесен из state: в кластере state пересобирается */
    const timers = new Map();
    /** gameId -> хвост очереди отложенной записи в Mongo (кластер) */
    const writeQueue = new Map();
    /** gameId -> последнее состояние, ожидающее сброса в Mongo (коалесцирование write-behind) */
    const pendingWrite = new Map();
    /** gameId -> таймер отложенного сброса write-behind */
    const writeTimers = new Map();

    const inProcessChain = (gameId, fn) => {
        const key = String(gameId);
        const prev = locks.get(key) || Promise.resolve();
        const run = prev.then(fn, fn);
        const tail = run.catch(() => {});
        locks.set(key, tail);
        tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
        return run;
    };

    // В кластере — распределённый лок поверх внутрипроцессной очереди (меньше round-trip'ов к Redis
    // при конкуренции внутри одного процесса, но безопасность между процессами гарантирована).
    const withLock = isClustered
        ? (gameId, fn) => inProcessChain(gameId, () => redis.withRedisLock(String(gameId), fn))
        : inProcessChain;

    const ply = (state) => state.chess.history().length;
    const clockSnapshot = (state, t = now()) => state.clock.snapshot(t);
    const logError = (e) => console.error('Play engine error:', e);

    // ------------------------------------------------------------ (де)сериализация состояния
    const buildState = ({ id, white, black, isRated, timeControl, moves, clock, drawOfferBy, waitingSince }) => {
        const chess = new Chess();
        for (const uci of moves || []) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
        const gc = new GameClock({
            initialMs: timeControl.initialSeconds * 1000,
            incrementMs: timeControl.incrementSeconds * 1000,
            whiteMs: clock?.whiteMs ?? timeControl.initialSeconds * 1000,
            blackMs: clock?.blackMs ?? timeControl.initialSeconds * 1000,
            turn: clock?.turn ?? colorOfTurn(chess),
            turnStartedAt: clock?.turnStartedAt ? new Date(clock.turnStartedAt).getTime() : null,
        });
        return { id: String(id), white: String(white), black: String(black), isRated, timeControl, chess, clock: gc, drawOfferBy: drawOfferBy || null, waitingSince };
    };

    const fromDocument = (doc) => {
        const tc = doc.timeControl;
        return buildState({
            id: doc._id, white: doc.whitePlayer, black: doc.blackPlayer, isRated: doc.isRated,
            timeControl: { type: tc.type, initialSeconds: tc.initialSeconds, incrementSeconds: tc.incrementSeconds, custom: !!tc.custom },
            moves: doc.moves,
            // turn не передаём — buildState выведет его из списка ходов (fen может отставать при write-behind)
            clock: { whiteMs: doc.clock?.whiteMs, blackMs: doc.clock?.blackMs, turnStartedAt: doc.clock?.turnStartedAt || null },
            drawOfferBy: doc.drawOfferBy,
            waitingSince: new Date(doc.clock?.turnStartedAt || doc.updatedAt || doc.startedAt || now()).getTime(),
        });
    };

    /** Сериализованный снимок активной партии для Redis */
    const serialize = (state) => ({
        id: state.id, white: state.white, black: state.black, isRated: state.isRated, timeControl: state.timeControl,
        moves: movesOf(state.chess), sanMoves: state.chess.history(), fen: state.chess.fen(),
        clock: { whiteMs: state.clock.ms.white, blackMs: state.clock.ms.black, turn: state.clock.turn, turnStartedAt: state.clock.turnStartedAt },
        drawOfferBy: state.drawOfferBy, waitingSince: state.waitingSince,
    });

    // ------------------------------------------------------------ таймеры
    const clearGameTimer = (id) => {
        const t = timers.get(String(id));
        if (t) clearTimer(t);
        timers.delete(String(id));
    };

    // Колбэки таймеров возвращают промис обработки — тесты с фейковыми таймерами могут его дождаться
    const schedule = (state) => {
        const id = String(state.id);
        clearGameTimer(id);
        const t = now();
        if (ply(state) < 2) {
            // Первые ходы: часы стоят, но бесконечно ждать нельзя — отмена партии
            const wait = Math.max(0, state.waitingSince + abortTimeoutMs - t);
            timers.set(id, setTimer(() => withLock(id, () => onAbortTimer(id)).catch(logError), wait));
        } else {
            const wait = state.clock.msToFlag(t);
            if (Number.isFinite(wait)) timers.set(id, setTimer(() => withLock(id, () => onFlagTimer(id)).catch(logError), wait + 1));
        }
    };

    const onAbortTimer = async (gameId) => {
        const state = await getActive(gameId);
        if (!state || ply(state) >= 2) return;
        if (now() - state.waitingSince + 5 < abortTimeoutMs) { schedule(state); return; }
        await finish(state, { winner: null, reason: 'aborted', aborted: true });
    };

    const onFlagTimer = async (gameId) => {
        const state = await getActive(gameId);
        if (!state) return;
        if (!state.clock.flagged(now())) { schedule(state); return; } // таймер сработал рано
        await flag(state);
    };

    /** Упал флаг стороны, чей ход */
    const flag = async (state) => {
        const loser = state.clock.turn;
        const winner = opposite(loser);
        const result = hasMatingMaterial(state.chess, winner) ? winner : 'draw';
        await finish(state, { winner: result, reason: 'timeout' });
    };

    // ------------------------------------------------------------ загрузка / восстановление

    /** Текущее состояние активной партии для таймеров: кэш (одиночный) или Redis/Mongo (кластер) */
    const getActive = (gameId) => (isClustered ? load(gameId) : Promise.resolve(games.get(String(gameId)) || null));

    /** Активная партия: из памяти/Redis, иначе из БД (с упавшим за это время флагом) */
    const load = async (gameId) => {
        const key = String(gameId);

        if (!isClustered) {
            if (games.has(key)) return games.get(key);
            const doc = await LiveGame.findById(key).lean();
            if (!doc || doc.status !== 'active') return null;
            const state = fromDocument(doc);
            games.set(key, state);
            if (state.clock.flagged(now())) { await flag(state); return null; }
            schedule(state);
            return state;
        }

        // Кластер: авторитет — Redis; промах — восстановление из Mongo (и заполнение Redis).
        let state;
        const snap = await redis.loadState(key);
        if (snap) state = buildState(snap);
        else {
            const doc = await LiveGame.findById(key).lean();
            if (!doc || doc.status !== 'active') return null;
            state = fromDocument(doc);
            await redis.saveState(key, serialize(state));
        }
        if (state.clock.flagged(now())) { await flag(state); return null; }
        return state;
    };

    /** Зарегистрировать только что начатую партию (документ уже status: active) */
    const activate = (doc) => {
        const state = fromDocument(doc);
        state.waitingSince = now();
        if (isClustered) redis.saveState(state.id, serialize(state)).catch(logError);
        else games.set(state.id, state);
        schedule(state);
        return state;
    };

    // ------------------------------------------------------------ конец партии

    const applyRatings = async (state, winner) => {
        const speed = state.timeControl.type;
        const [w, b] = await Promise.all([
            User.findById(state.white).select('ratings').lean(),
            User.findById(state.black).select('ratings').lean(),
        ]);
        const before = {
            white: { ...DEFAULT_RATING, ...(w?.ratings?.[speed] || {}) },
            black: { ...DEFAULT_RATING, ...(b?.ratings?.[speed] || {}) },
        };
        const score = winner === 'white' ? 1 : winner === 'black' ? 0 : 0.5;
        const rated = rateGame(before.white, before.black, score);
        const save = (id, r) => User.updateOne({ _id: id }, {
            $set: { [`ratings.${speed}.rating`]: r.rating, [`ratings.${speed}.rd`]: r.rd, [`ratings.${speed}.vol`]: r.vol },
            $inc: { [`ratings.${speed}.games`]: 1 },
        });
        await Promise.all([save(state.white, rated.white), save(state.black, rated.black)]);
        const snap = (color) => ({
            before: Math.round(before[color].rating),
            after: rated[color].rating,
            diff: rated.diff[color],
            provisional: isProvisional(before[color]),
        });
        return { ratingChanges: { white: rated.diff.white, black: rated.diff.black }, ratings: { white: snap('white'), black: snap('black') } };
    };

    const finish = async (state, { winner, reason, aborted = false }) => {
        clearGameTimer(state.id);
        const t = now();
        state.clock.stop(t);
        games.delete(state.id);

        const rating = !aborted && state.isRated ? await applyRatings(state, winner) : null;
        const update = {
            status: aborted ? 'aborted' : 'finished',
            winner: aborted ? null : winner,
            endReason: reason,
            finishedAt: new Date(t),
            clock: state.clock.toDocument(),
            drawOfferBy: null,
            fen: state.chess.fen(),
            moves: movesOf(state.chess),
            sanMoves: state.chess.history(),
            pgn: state.chess.pgn(),
            ...(rating ? { ratingChanges: rating.ratingChanges, ratings: rating.ratings } : {}),
        };
        // Итог — полный и авторитетный — всегда пишется в Mongo; Redis-ключ партии убираем
        await LiveGame.updateOne({ _id: state.id, status: 'active' }, { $set: update });
        if (isClustered) { clearWriteBehind(String(state.id)); await redis.deleteState(state.id).catch(logError); writeQueue.delete(String(state.id)); }

        const payload = {
            gameId: state.id,
            status: update.status,
            winner: update.winner,
            endReason: reason,
            ratingChanges: rating?.ratingChanges ?? null,
            ratings: rating?.ratings ?? null,
            clock: clockSnapshot(state, t),
            pgn: update.pgn,
        };
        emitToGame(state.id, 'game_over', payload);
        return payload;
    };

    /** Итог по позиции после хода (null — игра продолжается) */
    const positionResult = (chess, mover) => {
        if (chess.isCheckmate()) return { winner: mover, reason: 'checkmate' };
        if (chess.isStalemate()) return { winner: 'draw', reason: 'stalemate' };
        if (chess.isInsufficientMaterial()) return { winner: 'draw', reason: 'insufficient_material' };
        if (chess.isThreefoldRepetition()) return { winner: 'draw', reason: 'threefold_repetition' };
        if (chess.isDraw()) return { winner: 'draw', reason: 'fifty_moves' };
        return null;
    };

    // ------------------------------------------------------------ сохранение хода

    /** Сбросить последнее накопленное состояние партии в Mongo (по таймеру коалесцирования) */
    const flushWrite = (id) => {
        writeTimers.delete(id);
        const snap = pendingWrite.get(id);
        if (!snap) return;
        pendingWrite.delete(id);
        const prev = writeQueue.get(id) || Promise.resolve();
        // Фильтр status:'active' защищает от гонки с finish: если партия уже завершилась,
        // отложенный сброс просто не найдёт документа (matchedCount 0) и ничего не перезапишет.
        const next = prev
            .then(() => LiveGame.updateOne({ _id: id, status: 'active' }, { $set: snap }))
            .catch((e) => console.error('Write-behind to Mongo failed:', e.message));
        writeQueue.set(id, next);
        next.then(() => { if (writeQueue.get(id) === next) writeQueue.delete(id); });
    };

    /** Снять отложенный сброс (конец партии / остановка) */
    const clearWriteBehind = (id) => {
        const t = writeTimers.get(id);
        if (t) clearTimer(t);
        writeTimers.delete(id);
        pendingWrite.delete(id);
    };

    /**
     * Запись хода «вдогонку» в Mongo (кластер): ack не ждёт БД. Коалесцируется — держим ТОЛЬКО
     * последнее состояние и пишем его не чаще writeBehindMs, снимая нагрузку на удалённый Mongo
     * под потоком ходов. Потеря промежуточных ходов в Mongo при краше безопасна: авторитет — Redis,
     * а итог партии фиксируется в Mongo при finish.
     */
    const writeBehind = (state) => {
        const id = String(state.id);
        pendingWrite.set(id, {
            fen: state.chess.fen(), moves: movesOf(state.chess), sanMoves: state.chess.history(),
            clock: state.clock.toDocument(), drawOfferBy: state.drawOfferBy,
        });
        if (!writeTimers.has(id)) writeTimers.set(id, setTimer(() => flushWrite(id), writeBehindMs));
    };

    const persistMove = async (state, plyBefore, uci, san) => {
        if (isClustered) {
            // Авторитет — Redis (быстро, локально); Mongo догоняет асинхронно
            await redis.saveState(state.id, serialize(state));
            writeBehind(state);
            return;
        }
        const res = await LiveGame.updateOne(
            { _id: state.id, status: 'active', moves: { $size: plyBefore } },
            {
                $push: { moves: uci, sanMoves: san },
                $set: { fen: state.chess.fen(), clock: state.clock.toDocument(), drawOfferBy: state.drawOfferBy },
            },
        );
        if (res.matchedCount === 0) throw conflict('The game state changed. Reload the game.', 'GAME_STATE_CONFLICT');
    };

    // ------------------------------------------------------------ действия игроков

    const requirePlayer = async (gameId, userId) => {
        const state = await load(gameId);
        if (!state) {
            const exists = await LiveGame.exists({ _id: gameId });
            if (!exists) throw notFound('Game not found.', 'GAME_NOT_FOUND');
            throw conflict('The game is not in progress.', 'GAME_NOT_ACTIVE');
        }
        const uid = String(userId);
        const color = uid === state.white ? 'white' : uid === state.black ? 'black' : null;
        if (!color) throw forbidden('You are not a player in this game.', 'NOT_A_PLAYER');
        return { state, color };
    };

    /** Ход игрока (uci: e2e4, e7e8q). expectedPly — защита от устаревшего клиента */
    const move = (gameId, userId, uci, expectedPly) => withLock(gameId, async () => {
        if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw badRequest('Move must be in UCI format, e.g. e2e4.', 'INVALID_MOVE_FORMAT');
        const { state, color } = await requirePlayer(gameId, userId);
        if (colorOfTurn(state.chess) !== color) throw conflict('It is not your turn.', 'NOT_YOUR_TURN');
        const plyBefore = ply(state);
        if (expectedPly !== undefined && expectedPly !== null && Number(expectedPly) !== plyBefore) {
            throw conflict('The position changed. Reload the game.', 'STALE_POSITION');
        }

        const t = now();
        // Флаг упал раньше, чем пришёл ход — партия проиграна по времени, ход не засчитывается
        if (state.clock.flagged(t)) {
            await flag(state);
            throw conflict('Time is up.', 'TIME_UP');
        }

        let played;
        try {
            played = state.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
        } catch {
            played = null;
        }
        if (!played) throw badRequest('Illegal move.', 'ILLEGAL_MOVE');
        const normalized = `${played.from}${played.to}${played.promotion ?? ''}`;

        // Часы запускаются после первого хода чёрных (ply 1 -> 2)
        state.clock.press(t, { startClock: plyBefore >= 1 });
        // Ход отклоняет предложение ничьей соперника; своё предложение остаётся в силе
        if (state.drawOfferBy && state.drawOfferBy !== color) state.drawOfferBy = null;
        if (plyBefore < 2) state.waitingSince = t;

        try {
            await persistMove(state, plyBefore, normalized, played.san);
        } catch (e) {
            state.chess.undo();
            games.delete(state.id); // перечитать из источника при следующем обращении
            throw e;
        }

        const payload = { gameId: state.id, uci: normalized, san: played.san, fen: state.chess.fen(), ply: plyBefore + 1, clock: clockSnapshot(state, t), drawOfferBy: state.drawOfferBy };
        emitToGame(state.id, 'move', payload);

        const result = positionResult(state.chess, color);
        if (result) await finish(state, result);
        else schedule(state);
        return payload;
    });

    const resign = (gameId, userId) => withLock(gameId, async () => {
        const { state, color } = await requirePlayer(gameId, userId);
        // До первых ходов обоих сдача — это отмена (без рейтинга), как на Lichess
        if (ply(state) < 2) return finish(state, { winner: null, reason: 'aborted', aborted: true });
        return finish(state, { winner: opposite(color), reason: 'resignation' });
    });

    const abort = (gameId, userId) => withLock(gameId, async () => {
        const { state } = await requirePlayer(gameId, userId);
        if (ply(state) >= 2) throw conflict('The game can be aborted only before both players move.', 'ABORT_NOT_ALLOWED');
        return finish(state, { winner: null, reason: 'aborted', aborted: true });
    });

    const persistSideEffect = async (state, set) => {
        if (isClustered) { await redis.saveState(state.id, serialize(state)); return; }
        await LiveGame.updateOne({ _id: state.id, status: 'active' }, { $set: set });
    };

    const offerDraw = (gameId, userId) => withLock(gameId, async () => {
        const { state, color } = await requirePlayer(gameId, userId);
        if (ply(state) < 2) throw conflict('Draw offers are available after the first moves.', 'DRAW_NOT_ALLOWED');
        // Встречное предложение = согласие
        if (state.drawOfferBy === opposite(color)) return finish(state, { winner: 'draw', reason: 'draw_agreement' });
        if (state.drawOfferBy === color) return { gameId: state.id, drawOfferBy: color };
        state.drawOfferBy = color;
        await persistSideEffect(state, { drawOfferBy: color });
        emitToGame(state.id, 'draw_offer', { gameId: state.id, by: color });
        return { gameId: state.id, drawOfferBy: color };
    });

    const answerDraw = (gameId, userId, accept) => withLock(gameId, async () => {
        const { state, color } = await requirePlayer(gameId, userId);
        if (state.drawOfferBy !== opposite(color)) throw conflict('There is no draw offer from your opponent.', 'NO_DRAW_OFFER');
        if (accept) return finish(state, { winner: 'draw', reason: 'draw_agreement' });
        state.drawOfferBy = null;
        await persistSideEffect(state, { drawOfferBy: null });
        emitToGame(state.id, 'draw_declined', { gameId: state.id, by: color });
        return { gameId: state.id, drawOfferBy: null };
    });

    // ------------------------------------------------------------ состояние для клиента

    /** Полное состояние партии (любой статус) — для входа в партию и зрителей */
    const snapshot = async (gameId) => {
        const doc = await LiveGame.findById(gameId).populate('whitePlayer', PLAYER_FIELDS).populate('blackPlayer', PLAYER_FIELDS).populate('createdBy', 'uuid firstName lastName').lean();
        if (!doc) throw notFound('Game not found.', 'GAME_NOT_FOUND');
        const speed = doc.timeControl.type;
        const state = doc.status === 'active' ? await load(gameId) : null;
        const t = now();
        let clock;
        if (state) clock = clockSnapshot(state, t);
        else {
            const ms = doc.clock?.whiteMs ?? doc.timeControl.initialSeconds * 1000;
            clock = { whiteMs: ms, blackMs: doc.clock?.blackMs ?? ms, turn: (doc.moves?.length ?? 0) % 2 ? 'black' : 'white', running: false, serverNow: t };
        }
        // Партия могла закончиться при загрузке (упавший флаг) — перечитать итог
        const fresh = doc.status === 'active' && !state ? await LiveGame.findById(gameId).lean() : doc;
        const players = (d) => ({ white: playerDto(doc.whitePlayer, speed), black: playerDto(doc.blackPlayer, speed), ...d });
        return players({
            _id: String(doc._id),
            status: fresh.status,
            source: doc.source,
            isPrivate: doc.isPrivate,
            isRated: doc.isRated,
            timeControl: doc.timeControl,
            creatorColor: doc.creatorColor,
            createdBy: doc.createdBy,
            fen: state ? state.chess.fen() : fresh.fen,
            moves: state ? movesOf(state.chess) : fresh.moves,
            sanMoves: state ? state.chess.history() : fresh.sanMoves,
            clock,
            drawOfferBy: state ? state.drawOfferBy : fresh.drawOfferBy,
            winner: fresh.winner,
            endReason: fresh.endReason,
            ratingChanges: fresh.ratingChanges,
            ratings: fresh.ratings,
            rematchOf: doc.rematchOf,
            pgn: fresh.pgn || (state ? state.chess.pgn() : ''),
            abortTimeoutMs,
        });
    };

    /** Остановить все таймеры (тесты, остановка сервера) */
    const shutdown = () => {
        for (const t of timers.values()) clearTimer(t);
        for (const t of writeTimers.values()) clearTimer(t);
        timers.clear();
        writeTimers.clear();
        pendingWrite.clear();
        games.clear();
    };

    return { activate, load, move, resign, abort, offerDraw, acceptDraw: (g, u) => answerDraw(g, u, true), declineDraw: (g, u) => answerDraw(g, u, false), snapshot, shutdown, emitToUser, _games: games };
};

module.exports = { createGameManager, hasMatingMaterial, ABORT_TIMEOUT_MS };
