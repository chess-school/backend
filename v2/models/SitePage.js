// models/SitePage.js — страница публичного сайта клуба из блоков (debiut, шаг 3 плана сайтов клубов).
// ОДНА запись = одна страница конкретного клуба (slug уникален в пределах клуба): 'home', 'about'
// или произвольная. Содержимое — массив БЛОКОВ {type, props}; БЕЗ сырого HTML (защита от чужого
// скрипта — props чистятся и валидируются в sitePage.service перед записью, а фронт рендерит их
// как данные, а не как разметку). Текстовые поля блоков многоязычны: { pl, uk, en }.
//
// Изоляция: каждая страница привязана к club; списком/правкой управляет только персонал своего
// клуба (sitePage.controller скоупит по req.club), публичная отдача — только status='published'.
// Версия инкрементируется при каждом сохранении (задел под откат в шаге 4).

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Блок хранится как { id, type, props }. props — свободная форма (Mixed), но ПЕРЕД записью
// прогоняется через sitePage.service (whitelist типов/полей, срезка тегов, лимиты длины).
const BlockSchema = new Schema({
    id: { type: String, trim: true, maxlength: 40 },        // стабильный id блока (для DnD в шаге 4)
    type: { type: String, trim: true, maxlength: 24, required: true },
    props: { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const SitePageSchema = new Schema({
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true, index: true },

    slug: { type: String, trim: true, lowercase: true, maxlength: 60, required: true },  // home/about/...
    title: { type: String, trim: true, maxlength: 160, default: '' },

    // ОПУБЛИКОВАННЫЙ снимок (то, что видят посетители). Правка черновика его НЕ трогает.
    blocks: { type: [BlockSchema], default: [] },

    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    version: { type: Number, default: 1 },

    // ЧЕРНОВИК — редактируемая копия, отдельно от опубликованного снимка (чтобы генерация/сохранение
    // не снимали живую страницу с публикации). Публикация копирует draft* → опубликованные поля.
    draftTitle: { type: String, trim: true, maxlength: 160, default: null },
    draftBlocks: { type: [BlockSchema], default: null },
    draftVersion: { type: Number, default: null },
    hasDraft: { type: Boolean, default: false },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Одна страница с данным slug на клуб.
SitePageSchema.index({ club: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('SitePage', SitePageSchema);
