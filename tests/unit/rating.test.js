// Unit: Glicko-2 (эталон из статьи Гликмана), пересчёт после партии, категории контроля времени, модели
const test = require('node:test');
const assert = require('node:assert/strict');
const { glicko2, rateGame, expectedScore, isProvisional, DEFAULT_RATING } = require('../../v2/utils/ratingCalculator');
const { buildTimeControl, speedOf, PRESETS } = require('../../v2/utils/timeControl');

const close = (actual, expected, eps, what) => assert.ok(Math.abs(actual - expected) <= eps, `${what}: ${actual} ≈ ${expected}`);

test('Glicko-2: пример из статьи (1500/200 против 1400/30 W, 1550/100 L, 1700/300 L, τ=0.5)', () => {
    const r = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [
        { rating: 1400, rd: 30, score: 1 },
        { rating: 1550, rd: 100, score: 0 },
        { rating: 1700, rd: 300, score: 0 },
    ], 0.5);
    close(r.rating, 1464.06, 0.01, 'rating');
    close(r.rd, 151.52, 0.01, 'RD');
    close(r.vol, 0.05999, 0.00001, 'volatility');
});

test('партия: победитель растёт, проигравший падает, сумма изменений ≈ 0 при равных RD', () => {
    const a = { rating: 1600, rd: 80, vol: 0.06 };
    const b = { rating: 1600, rd: 80, vol: 0.06 };
    const win = rateGame(a, b, 1);
    assert.ok(win.diff.white > 0 && win.diff.black < 0);
    assert.ok(Math.abs(win.diff.white + win.diff.black) <= 1);
    assert.ok(win.white.rd < 80, 'после партии неуверенность снижается');

    const draw = rateGame(a, b, 0.5);
    assert.equal(draw.diff.white, 0);
    assert.equal(draw.diff.black, 0);
});

test('сильнее соперник — больше награда; новичок (RD 350) двигается сильнее опытного', () => {
    const me = { rating: 1500, rd: 60, vol: 0.06 };
    const beatStrong = rateGame(me, { rating: 1900, rd: 60, vol: 0.06 }, 1).diff.white;
    const beatWeak = rateGame(me, { rating: 1100, rd: 60, vol: 0.06 }, 1).diff.white;
    assert.ok(beatStrong > beatWeak, `${beatStrong} > ${beatWeak}`);

    const opponent = { rating: 1500, rd: 60, vol: 0.06 };
    const novice = rateGame({ ...DEFAULT_RATING }, opponent, 1).diff.white;
    const veteran = rateGame(me, opponent, 1).diff.white;
    assert.ok(novice > veteran * 3, `новичок ${novice}, опытный ${veteran}`);
    assert.ok(isProvisional(DEFAULT_RATING));
    assert.ok(!isProvisional(me));
});

test('ожидаемый результат: равные — 0.5, сильнее — больше', () => {
    close(expectedScore({ rating: 1500, rd: 50 }, { rating: 1500, rd: 50 }), 0.5, 1e-9, 'E');
    assert.ok(expectedScore({ rating: 1800, rd: 50 }, { rating: 1500, rd: 50 }) > 0.8);
});

test('неверный результат партии — ошибка; рейтинг не уходит за пределы и RD не ниже 45', () => {
    assert.throws(() => rateGame(DEFAULT_RATING, DEFAULT_RATING, 2));
    let p = { rating: 1500, rd: 50, vol: 0.06 };
    for (let i = 0; i < 300; i++) p = rateGame(p, { rating: 1500, rd: 45, vol: 0.06 }, 0.5).white;
    assert.ok(p.rd >= 45);
});

test('контроль времени: пресеты Lichess и категории; кастом — пределы 1–180 мин, 0–60 с', () => {
    const cat = (m, i) => buildTimeControl({ minutes: m, increment: i }).type;
    assert.deepEqual([cat(1, 0), cat(2, 1), cat(3, 0), cat(3, 2), cat(5, 0), cat(5, 3), cat(10, 0), cat(15, 10), cat(30, 0)],
        ['bullet', 'bullet', 'blitz', 'blitz', 'blitz', 'blitz', 'rapid', 'rapid', 'classical']);
    assert.equal(buildTimeControl({ minutes: 3, increment: 2 }).custom, false);
    assert.deepEqual(buildTimeControl({ minutes: 7, increment: 5 }), { type: 'rapid', initialSeconds: 420, incrementSeconds: 5, custom: true });
    assert.equal(speedOf(120, 1), 'bullet');
    for (const bad of [[0, 0], [181, 0], [5, 61], [5, -1], [2.5, 0], ['x', 0]]) {
        assert.equal(buildTimeControl({ minutes: bad[0], increment: bad[1] }), null, `${bad}`);
    }
    assert.equal(PRESETS.length, 9);
});

test('модели: рейтинги по умолчанию 1500/350/0.06 во всех категориях; LiveGame валидирует поля', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit';
    const User = require('../../v2/models/User');
    const LiveGame = require('../../v2/models/LiveGame');
    const u = new User({ firstName: 'A', lastName: 'B', email: 'a@b.io', password: 'x' });
    for (const speed of ['bullet', 'blitz', 'rapid', 'classical']) {
        assert.deepEqual(u.ratings[speed].toObject(), { rating: 1500, rd: 350, vol: 0.06, games: 0 });
    }
    const game = new LiveGame({ createdBy: u._id, timeControl: { type: 'blitz', initialSeconds: 180, incrementSeconds: 2 } });
    assert.equal(game.status, 'created');
    assert.equal(game.fen, LiveGame.START_FEN);
    assert.equal(game.validateSync(), undefined);
    const bad = new LiveGame({ createdBy: u._id, timeControl: { type: 'hyper', initialSeconds: 10, incrementSeconds: 99 }, endReason: 'rage_quit' });
    const errors = Object.keys(bad.validateSync().errors);
    assert.deepEqual(errors.sort(), ['endReason', 'timeControl.incrementSeconds', 'timeControl.initialSeconds', 'timeControl.type']);
});
