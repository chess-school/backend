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

// PG-строка → форма Mongo-дока.
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

/** Опубликованная страница клуба по slug (публичная отдача). */
async function findPublished(clubId, slug) {
  if (usePg()) {
    return pgRowToDoc(await prisma().sitePage.findFirst({ where: { clubId: s(clubId), slug, status: 'published' } }));
  }
  return SitePageMongo.findOne({ club: clubId, slug, status: 'published' })
    .select('slug title blocks version updatedAt').lean();
}

/** Список страниц клуба (мета, без тел блоков — но вернём как есть, фронт берёт нужное). */
async function listByClub(clubId) {
  if (usePg()) {
    const rows = await prisma().sitePage.findMany({
      where: { clubId: s(clubId) },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, slug: true, title: true, status: true, version: true, updatedAt: true, updatedById: true },
    });
    return rows.map((r) => ({ _id: r.id, slug: r.slug, title: r.title, status: r.status, version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedById ?? undefined }));
  }
  return SitePageMongo.find({ club: clubId })
    .select('slug title status version updatedAt updatedBy').sort({ updatedAt: -1 }).lean();
}

/** Сырая страница клуба по slug (для редактора). */
async function findByClubSlug(clubId, slug) {
  if (usePg()) return pgRowToDoc(await prisma().sitePage.findUnique({ where: { clubId_slug: { clubId: s(clubId), slug } } }));
  return SitePageMongo.findOne({ club: clubId, slug }).lean();
}

/** Создать/перезаписать черновик (upsert по club+slug), инкремент версии. */
async function upsertDraft(clubId, slug, { title, blocks, version, updatedBy }) {
  if (usePg()) {
    const row = await prisma().sitePage.upsert({
      where: { clubId_slug: { clubId: s(clubId), slug } },
      update: { title, blocks, status: 'draft', version, updatedById: s(updatedBy) },
      create: { id: newId(), clubId: s(clubId), slug, title, blocks, status: 'draft', version, updatedById: s(updatedBy) },
    });
    return pgRowToDoc(row);
  }
  return SitePageMongo.findOneAndUpdate(
    { club: clubId, slug },
    { $set: { club: clubId, slug, title, blocks, status: 'draft', version, updatedBy } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();
}

/** Текущая версия страницы (для инкремента) — null если нет. */
async function getVersion(clubId, slug) {
  if (usePg()) {
    const r = await prisma().sitePage.findUnique({ where: { clubId_slug: { clubId: s(clubId), slug } }, select: { version: true } });
    return r ? r.version : null;
  }
  const r = await SitePageMongo.findOne({ club: clubId, slug }).select('version').lean();
  return r ? r.version : null;
}

/** Опубликовать страницу. Возвращает обновлённый док или null. */
async function publish(clubId, slug, updatedBy) {
  if (usePg()) {
    try {
      const row = await prisma().sitePage.update({
        where: { clubId_slug: { clubId: s(clubId), slug } },
        data: { status: 'published', updatedById: s(updatedBy) },
      });
      return pgRowToDoc(row);
    } catch { return null; } // P2025 — нет записи
  }
  return SitePageMongo.findOneAndUpdate(
    { club: clubId, slug }, { $set: { status: 'published', updatedBy } }, { new: true },
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
