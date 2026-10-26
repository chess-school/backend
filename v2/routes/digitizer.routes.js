// v2/routes/digitizer.routes.js

const express = require('express');
const http = require('http');
const https = require('https');
const router = express.Router();
const authMiddleware = require('../middleware/authV2.middleware');
const roleMiddleware = require('../middleware/roleV2.middleware');
const errorHandler = require('../middleware/errorHandlerV2');
const puzzleBookController = require('../controllers/puzzleBook.controller');
const { DIGITIZER_URL } = require('../services/digitizer.service');

// Сессия и роли проверяются здесь по БД; микросервис ещё раз проверит подпись токена и роль
router.use(authMiddleware);
router.use(require('../middleware/resolveClubV2.middleware'));
router.use(roleMiddleware(['COACH', 'ADMIN']));

// Тайм-аут простоя соединения с микросервисом: загрузка книги — 5 мин без единого байта
// (общая длительность не ограничена, медленный канал не обрывается), остальные запросы — 30 с
const UPLOAD_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 1000;

// Заголовки ответа микросервиса, которые отдаём клиенту как есть
const PASSTHROUGH_HEADERS = ['content-type', 'content-disposition', 'content-length'];

const sendError = (res, status, message) => {
    if (!res.headersSent) res.status(status).json({ message });
    else res.destroy();
};

/**
 * Пробрасывает запрос в микросервис через http(s).request: тело (multipart с PDF) идёт потоком
 * req -> микросервис без буферизации, ответ — потоком обратно. Authorization сохраняется.
 */
const proxyTo = (buildPath, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS) => (req, res) => {
    const target = new URL(`${DIGITIZER_URL}${buildPath(req)}`);
    const headers = { authorization: req.headers.authorization };
    for (const name of ['content-type', 'content-length']) {
        if (req.headers[name]) headers[name] = req.headers[name];
    }

    const client = target.protocol === 'https:' ? https : http;
    let responded = false;
    const upstream = client.request(target, { method: req.method, headers }, (upstreamRes) => {
        responded = true;
        const status = upstreamRes.statusCode;
        // 401 микросервиса — рассинхрон JWT_SECRET, а не истёкшая сессия сайта:
        // клиенту не отдаём 401, иначе фронтенд разлогинит пользователя
        if (status === 401) {
            upstreamRes.resume();
            return sendError(res, 502, req.t('controllers.digitizer.tokenRejected'));
        }
        res.status(status);
        PASSTHROUGH_HEADERS.forEach((name) => {
            if (upstreamRes.headers[name]) res.setHeader(name, upstreamRes.headers[name]);
        });
        upstreamRes.pipe(res);
    });

    upstream.setTimeout(idleTimeoutMs, () => {
        upstream.destroy(new Error(`no data for ${idleTimeoutMs / 1000} s`));
    });
    upstream.on('error', (e) => {
        // Микросервис уже ответил (например, 413 до конца загрузки) и закрыл соединение —
        // ошибка записи остатка тела не должна подменять его ответ; остаток просто сливаем
        req.unpipe(upstream);
        req.resume();
        if (responded) return;
        console.error('Digitizer proxy error:', e.message);
        sendError(res, e.message.startsWith('no data') ? 504 : 502, req.t('controllers.digitizer.unavailable'));
    });
    // Клиент закрыл вкладку или оборвал загрузку — не держим соединение с микросервисом
    res.on('close', () => {
        if (!res.writableFinished) upstream.destroy();
    });

    if (['GET', 'HEAD'].includes(req.method)) upstream.end();
    else req.pipe(upstream);
};

/**
 * @route   POST /api/v2/digitizer/digitize
 * @desc    Загрузить PDF (multipart: file, pages_range, solutions_pages?, max_per_file?).
 *          Отвечает 202 { task_id } сразу после сохранения файла — распознавание идёт в фоне.
 * @access  Private (COACH, ADMIN)
 */
router.post('/digitize', proxyTo(() => '/api/v1/digitize', UPLOAD_IDLE_TIMEOUT_MS));

/**
 * @route   GET /api/v2/digitizer/tasks/:taskId
 * @desc    Статус задачи оцифровки, включая ready_chapters — главы, готовые до окончания книги
 * @access  Private (COACH, ADMIN)
 */
router.get('/tasks/:taskId', proxyTo((req) =>
    `/api/v1/tasks/${encodeURIComponent(req.params.taskId)}`));

/**
 * @route   GET /api/v2/digitizer/tasks/:taskId/download/:filename
 * @desc    Скачать PGN-файл (или лог) задачи
 * @access  Private (COACH, ADMIN)
 */
router.get('/tasks/:taskId/download/:filename', proxyTo((req) =>
    `/api/v1/tasks/${encodeURIComponent(req.params.taskId)}/download/${encodeURIComponent(req.params.filename)}`));

/**
 * @route   POST /api/v2/digitizer/tasks/:taskId/course
 * @desc    Создать задачник из готовых глав задачи или дописать в него новые главы
 *          (можно вызывать, пока книга ещё обрабатывается). Body: { title, description? }
 * @access  Private (COACH, ADMIN)
 */
router.post('/tasks/:taskId/course', errorHandler(puzzleBookController.syncFromTask));

module.exports = router;
