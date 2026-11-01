// services/storage/mongo.driver.js — драйвер хранилища «байты в MongoDB» (по умолчанию).
// Пишет/читает/удаляет документы MediaBlob. Публичная ссылка указывает на наш отдающий роут
// GET /api/v2/site/media/file/<key>. Базовый префикс можно переопределить через MEDIA_PUBLIC_BASE
// (напр., абсолютный https://chess.motorcycles/api/v2/site/media/file) — иначе относительный путь,
// который корректно резолвится, когда SPA и API на одном домене (прод за nginx).

const MediaBlob = require('../../models/MediaBlob');

const base = () => (process.env.MEDIA_PUBLIC_BASE || '/api/v2/site/media/file').replace(/\/+$/, '');

const put = async ({ key, body, contentType, club }) => {
    await MediaBlob.findOneAndUpdate(
        { key },
        { $set: { key, club, contentType, data: body } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return { url: `${base()}/${key}` };
};

const remove = async (keys) => {
    if (!keys || !keys.length) return;
    await MediaBlob.deleteMany({ key: { $in: keys } });
};

const read = async (key) => {
    const blob = await MediaBlob.findOne({ key }).lean();
    if (!blob || !blob.data) return null;
    const data = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data.buffer || blob.data);
    return { data, contentType: blob.contentType || 'application/octet-stream' };
};

module.exports = { name: 'mongo', put, remove, read };
