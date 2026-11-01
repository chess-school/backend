const puzzleRepo = require('../repositories/puzzle.repo'); // шов content (mongo|pg по CONTENT_DB)

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
};
