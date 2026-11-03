// sitePage.repo.js — шов хранения страниц сайта клуба (SitePage) MongoDB → PostgreSQL
// (strangler, финальная волна). Флаг MISC_DB: 'mongo' (по умолчанию) | 'pg'.
// Форма наружу = Mongo-док SitePage { _id, club, slug, title, blocks[], status, version, updatedBy, updatedAt }.
// blocks — массив {id,type,props}; в PG лежит Json-колонкой.

const mongoose = require('mongoose');
const SitePageMongo = require('../models/SitePage');

const usePg = () => String(process.env.MISC_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); }
  return _prisma;
};

const newId = () => new mongoose.Types.ObjectId().toString();
const s = (v) => (v == null ? v : String(v));

// PG-строка → ОПУБЛИКОВАННЫЙ вид (публичная отдача / результат publish).
const pgRowToDoc = (r) => r && {
  _id: r.id,
  club: r.clubId,
  slug: r.slug,
  title: r.title,
  blocks: Array.isArray(r.blocks) ? r.blocks : [],
  status: r.status,
  version: r.version,
  updatedBy: r.updatedById ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
};

// PG-строка → РЕДАКТОРСКИЙ вид: черновик поверх опубликованного снимка. Если есть несохранённый
// черновик (hasDraft) — редактор правит его; статус 'draft'. Иначе показываем опубликованное.
const pgRowToEditorDoc = (r) => r && {
  _id: r.id,
  club: r.clubId,
  slug: r.slug,
  title: r.hasDraft && r.draftTitle != null ? r.draftTitle : r.title,
  blocks: r.hasDraft && Array.isArray(r.draftBlocks) ? r.draftBlocks : (Array.isArray(r.blocks) ? r.blocks : []),
  status: r.hasDraft ? 'draft' : r.status,
  version: r.hasDraft && r.draftVersion != null ? r.draftVersion : r.version,
  published: r.status === 'published',   // есть ли живая опубликованная версия
  hasDraft: !!r.hasDraft,
  updatedBy: r.updatedById ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
};

// Mongo-док → РЕДАКТОРСКИЙ вид (та же семантика, что pgRowToEditorDoc).
const mongoToEditorDoc = (d) => d && {
  _id: d._id, club: d.club, slug: d.slug,
  title: d.hasDraft && d.draftTitle != null ? d.draftTitle : d.title,
  blocks: d.hasDraft && Array.isArray(d.draftBlocks) ? d.draftBlocks : (Array.isArray(d.blocks) ? d.blocks : []),
  status: d.hasDraft ? 'draft' : d.status,
  version: d.hasDraft && d.draftVersion != null ? d.draftVersion : d.version,
  published: d.status === 'published',
  hasDraft: !!d.hasDraft,
  updatedBy: d.updatedBy, createdAt: d.createdAt, updatedAt: d.updatedAt,
};

/** Опубликованная страница клуба по slug (публичная отдача). */
async function findPublished(clubId, slug) {
  if (usePg()) {
    return pgRowToDoc(await prisma().sitePage.findFirst({ where: { clubId: s(clubId), slug, status: 'published' } }));
  }
  return SitePageMongo.findOne({ club: clubId, slug, status: 'published' })
    .select('slug title blocks version updatedAt').lean();
}

/** Список страниц клуба (мета). status отражает наличие несохранённого черновика ('draft'). */
async function listByClub(clubId) {
  if (usePg()) {
    const rows = await prisma().sitePage.findMany({
      where: { clubId: s(clubId) },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, slug: true, title: true, status: true, version: true, hasDraft: true, updatedAt: true, updatedById: true },
    });
    return rows.map((r) => ({ _id: r.id, slug: r.slug, title: r.title, status: r.hasDraft ? 'draft' : r.status, version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedById ?? undefined }));
  }
  const docs = await SitePageMongo.find({ club: clubId })
    .select('slug title status version updatedAt updatedBy hasDraft').sort({ updatedAt: -1 }).lean();
  return docs.map((d) => ({ _id: d._id, slug: d.slug, title: d.title, status: d.hasDraft ? 'draft' : d.status, version: d.version, updatedAt: d.updatedAt, updatedBy: d.updatedBy }));
}

/** Страница клуба по slug для РЕДАКТОРА (черновик поверх опубликованного). */
async function findByClubSlug(clubId, slug) {
  if (usePg()) return pgRowToEditorDoc(await prisma().sitePage.findUnique({ where: { clubId_slug: { clubId: s(clubId), slug } } }));
  return mongoToEditorDoc(await SitePageMongo.findOne({ club: clubId, slug }).lean());
}

/** Создать/перезаписать ЧЕРНОВИК (upsert по club+slug). Опубликованный снимок НЕ трогаем —
 *  он остаётся на сайте, пока владелец не вызовет publish. */
async function upsertDraft(clubId, slug, { title, blocks, version, updatedBy }) {
  if (usePg()) {
    const row = await prisma().sitePage.upsert({
      where: { clubId_slug: { clubId: s(clubId), slug } },
      update: { draftTitle: title, draftBlocks: blocks, draftVersion: version, hasDraft: true, updatedById: s(updatedBy) },
      create: { id: newId(), clubId: s(clubId), slug, title: '', blocks: [], status: 'draft', version: 0, draftTitle: title, draftBlocks: blocks, draftVersion: version, hasDraft: true, updatedById: s(updatedBy) },
    });
    return pgRowToEditorDoc(row);
  }
  const doc = await SitePageMongo.findOneAndUpdate(
    { club: clubId, slug },
    {
      $set: { club: clubId, slug, draftTitle: title, draftBlocks: blocks, draftVersion: version, hasDraft: true, updatedBy },
      $setOnInsert: { title: '', blocks: [], status: 'draft', version: 0 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: false, runValidators: true },
  ).lean();
  return mongoToEditorDoc(doc);
}

/** Текущая версия для инкремента — draftVersion, иначе опубликованная version; null если нет записи. */
async function getVersion(clubId, slug) {
  if (usePg()) {
    const r = await prisma().sitePage.findUnique({ where: { clubId_slug: { clubId: s(clubId), slug } }, select: { version: true, draftVersion: true } });
    return r ? (r.draftVersion ?? r.version) : null;
  }
  const r = await SitePageMongo.findOne({ club: clubId, slug }).select('version draftVersion').lean();
  return r ? (r.draftVersion ?? r.version) : null;
}

/** Опубликовать: скопировать черновик (если есть) в опубликованный снимок и очистить draft.
 *  Возвращает опубликованный док или null (нет записи). */
async function publish(clubId, slug, updatedBy) {
  if (usePg()) {
    const r = await prisma().sitePage.findUnique({ where: { clubId_slug: { clubId: s(clubId), slug } } });
    if (!r) return null;
    const title = r.hasDraft && r.draftTitle != null ? r.draftTitle : r.title;
    const blocks = r.hasDraft && r.draftBlocks != null ? r.draftBlocks : r.blocks;
    const version = r.hasDraft && r.draftVersion != null ? r.draftVersion : r.version;
    const row = await prisma().sitePage.update({
      where: { clubId_slug: { clubId: s(clubId), slug } },
      data: { title, blocks, version, status: 'published', draftTitle: null, draftBlocks: null, draftVersion: null, hasDraft: false, updatedById: s(updatedBy) },
    });
    return pgRowToDoc(row);
  }
  const d = await SitePageMongo.findOne({ club: clubId, slug }).lean();
  if (!d) return null;
  const title = d.hasDraft && d.draftTitle != null ? d.draftTitle : d.title;
  const blocks = d.hasDraft && Array.isArray(d.draftBlocks) ? d.draftBlocks : d.blocks;
  const version = d.hasDraft && d.draftVersion != null ? d.draftVersion : d.version;
  return SitePageMongo.findOneAndUpdate(
    { club: clubId, slug },
    { $set: { title, blocks, version, status: 'published', draftTitle: null, draftBlocks: null, draftVersion: null, hasDraft: false, updatedBy } },
    { new: true },
  ).lean();
}

/** Удалить страницу. Возвращает true, если что-то удалено. */
async function deleteByClubSlug(clubId, slug) {
  if (usePg()) {
    try { await prisma().sitePage.delete({ where: { clubId_slug: { clubId: s(clubId), slug } } }); return true; }
    catch { return false; }
  }
  const r = await SitePageMongo.deleteOne({ club: clubId, slug });
  return !!r.deletedCount;
}

module.exports = { findPublished, listByClub, findByClubSlug, upsertDraft, getVersion, publish, deleteByClubSlug, usePg };
