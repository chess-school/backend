'use strict';

/**
 * Доменная схема контента курса-конструктора (Фаза A).
 * Зеркало фронт-контракта new-front/src/features/Courses/types/courseBlocks.ts.
 *
 * Чистые функции, без БД:
 *   - validateCourseContent(input) — валидация+санитайз на ЗАПИСИ (клиенту не верим);
 *   - normalizeCourseContent(modules) — легаси-курсы {lessons[]} → канон {version,chapters[blocks[]]} на ЧТЕНИИ;
 *   - isNewContent(modules) — отличить новый формат от легаси-массива модулей.
 *
 * Хранится в Course.modules (Json на PG). Фаза A: блоки text|puzzle|game.
 */

const crypto = require('crypto');

const CONTENT_VERSION = 1;

// На запись принимаем только реализованные типы Фазы A. blindfold/solveMode — резерв фаз C/E.
const PHASE_A_BLOCK_TYPES = new Set(['text', 'puzzle', 'game']);
const PUZZLE_SOURCES = new Set(['pdf', 'board', 'base', 'manual']);
const GAME_STUDY_MODES = new Set(['free', 'guessMove']);
const ORIENTATIONS = new Set(['white', 'black']);

// Пределы против абьюза/раздувания документа.
const LIMITS = {
    chapters: 100,
    blocksPerChapter: 200,
    puzzlesPerBlock: 500,
    title: 300,
    description: 2000,
    body: 100000,
    pgn: 100000,
    comment: 5000,
    annotations: 1000,
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const newId = () => crypto.randomUUID();

/** Строка с обрезкой по длине; не-строки → ''. */
const clampStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Похоже ли значение на новый формат контента (объект с version или chapters[]). */
function isNewContent(modules) {
    return isObj(modules) && (modules.version === CONTENT_VERSION || Array.isArray(modules.chapters));
}

// ----------------------------------------------------------------- валидация блоков

function validateInlinePuzzle(p, path, errors) {
    const out = { kind: 'inline', _id: typeof p._id === 'string' && p._id ? p._id : newId() };
    if (typeof p.fen !== 'string' || !p.fen.trim()) {
        errors.push(`${path}.fen: обязателен непустой FEN`);
        return null;
    }
    out.fen = p.fen.trim();
    out.title = clampStr(p.title, LIMITS.title);
    out.comment = clampStr(p.comment, LIMITS.comment);
    out.hint = clampStr(p.hint, LIMITS.comment);
    out.solution = clampStr(p.solution, LIMITS.pgn);
    if (p.number !== undefined && Number.isFinite(p.number)) out.number = Math.trunc(p.number);
    if (p.rating !== undefined && Number.isFinite(p.rating)) out.rating = Math.trunc(p.rating);
    if (isObj(p.meta)) {
        const m = {};
        for (const k of ['white', 'black', 'site', 'year', 'opening', 'source']) {
            if (typeof p.meta[k] === 'string') m[k] = clampStr(p.meta[k], LIMITS.title);
        }
        out.meta = m;
    }
    return out;
}

function validatePuzzleBlock(block, path, errors) {
    const source = PUZZLE_SOURCES.has(block.source) ? block.source : 'manual';
    const rawPuzzles = Array.isArray(block.puzzles) ? block.puzzles : [];
    if (rawPuzzles.length > LIMITS.puzzlesPerBlock) {
        errors.push(`${path}.puzzles: не больше ${LIMITS.puzzlesPerBlock} задач в блоке`);
        return null;
    }
    const puzzles = [];
    rawPuzzles.forEach((p, i) => {
        if (!isObj(p)) { errors.push(`${path}.puzzles[${i}]: ожидался объект`); return; }
        if (p.kind === 'ref') {
            if (typeof p.puzzleId !== 'string' || !p.puzzleId) {
                errors.push(`${path}.puzzles[${i}].puzzleId: обязателен для ссылки на базу`);
                return;
            }
            puzzles.push({ kind: 'ref', puzzleId: p.puzzleId });
        } else {
            const v = validateInlinePuzzle(p, `${path}.puzzles[${i}]`, errors);
            if (v) puzzles.push(v);
        }
    });
    if (puzzles.length === 0) {
        errors.push(`${path}: в puzzle-блоке должна быть хотя бы одна задача`);
        return null;
    }
    const out = { source, puzzles };
    if (isObj(block.solveSettings)) out.solveSettings = sanitizeSolveSettings(block.solveSettings);
    return out;
}

function sanitizeSolveSettings(s) {
    const clampNum = (v, def, min, max) => {
        const n = Number.isFinite(v) ? v : def;
        return Math.max(min, Math.min(max, Math.trunc(n)));
    };
    return {
        hintsEnabled: s.hintsEnabled !== false,
        hintUnlockMinutes: clampNum(s.hintUnlockMinutes, 10, 0, 120),
        hintUnlockMistakes: clampNum(s.hintUnlockMistakes, 5, 0, 50),
        allowShowSolution: s.allowShowSolution === true,
        showPlayerNames: s.showPlayerNames !== false,
    };
}

function validateGameBlock(block, path, errors) {
    if (typeof block.pgn !== 'string' || !block.pgn.trim()) {
        errors.push(`${path}.pgn: обязателен непустой PGN`);
        return null;
    }
    const out = {
        pgn: clampStr(block.pgn, LIMITS.pgn),
        study: GAME_STUDY_MODES.has(block.study) ? block.study : 'free',
    };
    if (ORIENTATIONS.has(block.orientation)) out.orientation = block.orientation;
    if (Array.isArray(block.annotations)) {
        out.annotations = block.annotations.slice(0, LIMITS.annotations).map((a) => ({
            moveId: clampStr(a && a.moveId, LIMITS.title),
            comment: clampStr(a && a.comment, LIMITS.comment),
            arrows: Array.isArray(a && a.arrows) ? a.arrows.filter((x) => typeof x === 'string').slice(0, 64) : [],
            squares: Array.isArray(a && a.squares) ? a.squares.filter((x) => typeof x === 'string').slice(0, 64) : [],
        })).filter((a) => a.moveId);
    }
    if (isObj(block.meta)) {
        const m = {};
        for (const k of ['white', 'black', 'event', 'year', 'eco']) {
            if (typeof block.meta[k] === 'string') m[k] = clampStr(block.meta[k], LIMITS.title);
        }
        out.meta = m;
    }
    return out;
}

/** Валидирует один блок; возвращает санитизированный объект или null (с записью в errors). */
function validateBlock(raw, path, errors) {
    if (!isObj(raw)) { errors.push(`${path}: ожидался объект блока`); return null; }
    if (!PHASE_A_BLOCK_TYPES.has(raw.type)) {
        errors.push(`${path}.type: неподдерживаемый тип '${raw.type}' (ожидается text|puzzle|game)`);
        return null;
    }
    const base = {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
        type: raw.type,
    };
    if (typeof raw.title === 'string') base.title = clampStr(raw.title, LIMITS.title);

    let payload = null;
    if (raw.type === 'text') {
        payload = { body: clampStr(raw.body, LIMITS.body) };
    } else if (raw.type === 'puzzle') {
        payload = validatePuzzleBlock(raw, path, errors);
    } else if (raw.type === 'game') {
        payload = validateGameBlock(raw, path, errors);
    }
    if (payload === null) return null;
    return { ...base, ...payload };
}

/**
 * Валидация+санитайз контента курса на запись.
 * Принимает {version,chapters} ИЛИ голый массив глав (лениво).
 * @returns {{ ok: boolean, errors: string[], value: ?object }}
 */
function validateCourseContent(input) {
    const errors = [];
    const chaptersRaw = Array.isArray(input) ? input
        : (isObj(input) && Array.isArray(input.chapters)) ? input.chapters
            : null;
    if (chaptersRaw === null) {
        return { ok: false, errors: ['content: ожидался объект {version,chapters[]} или массив глав'], value: null };
    }
    if (chaptersRaw.length > LIMITS.chapters) {
        return { ok: false, errors: [`content: не больше ${LIMITS.chapters} глав`], value: null };
    }

    const chapters = [];
    chaptersRaw.forEach((ch, ci) => {
        const path = `chapters[${ci}]`;
        if (!isObj(ch)) { errors.push(`${path}: ожидался объект главы`); return; }
        const title = clampStr(ch.title, LIMITS.title).trim();
        if (!title) { errors.push(`${path}.title: обязателен непустой заголовок главы`); return; }
        const blocksRaw = Array.isArray(ch.blocks) ? ch.blocks : [];
        if (blocksRaw.length > LIMITS.blocksPerChapter) {
            errors.push(`${path}.blocks: не больше ${LIMITS.blocksPerChapter} блоков в главе`);
            return;
        }
        const blocks = [];
        blocksRaw.forEach((b, bi) => {
            const vb = validateBlock(b, `${path}.blocks[${bi}]`, errors);
            if (vb) blocks.push(vb);
        });
        chapters.push({
            id: typeof ch.id === 'string' && ch.id ? ch.id : newId(),
            title,
            description: clampStr(ch.description, LIMITS.description),
            blocks,
        });
    });

    if (errors.length) return { ok: false, errors, value: null };
    return { ok: true, errors: [], value: { version: CONTENT_VERSION, chapters } };
}

// ----------------------------------------------------------------- нормализация на чтении

/** Легаси-урок {contentType,content} → блок Фазы A (text). video → text со ссылкой. */
function legacyLessonToBlock(lesson) {
    const title = typeof lesson.title === 'string' ? lesson.title : '';
    const content = isObj(lesson.content) ? lesson.content : {};
    if (lesson.contentType === 'video' && typeof content.videoUrl === 'string' && content.videoUrl) {
        return { id: newId(), type: 'text', title, body: `[video](${content.videoUrl})` };
    }
    // text / quiz / assignment / неизвестно → текстовый блок с тем, что есть
    return { id: newId(), type: 'text', title, body: typeof content.textBody === 'string' ? content.textBody : '' };
}

/**
 * Приводит Course.modules к канону {version,chapters[blocks[]]} для фронта.
 * Новый формат — пропускаем через валидатор (проставит id). Легаси-массив — конвертируем.
 * null/мусор → пустой контент.
 */
function normalizeCourseContent(modules) {
    if (isNewContent(modules)) {
        const v = validateCourseContent(modules);
        return v.ok ? v.value : { version: CONTENT_VERSION, chapters: [] };
    }
    if (Array.isArray(modules)) {
        const chapters = modules.filter(isObj).map((mod) => ({
            id: newId(),
            title: typeof mod.title === 'string' ? mod.title : '',
            description: typeof mod.description === 'string' ? mod.description : '',
            blocks: (Array.isArray(mod.lessons) ? mod.lessons : []).filter(isObj).map(legacyLessonToBlock),
        }));
        return { version: CONTENT_VERSION, chapters };
    }
    return { version: CONTENT_VERSION, chapters: [] };
}

module.exports = {
    CONTENT_VERSION,
    LIMITS,
    isNewContent,
    validateCourseContent,
    normalizeCourseContent,
};
