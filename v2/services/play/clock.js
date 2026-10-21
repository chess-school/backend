// v2/services/play/clock.js
//
// Авторитетные шахматные часы (сервер). Чистый объект без таймеров: текущее время передаётся
// параметром now (мс), поэтому списание точно проверяется в тестах.
// Правила (как на Lichess):
//   — часы не идут, пока обе стороны не сделали первый ход (ply < 2): до этого действует
//     таймер отмены партии (abortTimeoutMs в gameManager);
//   — после хода с остатка ходившего списывается время его хода, затем добавляется инкремент;
//   — ход, пришедший после падения флага, не принимается: флаг уже упал (flagged).

class GameClock {
    constructor({ initialMs, incrementMs, whiteMs = initialMs, blackMs = initialMs, turn = 'white', turnStartedAt = null }) {
        this.initialMs = initialMs;
        this.incrementMs = incrementMs;
        this.ms = { white: whiteMs, black: blackMs };
        this.turn = turn;
        /** null — часы стоят */
        this.turnStartedAt = turnStartedAt;
    }

    get running() {
        return this.turnStartedAt !== null;
    }

    /** Остаток стороны на момент now (у стороны, чей ход, идёт время) */
    remaining(color, now) {
        if (color === this.turn && this.running) return Math.max(0, this.ms[color] - (now - this.turnStartedAt));
        return this.ms[color];
    }

    /** Упал ли флаг стороны, чей ход */
    flagged(now) {
        return this.running && this.remaining(this.turn, now) <= 0;
    }

    /** Через сколько мс упадёт флаг (Infinity — часы стоят) */
    msToFlag(now) {
        return this.running ? this.remaining(this.turn, now) : Infinity;
    }

    /**
     * Ход сделан стороной turn в момент now. startClock — запускать ли часы соперника после хода
     * (false для первых ходов, ply < 2). Возвращает { flagged } — ход опоздал, флаг упал раньше.
     */
    press(now, { startClock = true } = {}) {
        const mover = this.turn;
        if (this.running) {
            const left = this.ms[mover] - (now - this.turnStartedAt);
            if (left <= 0) {
                this.ms[mover] = 0;
                return { flagged: true };
            }
            this.ms[mover] = left + this.incrementMs;
        }
        this.turn = mover === 'white' ? 'black' : 'white';
        this.turnStartedAt = startClock ? now : null;
        return { flagged: false };
    }

    /** Остановить часы (конец партии) — время стороны, чей ход, фиксируется */
    stop(now) {
        if (this.running) this.ms[this.turn] = this.remaining(this.turn, now);
        this.turnStartedAt = null;
    }

    /** Снимок для клиента: остатки на момент now; клиент сам «тикает» от serverNow */
    snapshot(now) {
        return {
            whiteMs: this.remaining('white', now),
            blackMs: this.remaining('black', now),
            turn: this.turn,
            running: this.running,
            serverNow: now,
        };
    }

    /** Для записи в БД: остатки на начало текущего хода и время его начала */
    toDocument() {
        return { whiteMs: this.ms.white, blackMs: this.ms.black, turnStartedAt: this.turnStartedAt ? new Date(this.turnStartedAt) : null };
    }
}

module.exports = { GameClock };
