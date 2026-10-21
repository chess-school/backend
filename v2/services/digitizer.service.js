// v2/services/digitizer.service.js

// Микросервис оцифровки PDF-книг (chess_pdf_digitizer, FastAPI)
const DIGITIZER_URL = (process.env.DIGITIZER_URL || 'http://localhost:8000').replace(/\/+$/, '');

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/**
 * GET к микросервису от имени пользователя (его Authorization пробрасывается как есть).
 * Ошибки микросервиса превращаются в исключения со statusCode для errorHandlerV2.
 */
const fetchFromDigitizer = async (path, authorization, as = 'json') => {
    let response;
    try {
        response = await fetch(`${DIGITIZER_URL}${path}`, { headers: { authorization } });
    } catch (e) {
        throw httpError(502, 'Digitizer service is unavailable.');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        // 401 от микросервиса означает рассинхрон JWT_SECRET, а не истёкшую сессию сайта:
        // не отдаём его клиенту как 401, иначе фронтенд разлогинит пользователя
        const status = response.status === 401 ? 502 : response.status;
        throw httpError(status, body.detail || `Digitizer error ${response.status}`);
    }
    return as === 'text' ? response.text() : response.json();
};

const getTask = (taskId, authorization) =>
    fetchFromDigitizer(`/api/v1/tasks/${encodeURIComponent(taskId)}`, authorization);

const getTaskFile = (taskId, filename, authorization) =>
    fetchFromDigitizer(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/download/${encodeURIComponent(filename)}`,
        authorization,
        'text',
    );

// =================================================================
//                 РАЗБОР PGN-ФАЙЛОВ ОЦИФРОВЩИКА
// =================================================================

const RESULT_TOKEN = /\s*(\*|1-0|0-1|1\/2-1\/2)\s*$/;
// Комментарий, который оцифровщик ставит позициям без решения — в задачнике он лишний
const AUTO_COMMENT = /^(White|Black) to move\.$/;

/** Делит PGN-файл на партии: { headers, movetext }. Строки заголовков внутри {комментариев} не учитываются. */
const splitPgnGames = (text) => {
    const games = [];
    let current = null;
    let braceDepth = 0;

    for (const line of text.split(/\r?\n/)) {
        const header = braceDepth === 0 && line.match(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/);
        if (header) {
            if (!current || current.movetext.trim()) {
                current = { headers: {}, movetext: '' };
                games.push(current);
            }
            current.headers[header[1]] = header[2].replace(/\\(["\\])/g, '$1');
            continue;
        }
        if (!current) continue;
        current.movetext += `${line}\n`;
        for (const ch of line) {
            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
        }
    }
    return games;
};

/** Партия оцифровщика -> упражнение задачника. Ведущий {комментарий} становится описанием. */
const gameToExercise = ({ headers, movetext }) => {
    let body = movetext.trim().replace(RESULT_TOKEN, '').trim();
    let comment = '';
    if (body.startsWith('{')) {
        const end = body.indexOf('}');
        if (end !== -1) {
            comment = body.slice(1, end).trim();
            body = body.slice(end + 1).trim();
        }
    }
    if (AUTO_COMMENT.test(comment)) comment = '';

    const event = headers.Event || '';
    const numberMatch = event.match(/^Exercise\s+(\d+)/i);
    const year = (headers.Date || '').split('.')[0];
    const clean = (v) => (v && v !== '?' ? v : undefined);

    return {
        number: numberMatch ? Number(numberMatch[1]) : undefined,
        title: event || 'Exercise',
        fen: headers.FEN || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        comment,
        hint: '',
        solution: body.replace(/\s+/g, ' '),
        meta: {
            white: clean(headers.White),
            black: clean(headers.Black),
            site: clean(headers.Site),
            year: /^\d{4}$/.test(year) ? year : undefined,
            opening: clean(headers.Opening),
            source: clean(headers.Source),
        },
    };
};

/**
 * Готовые PGN-главы задачи по порядку. Закрытая глава больше не меняется, поэтому её можно
 * импортировать, пока книга ещё обрабатывается (и даже если обработка потом упала).
 */
const getReadyChapterFiles = (task) => {
    if (Array.isArray(task.ready_chapters) && task.ready_chapters.length > 0) {
        return task.ready_chapters.map((chapter) => chapter.filename);
    }
    // Задачи, созданные до появления ready_chapters: файлы доступны только после завершения
    return task.status === 'completed' ? task.files : [];
};

/** Скачивает одну главу и превращает её в упражнения; chapter запоминает, откуда упражнение. */
const loadChapterExercises = async (taskId, filename, authorization) => {
    const text = await getTaskFile(taskId, filename, authorization);
    return splitPgnGames(text).map((game) => ({ ...gameToExercise(game), chapter: filename }));
};

module.exports = {
    DIGITIZER_URL, httpError, getTask, getReadyChapterFiles, loadChapterExercises, splitPgnGames, gameToExercise,
};
