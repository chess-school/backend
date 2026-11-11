// services/media.service.js — медиатека клуба (шаг 2): обработка картинки и работа с MediaAsset.
//
// Загруженное изображение сжимается в WebP и раскладывается на размеры thumb/medium/large
// (не увеличивая оригинал и не дублируя одинаковые размеры). Каждый вариант кладётся в хранилище
// (storage: mongo или S3/R2), в MediaAsset сохраняются только метаданные и ссылки.
//
// sharp подгружается лениво и с мягким фолбэком: если пакет недоступен — оригинал сохраняется
// как единственный вариант, фича не падает (но без сжатия/ресайза).
// Анимированные GIF не ресайзим в webp (убило бы анимацию) — храним оригинал как есть.

const crypto = require('crypto');
const MediaAsset = require('../models/MediaAsset');
const storage = require('./storage');
const { unprocessable } = require('../utils/apiError');

// Реальные форматы изображений, которые принимаем (определяются по содержимому через sharp,
// а НЕ по присланному Content-Type, который подделывается).
const REAL_IMAGE_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif', 'avif']);

// Пытаемся получить sharp один раз; при неудаче работаем в режиме «без обработки».
let _sharp;
const getSharp = () => {
    if (_sharp !== undefined) return _sharp;
    try { _sharp = require('sharp'); } catch { _sharp = null; }
    return _sharp;
};

const TARGETS = [
    { name: 'thumb', width: 400 },
    { name: 'medium', width: 1024 },
    { name: 'large', width: 1920 },
];

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

const makeKey = (club, name, ext) =>
    `media/${club}/${crypto.randomBytes(6).toString('hex')}/${name}.${ext}`;

// Сохранить один буфер в хранилище и вернуть метаданные варианта.
const putVariant = async ({ club, name, body, contentType, width, height }) => {
    const ext = EXT_BY_MIME[contentType] || 'bin';
    const key = makeKey(club, name, ext);
    const { url } = await storage.put({ key, body, contentType, club });
    return { key, url, width: width || 0, height: height || 0, size: body.length };
};

// Разложить картинку на варианты. Возвращает { variants, width, height, mimeType }.
const buildVariants = async ({ club, buffer, originalMime }) => {
    const sharp = getSharp();

    // Фолбэк без sharp ИЛИ анимированный gif → храним оригинал одним вариантом.
    const storeOriginal = async () => {
        const v = await putVariant({ club, name: 'large', body: buffer, contentType: originalMime });
        return { variants: { large: v }, width: v.width, height: v.height, mimeType: originalMime };
    };

    if (!sharp) return storeOriginal();

    // При живом sharp НЕ храним произвольные байты: файл обязан парситься как настоящее изображение
    // известного формата — иначе HTML/SVG под видом image/* попал бы в хранилище (stored XSS).
    let meta;
    try { meta = await sharp(buffer, { failOn: 'none' }).metadata(); }
    catch { throw unprocessable('The uploaded file is not a valid image.', 'INVALID_IMAGE'); }
    if (!meta.format || !REAL_IMAGE_FORMATS.has(meta.format)) {
        throw unprocessable('Unsupported image format.', 'INVALID_IMAGE');
    }

    // Анимацию (многокадровый gif) не трогаем.
    if (originalMime === 'image/gif' && (meta.pages || 1) > 1) return storeOriginal();

    const origW = meta.width || 0;
    const variants = {};
    let lastWidth = 0;

    for (const tgt of TARGETS) {
        const targetW = origW ? Math.min(tgt.width, origW) : tgt.width;
        // Не плодим одинаковые размеры (маленькая картинка → достаточно thumb).
        if (tgt.name !== 'thumb' && targetW <= lastWidth) continue;

        const out = await sharp(buffer, { failOn: 'none' })
            .rotate()                                   // авто-поворот по EXIF
            .resize({ width: targetW, withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer({ resolveWithObject: true });

        variants[tgt.name] = await putVariant({
            club, name: tgt.name, body: out.data, contentType: 'image/webp',
            width: out.info.width, height: out.info.height,
        });
        lastWidth = out.info.width;
    }

    const largest = variants.large || variants.medium || variants.thumb;
    return { variants, width: largest?.width || 0, height: largest?.height || 0, mimeType: 'image/webp' };
};

/** Создать запись медиатеки из загруженного файла (multer: { buffer, mimetype, originalname, size }). */
const createFromUpload = async ({ club, userId, file, alt }) => {
    const { variants, width, height, mimeType } = await buildVariants({
        club, buffer: file.buffer, originalMime: file.mimetype,
    });

    const largest = variants.large || variants.medium || variants.thumb;
    const totalSize = Object.values(variants).reduce((sum, v) => sum + (v.size || 0), 0);

    const asset = await MediaAsset.create({
        club,
        kind: 'image',
        mimeType,
        originalName: file.originalname,
        originalMime: file.mimetype,
        alt: alt || '',
        width,
        height,
        size: totalSize,
        storage: storage.driverName(),
        variants,
        url: largest?.url || '',
        uploadedBy: userId,
    });

    return asset.toObject();
};

/** Лента медиатеки клуба (свежие сверху). */
const list = async ({ club, page = 1, limit = 40 }) => {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 40));
    const [items, total] = await Promise.all([
        MediaAsset.find({ club }).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
        MediaAsset.countDocuments({ club }),
    ]);
    return { items, total, page: p, limit: l };
};

/** Удалить запись медиатеки и все её файлы из хранилища. */
const remove = async (asset) => {
    const keys = Object.values(asset.variants || {}).map((v) => v && v.key).filter(Boolean);
    try { await storage.remove(keys); } catch { /* файлы могли быть уже удалены — запись всё равно убираем */ }
    await MediaAsset.deleteOne({ _id: asset._id });
};

/** Публичная форма записи для API/фронта. */
const toPublic = (a) => {
    const mapVariant = (v) => (v ? { url: v.url, width: v.width, height: v.height, size: v.size } : undefined);
    return {
        id: String(a._id),
        kind: a.kind,
        url: a.url,
        alt: a.alt || '',
        mimeType: a.mimeType,
        originalName: a.originalName,
        width: a.width,
        height: a.height,
        size: a.size,
        variants: {
            thumb: mapVariant(a.variants?.thumb),
            medium: mapVariant(a.variants?.medium),
            large: mapVariant(a.variants?.large),
        },
        createdAt: a.createdAt,
    };
};

module.exports = { createFromUpload, list, remove, toPublic, buildVariants };
