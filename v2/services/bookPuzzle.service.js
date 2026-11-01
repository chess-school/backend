// v2/services/bookPuzzle.service.js
//
// Публикация упражнений оцифрованных книг (PuzzleBook) в общую базу задач (Puzzle),
// откуда их берёт раздел «Задачи» (/puzzles). Одна задача на упражнение: _id = `book-<exerciseId>`.
//
//   - задача создаётся/обновляется для каждого упражнения с корректным решением;
//   - упражнение без решения или с нелегальным ходом в решении задачей не становится (skipped);
//   - ученики видят задачи только опубликованных книг (source.published).
// Синхронизация идемпотентна: её можно вызывать после импорта глав, правки упражнения и смены статуса.

const puzzleRepo = require('../repositories/puzzle.repo'); // шов content (mongo|pg по CONTENT_DB)
const puzzleBookRepo = require('../repositories/puzzleBook.repo'); // шов content
const { parseMainline } = require('../utils/pgnMainline');

// У книжных задач нет рейтинга Lichess; ставим средний, чтобы они не выпадали из рейтинговых фильтров
const BOOK_PUZZLE_RATING = 1500;

const puzzleIdFor = (exerciseId) => `book-${exerciseId}`;

/**
 * Упражнение -> документ Puzzle или причина, по которой задачи из него не будет.
 * @returns {{ puzzle?: object, skipped?: { reason: string, detail?: string } }}
 */
const exerciseToPuzzle = (book, exercise) => {
    if (!exercise.solution || !exercise.solution.trim()) {
        return { skipped: { reason: 'no_solution' } };
    }
    const line = parseMainline(exercise.fen, exercise.solution);
    if (line.error) return { skipped: { reason: 'invalid_solution', detail: line.error } };
    if (line.uci.length === 0) return { skipped: { reason: 'no_solution' } };

    return {
        puzzle: {
            _id: puzzleIdFor(exercise._id),
            fen: exercise.fen,
            moves: line.uci,
            rating: BOOK_PUZZLE_RATING,
            themes: ['fromBook', line.sideToMove === 'w' ? 'whiteToMove' : 'blackToMove'],
            source: {
                kind: 'book',
                book: book._id,
                bookTitle: book.title,
                exercise: exercise._id,
                exerciseNumber: exercise.number,
                title: exercise.title,
                sideToMove: line.sideToMove,
                solutionSan: line.san,
                published: book.status === 'published',
            },
        },
    };
};

/**
 * Полная синхронизация задач книги: создать/обновить корректные, удалить задачи упражнений,
 * которые задачей быть перестали (решение удалено/испорчено, упражнение исчезло).
 * @returns {{ published: number, skipped: Array<{ exerciseId, title, reason, detail? }> }}
 */
const syncBookPuzzles = async (bookId) => {
    const book = await puzzleBookRepo.findById(bookId, { select: 'title status exercises' });
    if (!book) return { published: 0, skipped: [] };

    const puzzles = [];
    const keepIds = [];
    const skipped = [];
    for (const exercise of book.exercises) {
        const { puzzle, skipped: why } = exerciseToPuzzle(book, exercise);
        if (puzzle) {
            keepIds.push(puzzle._id);
            puzzles.push(puzzle);
        } else {
            skipped.push({ exerciseId: exercise._id, title: exercise.title, ...why });
        }
    }
    await puzzleRepo.replaceManyBookPuzzles(puzzles);
    await puzzleRepo.deleteBookPuzzlesExcept(book._id, keepIds);
    return { published: puzzles.length, skipped };
};

/** Синхронизация одного упражнения после правки в редакторе */
const syncExercisePuzzle = async (book, exercise) => {
    const { puzzle, skipped } = exerciseToPuzzle(book, exercise);
    if (puzzle) {
        await puzzleRepo.upsertPuzzle(puzzle);
        return { published: true };
    }
    await puzzleRepo.deleteById(puzzleIdFor(exercise._id));
    return { published: false, ...skipped };
};

/** Публикация/снятие книги и смена названия отражаются на её задачах */
const updateBookPuzzlesMeta = async (book) => {
    await puzzleRepo.updateBookPuzzlesMeta(book._id, { published: book.status === 'published', bookTitle: book.title });
};

module.exports = {
    BOOK_PUZZLE_RATING,
    puzzleIdFor,
    exerciseToPuzzle,
    syncBookPuzzles,
    syncExercisePuzzle,
    updateBookPuzzlesMeta,
};
