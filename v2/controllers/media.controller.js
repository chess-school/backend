// media.controller.js — медиатека клуба (шаг 2 плана сайтов клубов).
//   POST   /api/v2/site/media          — загрузить изображение (персонал своего клуба)
//   GET    /api/v2/site/media          — список медиа активного клуба
//   DELETE /api/v2/site/media/:id      — удалить своё медиа
//   GET    /api/v2/site/media/file/*   — ПУБЛИЧНАЯ отдача файла (драйвер mongo)
//
// Изоляция: list/delete всегда скоупятся по req.club (клуб B не видит и не удаляет медиа клуба A,
// даже подставив чужой id — вернётся 404). Байты файлов публичны — это картинки сайта.

const MediaAsset = require('../models/MediaAsset');
const mediaService = require('../services/media.service');
const storage = require('../services/storage');
const { unprocessable, notFound } = require('../utils/apiError');

/** @route POST /api/v2/site/media — загрузить изображение в медиатеку активного клуба. */
const uploadMedia = async (req, res) => {
    if (!req.file) {
        throw unprocessable('Provide an image file.', 'FILE_REQUIRED', [{ field: 'file', message: 'An image file is required', location: 'body' }]);
    }
    const alt = typeof req.body.alt === 'string' ? req.body.alt.trim().slice(0, 300) : '';
    const asset = await mediaService.createFromUpload({ club: req.club, userId: req.user.id, file: req.file, alt });
    res.status(201).json({ data: mediaService.toPublic(asset) });
};

/** @route GET /api/v2/site/media — лента медиатеки активного клуба (свежие сверху). */
const listMedia = async (req, res) => {
    const { items, total, page, limit } = await mediaService.list({ club: req.club, page: req.query.page, limit: req.query.limit });
    res.json({ data: items.map(mediaService.toPublic), meta: { total, page, limit } });
};

/** @route DELETE /api/v2/site/media/:id — удалить медиа своего клуба (файлы + запись). */
const deleteMedia = async (req, res) => {
    const asset = await MediaAsset.findOne({ _id: req.params.id, club: req.club }).lean();
    if (!asset) throw notFound('Media not found.', 'MEDIA_NOT_FOUND');
    await mediaService.remove(asset);
    res.json({ data: { deleted: true, id: req.params.id } });
};

/** @route GET /api/v2/site/media/file/* — отдать файл по ключу (драйвер mongo). ПУБЛИЧНО. */
const serveFile = async (req, res) => {
    const key = req.params[0];
    if (!key) return res.status(404).json({ msg: 'Not found.', code: 'MEDIA_NOT_FOUND' });
    const blob = await storage.read(key);
    if (!blob) return res.status(404).json({ msg: 'Not found.', code: 'MEDIA_NOT_FOUND' });
    res.setHeader('Content-Type', blob.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(blob.data);
};

module.exports = { uploadMedia, listMedia, deleteMedia, serveFile };
