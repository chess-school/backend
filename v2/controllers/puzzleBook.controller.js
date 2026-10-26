// v2/controllers/puzzleBook.controller.js

const mongoose = require('mongoose');
const PuzzleBook = require('../models/PuzzleBook');
const PuzzleAttempt = require('../models/PuzzleAttempt');
const User = require('../models/User');
const Group = require('../models/Group');
const { getTask, getReadyChapterFiles, loadChapterExercises } = require('../services/digitizer.service');
const { parseMainline } = require('../utils/pgnMainline');
const { syncBookPuzzles, syncExercisePuzzle, updateBookPuzzlesMeta } = require('../services/bookPuzzle.service');
const { computeRatingChange, DEFAULT_RATING } = require('../utils/puzzleRatingCalculator');

const STAFF_ROLES = ['COACH', 'ADMIN'];
const isStaff = (user) => user.roles.some((role) => STAFF_ROLES.includes(role));

const MAX_TITLE = 200;
const MAX_TEXT = 20000;

// Поля, по которым решается доступ ученика (Module 1). Гарантируем их присутствие
// в выборке независимо от проекции вызывающего, иначе доступ посчитается неверно.
const ACCESS_FIELDS = ['status', 'visibility', 'allowedUsers', 'allowedGroups', 'isArchived'];

const ensureAccessFields = (projection) => {
    if (!projection) return projection; // полный документ — поля уже есть
    const keys = Object.keys(projection).filter((k) => k !== '_id');
    const isInclusion = keys.some((k) => projection[k] === 1 || projection[k] === true);
    const p = { ...projection };
    if (isInclusion) {
        for (const f of ACCESS_FIELDS) p[f] = 1;        // добавляем нужные поля
    } else {
        for (const f of ACCESS_FIELDS) delete p[f];     // не даём их исключить
    }
    return p;
};

// Доступен ли задачник ученику (не staff). Пустая visibility => старое правило по status.
const studentCanSeeBook = async (req, book) => {
    if (book.isArchived) return false;
    const uid = String(req.user.id);
    switch (book.visibility) {
        case 'public':
            return true;
        case 'private':
            return (book.allowedUsers || []).some((id) => String(id) === uid);
        case 'group': {
            const groups = await Group.find({ members: req.user.id, _id: { $in: book.allowedGroups || [] } }).select('_id').lean();
            return groups.length > 0;
        }
        default: // 'draft' или не задано — обратная совместимость
            return book.status === 'published';
    }
};

const findVisibleBook = async (req, res, projection) => {
    const { bookId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(bookId)) {
        res.status(404).json({ msg: 'Puzzle book not found.', code: 'BOOK_NOT_FOUND' });
        return null;
    }
    const book = await PuzzleBook.findById(bookId, ensureAccessFields(projection));
    if (!book) {
        res.status(404).json({ msg: 'Puzzle book not found.', code: 'BOOK_NOT_FOUND' });
        return null;
    }
    // Тренеры и админы видят все задачники; ученик — по области видимости
    if (!isStaff(req.user) && !(await studentCanSeeBook(req, book))) {
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
                ...(req.club ? { club: req.club } : {}),
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
    let match;
    if (isStaff(req.user)) {
        match = {}; // тренеры и админы видят все задачники (как и раньше)
    } else {
        const userId = new mongoose.Types.ObjectId(String(req.user.id));
        const groups = await Group.find({ members: userId }).select('_id').lean();
        const groupIds = groups.map((g) => g._id);
        const notArchived = { isArchived: { $ne: true } };
        match = { $or: [
            // легаси/публичные: опубликованные и не помеченные как private/group ($nin матчит и отсутствующее поле)
            { status: 'published', visibility: { $nin: ['private', 'group'] }, ...notArchived },
            { visibility: 'public', ...notArchived },
            { visibility: 'private', allowedUsers: userId, ...notArchived },
            { visibility: 'group', allowedGroups: { $in: groupIds }, ...notArchived },
        ] };
    }
    // Изоляция по клубу (#7): если активный клуб определён — только его задачники
    const clubMatch = req.club ? { club: new mongoose.Types.ObjectId(String(req.club)) } : {};
    const books = await PuzzleBook.aggregate([
        { $match: { ...match, ...clubMatch } },
        { $sort: { createdAt: -1 } },
        {
            $project: {
                title: 1, description: 1, status: 1, visibility: 1, isArchived: 1,
                allowedUsersCount: { $size: { $ifNull: ['$allowedUsers', []] } },
                allowedGroupsCount: { $size: { $ifNull: ['$allowedGroups', []] } },
                createdAt: 1, updatedAt: 1,
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

    const { title, description, status, solveSettings } = req.body;
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
    // --- Управление доступом (Module 1) ---
    const { visibility, allowedUsers, allowedGroups, isArchived } = req.body;
    if (visibility !== undefined) {
        if (!['draft', 'private', 'group', 'public'].includes(visibility)) {
            return res.status(400).json({ msg: 'Invalid visibility.', code: 'INVALID_VISIBILITY' });
        }
        book.visibility = visibility;
    }
    if (allowedUsers !== undefined) {
        if (!Array.isArray(allowedUsers) || !allowedUsers.every((id) => mongoose.Types.ObjectId.isValid(id))) {
            return res.status(400).json({ msg: 'allowedUsers must be an array of user IDs.', code: 'VALIDATION_ERROR' });
        }
        book.allowedUsers = allowedUsers;
    }
    if (allowedGroups !== undefined) {
        if (!Array.isArray(allowedGroups) || !allowedGroups.every((id) => mongoose.Types.ObjectId.isValid(id))) {
            return res.status(400).json({ msg: 'allowedGroups must be an array of group IDs.', code: 'VALIDATION_ERROR' });
        }
        book.allowedGroups = allowedGroups;
    }
    if (isArchived !== undefined) book.isArchived = !!isArchived;
    // Настройки режима решения — частичное обновление: присланные поля перекрывают текущие (с клампом)
    if (solveSettings !== undefined && solveSettings && typeof solveSettings === 'object') {
        const cur = (book.solveSettings && book.solveSettings.toObject) ? book.solveSettings.toObject() : (book.solveSettings || {});
        const clampInt = (v, lo, hi, dflt) => {
            const n = Math.round(Number(v));
            return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
        };
        const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
        book.solveSettings = {
            hintsEnabled: bool(solveSettings.hintsEnabled, cur.hintsEnabled ?? true),
            hintUnlockMinutes: solveSettings.hintUnlockMinutes !== undefined ? clampInt(solveSettings.hintUnlockMinutes, 0, 180, cur.hintUnlockMinutes ?? 10) : (cur.hintUnlockMinutes ?? 10),
            hintUnlockMistakes: solveSettings.hintUnlockMistakes !== undefined ? clampInt(solveSettings.hintUnlockMistakes, 0, 50, cur.hintUnlockMistakes ?? 5) : (cur.hintUnlockMistakes ?? 5),
            allowShowSolution: bool(solveSettings.allowShowSolution, cur.allowShowSolution ?? false),
            showPlayerNames: bool(solveSettings.showPlayerNames, cur.showPlayerNames ?? true),
        };
    }
    await book.save();
    // Опубликованная книга — её задачи появляются в общем потоке «Задачи»; снятая — исчезают
    await updateBookPuzzlesMeta(book);
    res.json({ data: { _id: book._id, title: book.title, description: book.description, status: book.status,
        visibility: book.visibility, allowedUsers: book.allowedUsers, allowedGroups: book.allowedGroups,
        isArchived: book.isArchived, solveSettings: book.solveSettings } });
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

/**
 * @desc    Зафиксировать попытку решения упражнения (для модуля статистики)
 * @route   POST /api/v2/puzzle-books/:bookId/attempts
 * @access  Private (любой авторизованный — ученик)
 */
const recordAttempt = async (req, res) => {
    // Проекция включает status (нужен findVisibleBook для проверки публикации) и rating упражнений (пересчёт Elo, Module 4)
    const book = await findVisibleBook(req, res, { status: 1, 'exercises._id': 1, 'exercises.rating': 1 });
    if (!book) return;
    const { exerciseId } = req.body;
    const exercise = book.exercises.find((e) => String(e._id) === String(exerciseId));
    if (!exercise) {
        return res.status(400).json({ msg: 'Unknown exercise.', code: 'VALIDATION_ERROR' });
    }
    const num = (v, hi) => Math.min(hi, Math.max(0, Math.round(Number(v)) || 0));
    const solved = req.body.solved !== false;
    const usedHint = req.body.usedHint === true;
    const mistakes = num(req.body.attemptsCount, 100000);

    await PuzzleAttempt.create({
        student: req.user.id,
        puzzleBook: book._id,
        exerciseId: String(exerciseId),
        solved,
        timeTakenSeconds: num(req.body.timeTakenSeconds, 86400),
        attemptsCount: mistakes,
        usedHint,
    });

    // --- Динамический рейтинг (Module 4) ---
    // Успех засчитывается только при решении с 1-й попытки без подсказок.
    const success = solved && !usedHint && mistakes === 0;

    const userDoc = await User.findById(req.user.id).select('puzzleRating puzzleRatingGames');
    const userRating = (userDoc && Number.isFinite(userDoc.puzzleRating)) ? userDoc.puzzleRating : DEFAULT_RATING;
    const puzzleRating = Number.isFinite(exercise.rating) ? exercise.rating : DEFAULT_RATING;

    const change = computeRatingChange({ userRating, puzzleRating, success });

    // Персист: рейтинг ученика и рейтинг конкретного упражнения (атомарно через позиционный $)
    await Promise.all([
        User.updateOne({ _id: req.user.id }, { $set: { puzzleRating: change.newUserRating }, $inc: { puzzleRatingGames: 1 } }),
        PuzzleBook.updateOne(
            { _id: book._id, 'exercises._id': exerciseId },
            { $set: { 'exercises.$.rating': change.newPuzzleRating }, $inc: { 'exercises.$.ratingAttempts': 1 } },
        ),
    ]);

    res.status(201).json({ data: {
        ok: true,
        rating: {
            success,
            userDelta: change.userDelta,
            puzzleDelta: change.puzzleDelta,
            userRating: change.newUserRating,
            userRatingBefore: userRating,
            puzzleRating: change.newPuzzleRating,
            puzzleRatingBefore: puzzleRating,
        },
    } });
};

/**
 * @desc    Статистика решения задачника по ученикам (прогресс для тренера)
 * @route   GET /api/v2/puzzle-books/:bookId/stats
 * @access  Private (COACH, ADMIN)
 */
const getBookStats = async (req, res) => {
    const book = await findVisibleBook(req, res, { 'exercises._id': 1 });
    if (!book) return;
    const bookId = new mongoose.Types.ObjectId(String(book._id));
    // Сначала сворачиваем попытки до «лучшего» по каждому упражнению ученика, затем агрегируем по ученику
    const rows = await PuzzleAttempt.aggregate([
        { $match: { puzzleBook: bookId } },
        { $group: {
            _id: { student: '$student', exercise: '$exerciseId' },
            solved: { $max: { $cond: ['$solved', 1, 0] } },
            attempts: { $sum: 1 },
            mistakes: { $sum: '$attemptsCount' },
            time: { $sum: '$timeTakenSeconds' },
            hint: { $max: { $cond: ['$usedHint', 1, 0] } },
            last: { $max: '$updatedAt' },
        } },
        { $group: {
            _id: '$_id.student',
            solvedCount: { $sum: '$solved' },
            exercisesAttempted: { $sum: 1 },
            attempts: { $sum: '$attempts' },
            totalMistakes: { $sum: '$mistakes' },
            totalTimeSeconds: { $sum: '$time' },
            hintsUsed: { $sum: '$hint' },
            lastActivity: { $max: '$last' },
        } },
        { $sort: { lastActivity: -1 } },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } })
        .select('firstName lastName email uuid').lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const students = rows.map((r) => ({
        student: byId.get(String(r._id)) || { _id: r._id, firstName: '', lastName: '', email: '' },
        solvedCount: r.solvedCount,
        exercisesAttempted: r.exercisesAttempted,
        attempts: r.attempts,
        totalMistakes: r.totalMistakes,
        totalTimeSeconds: r.totalTimeSeconds,
        hintsUsed: r.hintsUsed,
        lastActivity: r.lastActivity,
    }));
    res.json({ data: { totalExercises: book.exercises.length, students } });
};

module.exports = { syncFromTask, getBooks, getBook, updateBook, updateExercise, recordAttempt, getBookStats };
