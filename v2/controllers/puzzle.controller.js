const { Chess } = require('chess.js');
const puzzleRepo = require('../repositories/puzzle.repo'); // шов content (mongo|pg по CONTENT_DB)

/**
 * Базовая задача Lichess {fen, moves:UCI[]} → inline-упражнение конструктора курса (Фаза B):
 * fen = позиция ПОСЛЕ хода соперника (moves[0]), solution = SAN ходов решения (moves[1..]).
 * Так задача из базы кладётся в курс в том же формате, что и ручные/книжные (self-contained,
 * играется тем же useSolveSession). @returns {object|null} null — если ходы невалидны/коротки.
 */
const toInlineExercise = (p) => {
    try {
        if (!p || !Array.isArray(p.moves) || p.moves.length < 2) return null;
        const chess = new Chess(p.fen);
        const play = (u) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
        if (!play(p.moves[0])) return null; // ход соперника создаёт позицию задачи
        const startFen = chess.fen();
        const san = [];
        for (const u of p.moves.slice(1)) { const m = play(u); if (!m) break; san.push(m.san); }
        if (san.length === 0) return null;
        return {
            _id: String(p._id), title: '', fen: startFen, comment: '', hint: '',
            solution: san.join(' '), rating: p.rating, themes: p.themes || [],
        };
    } catch {
        return null;
    }
};

// @desc    Пакет задач из базы по теме/рейтингу → inline-упражнения (пикер конструктора, Фаза B)
// @route   GET /api/v2/puzzles/pick?theme=&minRating=&maxRating=&count=
// @access  COACH/ADMIN
const pickPuzzles = async (req, res) => {
    const { theme, minRating, maxRating, count } = req.query;
    const puzzles = await puzzleRepo.pickMany({ theme, minRating, maxRating }, count);
    const exercises = puzzles.map(toInlineExercise).filter(Boolean);
    res.json({ data: { exercises } });
};

/** Ответ клиенту: у книжной задачи нет хода соперника перед решением */
const toDto = (puzzle) => ({
    _id: puzzle._id,
    fen: puzzle.fen,
    moves: puzzle.moves,
    rating: puzzle.rating,
    themes: puzzle.themes || [],
    popularity: puzzle.popularity,
    nbPlays: puzzle.nbPlays,
    // true (Lichess): moves[0] — ход соперника, решение начинается с moves[1]
    startsWithOpponentMove: !(puzzle.source && puzzle.source.kind === 'book'),
    source: puzzle.source && puzzle.source.kind === 'book'
        ? {
            kind: 'book',
            book: puzzle.source.book,
            bookTitle: puzzle.source.bookTitle,
            exerciseNumber: puzzle.source.exerciseNumber,
            title: puzzle.source.title,
            sideToMove: puzzle.source.sideToMove,
        }
        : { kind: 'lichess' },
});

// @desc    Случайная задача. Фильтры: minRating/maxRating, source (lichess — по умолчанию | book | all), bookId, exclude
// @route   GET /api/v2/puzzles/random
// @access  Private
const getRandomPuzzle = async (req, res) => {
    // По умолчанию — только Lichess: старые клиенты (рейтинг, выживание) ждут moves[0] = ход соперника
    const { minRating, maxRating, source = 'lichess', bookId, exclude, theme } = req.query;

    // Задачи конкретной книги — всегда книжные, даже без явного source=book.
    // Рейтинговое окно применяется только к Lichess-задачам (у книжных рейтинга Lichess нет);
    // семантику фильтра целиком держит шов puzzle.repo (одинаково для mongo|pg).
    const kind = bookId ? 'book' : source;
    const { count, puzzle } = await puzzleRepo.getRandom({ kind, bookId, exclude, theme, minRating, maxRating });
    if (count === 0) {
        return res.status(404).json({ msg: 'No puzzles match the filters.', code: 'PUZZLE_NOT_FOUND' });
    }
    res.status(200).json({ success: true, data: toDto(puzzle), total: count });
};

// Экспортируем нашу функцию, чтобы ее можно было использовать в файле маршрутов
module.exports = {
    getRandomPuzzle,
    pickPuzzles,
};
