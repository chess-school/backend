// Импортируем модель, чтобы контроллер мог работать с базой данных
const mongoose = require('mongoose');
const Puzzle = require('../models/Puzzle');

// Задача Lichess (нет source) или задача опубликованной оцифрованной книги
const VISIBLE = { $or: [{ 'source.kind': { $exists: false } }, { 'source.published': true }] };

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

    // Задачи конкретной книги — всегда книжные, даже без явного source=book
    const kind = bookId ? 'book' : source;
    const filter = { $and: [VISIBLE] };
    if (kind === 'lichess') filter.$and.push({ 'source.kind': { $exists: false } });
    if (kind === 'book') filter.$and.push({ 'source.kind': 'book' });
    if (bookId) filter.$and.push({ 'source.book': new mongoose.Types.ObjectId(bookId) });
    if (theme) filter.$and.push({ themes: theme });

    // Рейтинговое окно — свойство задач Lichess. У книжных задач рейтинга Lichess нет (у всех 1500),
    // поэтому в режимах «Рейтинг»/«Выживание» с источником «книги» окно не применяется,
    // а для «все» — применяется только к задачам Lichess, книжные идут без него
    if ((minRating !== undefined || maxRating !== undefined) && kind !== 'book') {
        const rating = {};
        if (minRating !== undefined) rating.$gte = minRating;
        if (maxRating !== undefined) rating.$lte = maxRating;
        filter.$and.push(kind === 'all'
            ? { $or: [{ 'source.kind': 'book' }, { rating }] }
            : { rating });
    }
    // Не показывать подряд ту же задачу
    if (exclude) filter._id = { $ne: exclude };

    const count = await Puzzle.countDocuments(filter);
    if (count === 0) {
        return res.status(404).json({ msg: 'No puzzles match the filters.', code: 'PUZZLE_NOT_FOUND' });
    }
    const puzzle = await Puzzle.findOne(filter).skip(Math.floor(Math.random() * count)).lean();
    res.status(200).json({ success: true, data: toDto(puzzle), total: count });
};

// Экспортируем нашу функцию, чтобы ее можно было использовать в файле маршрутов
module.exports = {
    getRandomPuzzle,
};
