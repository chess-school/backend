// models/MediaAsset.js — медиатека клуба (debiut, шаг 2 плана сайтов клубов).
// ОДНА запись = одна загруженная картинка клуба с её вариантами (thumb/medium/large).
// Хранит ТОЛЬКО метаданные + ссылки на файлы; сами байты лежат либо в MediaBlob (драйвер
// mongo, по умолчанию), либо в S3/R2 (драйвер s3) — см. v2/services/storage.
//
// Изоляция: каждая запись привязана к club. Списком/удалением управляет только персонал
// своего клуба (site.controller скоупит запросы по req.club); клуб B не видит медиа клуба A.
// Публичные ссылки на файлы при этом открыты (это картинки сайта — они и должны быть видны).

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Один вариант изображения (размер). key — ключ в хранилище (для удаления), url — публичная ссылка.
const VariantSchema = new Schema({
    key: { type: String, trim: true, maxlength: 400 },
    url: { type: String, trim: true, maxlength: 600 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    size: { type: Number, default: 0 },           // байт
}, { _id: false });

const MediaAssetSchema = new Schema({
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true, index: true },

    kind: { type: String, enum: ['image'], default: 'image' },
    mimeType: { type: String, trim: true, maxlength: 60 },     // итоговый тип (обычно image/webp)
    originalName: { type: String, trim: true, maxlength: 300 },
    originalMime: { type: String, trim: true, maxlength: 60 }, // что загрузил пользователь

    alt: { type: String, trim: true, maxlength: 300, default: '' },  // альт-текст (доступность/SEO)

    width: { type: Number, default: 0 },          // размеры самого большого варианта
    height: { type: Number, default: 0 },
    size: { type: Number, default: 0 },            // суммарный вес всех вариантов, байт

    storage: { type: String, enum: ['mongo', 's3'], default: 'mongo' },

    // thumb (≈400w), medium (≈1024w), large (≈1920w). У маленьких/gif может быть только часть.
    variants: {
        thumb: { type: VariantSchema, default: undefined },
        medium: { type: VariantSchema, default: undefined },
        large: { type: VariantSchema, default: undefined },
    },

    // Основная ссылка для показа/вставки (самый большой доступный вариант).
    url: { type: String, trim: true, maxlength: 600 },

    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Лента медиатеки: свежие сверху, в пределах клуба.
MediaAssetSchema.index({ club: 1, createdAt: -1 });

module.exports = mongoose.model('MediaAsset', MediaAssetSchema);
