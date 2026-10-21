// v2/controllers/puzzleBook.controller.js

const mongoose = require('mongoose');
const PuzzleBook = require('../models/PuzzleBook');
const { getTask, getReadyChapterFiles, loadChapterExercises } = require('../services/digitizer.service');
const { parseMainline } = require('../utils/pgnMainline');
const { syncBookPuzzles, syncExercisePuzzle, updateBookPuzzlesMeta } = require('../services/bookPuzzle.service');

const STAFF_ROLES = ['COACH', 'ADMIN'];
const isStaff = (user) => user.roles.some((role) => STAFF_ROLES.includes(role));

const MAX_TITLE = 200;
const MAX_TEXT = 20000;

const findVisibleBook = async (req, res, projection) => {
    const { bookId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(bookId)) {
        res.status(404).json({ msg: 'Puzzle book not found.', code: 'BOOK_NOT_FOUND' });
        return null;
    }
    const book = await PuzzleBook.findById(bookId, projection);
    // Черновики видны только тренерам и админам
    if (!book || (book.status !== 'published' && !isStaff(req.user))) {
        res.status(404).json({ msg: 'Puzzle book not found.', code: 'BOOK_NOT_FOUND' });
        return null;
    }
    return book;
};

/** Индекс первого упражнения каждой главы — чтобы открыть редактор сразу на нужной части */
const chapterIndex = (exercises) => {
    const chapters = [];
    exercises.forEach((exercise, index) => {
        const last = chapters[chapters.length - 1];
        if (last && last.filename === exercise.chapter) last.exercisesCount++;
        else chapters.push({ filename: exercise.chapter, firstIndex: index, exercisesCount: 1 });
    });
    return chapters.filter((chapter) => chapter.filename);
};

/**
 * @desc    Создать задачник из готовых глав задачи оцифровщика или дописать в него новые главы.
 *          Работает и пока книга обрабатывается: импортируются только закрытые главы,
 *          повторный вызов добавляет те, что появились с прошлого раза.
 * @route   POST /api/v2/digitizer/tasks/:taskId/course
 * @access  Private (COACH, ADMIN)
 */
const syncFromTask = async (req, res) => {
    const { taskId } = req.params;
    let book = await PuzzleBook.findOne({ 'source.taskId': taskId }, { exercises: 0 });

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (!book && (!title || title.length > MAX_TITLE)) {
        return res.status(400).json({ msg: `Title is required (up to ${MAX_TITLE} characters).`, code: 'VALIDATION_ERROR' });
    }

    // Микросервис сам проверит, что задача принадлежит пользователю (или он admin)
    const task = await getTask(taskId, req.headers.authorization);
    const readyFiles = getReadyChapterFiles(task);
    if (!book && readyFiles.length === 0) {
        return res.status(409).json({ msg: 'No chapters are ready yet — try again in a minute.', code: 'NO_READY_CHAPTERS' });
    }

    if (!book) {
        try {
            book = await PuzzleBook.create({
                title,
                description: typeof req.body.description === 'string' ? req.body.description.slice(0, MAX_TEXT) : '',
                createdBy: req.user.id,
                source: { taskId, importedChapters: [] },
                exercises: [],
            });
        } catch (e) {
            if (e.code !== 11000) throw e;
            // Параллельный запрос успел создать задачник для этой задачи — дописываем в него
            book = await PuzzleBook.findOne({ 'source.taskId': taskId }, { exercises: 0 });
        }
    }

    let added = 0;
    for (const filename of readyFiles) {
        if (book.source.importedChapters.includes(filename)) continue;
        const exercises = await loadChapterExercises(taskId, filename, req.headers.authorization);
        // Атомарно: глава добавляется, только если её ещё нет (защита от двойного клика)
        const updated = await PuzzleBook.findOneAndUpdate(
            { _id: book._id, 'source.importedChapters': { $ne: filename } },
            { $push: { exercises: { $each: exercises }, 'source.importedChapters': filename } },
            { new: true, projection: { exercises: 0 } },
        );
        if (updated) {
            book = updated;
            added += exercises.length;
        }
    }

    // Упражнения с решением становятся задачами раздела «Задачи» (видны ученикам после публикации книги)
    const puzzles = added > 0 ? await syncBookPuzzles(book._id) : null;

    const full = await PuzzleBook.findById(book._id, { 'exercises.chapter': 1, title: 1 });
    res.status(added > 0 && full.exercises.length === added ? 201 : 200).json({
        data: {
            _id: full._id,
            title: full.title,
            exercisesCount: full.exercises.length,
            added,
            chapters: chapterIndex(full.exercises),
            complete: task.status === 'completed' && readyFiles.every((f) => full.exercises.some((e) => e.chapter === f)),
            puzzles: puzzles && { published: puzzles.published, skipped: puzzles.skipped.length },
        },
    });
};

/**
 * @desc    Список задачников (ученикам — только опубликованные)
 * @route   GET /api/v2/puzzle-books
 * @access  Private
 */
const getBooks = async (req, res) => {
    const filter = isStaff(req.user) ? {} : { status: 'published' };
    const books = await PuzzleBook.aggregate([
        { $match: filter },
        { $sort: { createdAt: -1 } },
        {
            $project: {
                title: 1, description: 1, status: 1, createdAt: 1, updatedAt: 1,
                exercisesCount: { $size: '$exercises' },
            },
        },
    ]);
    res.json({ data: books });
};

/**
 * @desc    Задачник со всеми упражнениями
 * @route   GET /api/v2/puzzle-books/:bookId
 * @access  Private
 */
const getBook = async (req, res) => {
    const book = await findVisibleBook(req, res);
    if (!book) return;
    res.json({ data: book });
};

/**
 * @desc    Изменить название, описание или статус задачника
 * @route   PATCH /api/v2/puzzle-books/:bookId
 * @access  Private (COACH, ADMIN)
 */
const updateBook = async (req, res) => {
    const book = await findVisibleBook(req, res, { exercises: 0 });
    if (!book) return;

    const { title, description, status } = req.body;
    if (title !== undefined) {
        if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE) {
            return res.status(400).json({ msg: 'Invalid title.', code: 'VALIDATION_ERROR' });
        }
        book.title = title.trim();
    }
    if (description !== undefined) book.description = String(description).slice(0, MAX_TEXT);
    if (status !== undefined) {
        if (!['draft', 'published'].includes(status)) {
            return res.status(400).json({ msg: 'Invalid status.', code: 'VALIDATION_ERROR' });
        }
        book.status = status;
    }
    await book.save();
    // Опубликованная книга — её задачи появляются в общем потоке «Задачи»; снятая — исчезают
    await updateBookPuzzlesMeta(book);
    res.json({ data: { _id: book._id, title: book.title, description: book.description, status: book.status } });
};

/**
 * @desc    Сохранить правки упражнения (позиция, комментарий, подсказка, решение)
 * @route   PUT /api/v2/puzzle-books/:bookId/exercises/:exerciseId
 * @access  Private (COACH, ADMIN)
 */
const updateExercise = async (req, res) => {
    const { bookId, exerciseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(bookId) || !mongoose.Types.ObjectId.isValid(exerciseId)) {
        return res.status(404).json({ msg: 'Exercise not found.', code: 'EXERCISE_NOT_FOUND' });
    }

    const update = {};
    for (const field of ['title', 'fen', 'comment', 'hint', 'solution']) {
        const value = req.body[field];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.length > MAX_TEXT) {
            return res.status(400).json({ msg: `Invalid field: ${field}.`, code: 'VALIDATION_ERROR' });
        }
        update[`exercises.$.${field}`] = field === 'solution' ? value.trim() : value;
    }
    // Полная проверка FEN и легальности решения — на клиенте (chess.js); здесь только базовая форма
    if (update['exercises.$.fen'] !== undefined && update['exercises.$.fen'].trim().split(/\s+/).length !== 6) {
        return res.status(400).json({ msg: 'FEN must have 6 fields.', code: 'VALIDATION_ERROR' });
    }
    if (update['exercises.$.title'] !== undefined && !update['exercises.$.title'].trim()) {
        return res.status(400).json({ msg: 'Title is required.', code: 'VALIDATION_ERROR' });
    }

    // Позиция и решение проверяются и на сервере: битые данные не должны попасть в базу задач
    if (update['exercises.$.fen'] !== undefined || update['exercises.$.solution'] !== undefined) {
        const current = await PuzzleBook.findOne(
            { _id: bookId, 'exercises._id': exerciseId },
            { exercises: { $elemMatch: { _id: exerciseId } } },
        ).lean();
        if (!current) return res.status(404).json({ msg: 'Exercise not found.', code: 'EXERCISE_NOT_FOUND' });
        const fen = update['exercises.$.fen'] ?? current.exercises[0].fen;
        const solution = update['exercises.$.solution'] ?? current.exercises[0].solution;
        const line = parseMainline(fen, solution);
        if (line.error) {
            const field = line.error.startsWith('Invalid FEN') ? 'fen' : 'solution';
            return res.status(422).json({ msg: line.error, code: 'VALIDATION_ERROR', details: [{ field, message: line.error, location: 'body' }] });
        }
    }

    const book = await PuzzleBook.findOneAndUpdate(
        { _id: bookId, 'exercises._id': exerciseId },
        { $set: update },
        { new: true, projection: { title: 1, status: 1, exercises: { $elemMatch: { _id: exerciseId } } } },
    );
    if (!book) {
        return res.status(404).json({ msg: 'Exercise not found.', code: 'EXERCISE_NOT_FOUND' });
    }
    const puzzle = await syncExercisePuzzle(book, book.exercises[0]);
    res.json({ data: book.exercises[0], puzzle });
};

module.exports = { syncFromTask, getBooks, getBook, updateBook, updateExercise };
