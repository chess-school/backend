// Слой хранения настроек сайта клуба (v2 SiteSettings) — ШОВ миграции MongoDB → PostgreSQL
// (strangler, домен 5 Content). Флаг CONTENT_DB: 'mongo' (по умолчанию) | 'pg'.
// Вложенные auth/footer/socials/menu в PG — Json-колонки; наружу отдаём форму Mongo-дока.

const mongoose = require('mongoose');
const SiteSettingsMongo = require('../models/SiteSettings');

const usePg = () => String(process.env.CONTENT_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = require('../lib/prisma')(); }
  return _prisma;
};
const newId = () => new mongoose.Types.ObjectId().toString();

const pgRowToDoc = (r) => r && ({
  _id: r.id,
  club: r.clubId,
  siteName: r.siteName ?? undefined,
  logoUrl: r.logoUrl ?? undefined,
  tagline: r.tagline ?? undefined,
  auth: r.auth ?? undefined,
  footer: r.footer ?? undefined,
  socials: r.socials ?? undefined,
  menu: r.menu ?? undefined,
  theme: r.theme ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Настройки клуба (или null). */
async function findByClub(clubId) {
  if (usePg()) return pgRowToDoc(await prisma().siteSettings.findUnique({ where: { clubId: String(clubId) } })) || null;
  return SiteSettingsMongo.findOne({ club: clubId }).lean();
}

// Глубокий merge вложенного объекта (auth/footer/socials) по заданным полям патча.
const mergeObj = (cur, patch) => ({ ...(cur || {}), ...(patch || {}) });

/**
 * Частичный upsert по клубу. patch — НЕ dotted, а вложенный объект:
 *   { siteName?, logoUrl?, tagline?, auth?:{partial}, footer?:{partial}, socials?:{partial}, menu? }
 * Заданные подполя auth/footer/socials накатываются поверх существующих (siblings сохраняются).
 */
async function upsertByClub(clubId, patch) {
  if (usePg()) {
    const cur = await prisma().siteSettings.findUnique({ where: { clubId: String(clubId) } });
    const next = {
      siteName: patch.siteName !== undefined ? patch.siteName : cur?.siteName ?? null,
      logoUrl: patch.logoUrl !== undefined ? patch.logoUrl : cur?.logoUrl ?? null,
      tagline: patch.tagline !== undefined ? patch.tagline : cur?.tagline ?? null,
      auth: patch.auth ? mergeObj(cur?.auth, patch.auth) : cur?.auth ?? undefined,
      footer: patch.footer ? mergeObj(cur?.footer, patch.footer) : cur?.footer ?? undefined,
      socials: patch.socials ? mergeObj(cur?.socials, patch.socials) : cur?.socials ?? undefined,
      menu: patch.menu !== undefined ? patch.menu : cur?.menu ?? undefined,
      theme: patch.theme ? mergeObj(cur?.theme, patch.theme) : cur?.theme ?? undefined,
    };
    const row = cur
      ? await prisma().siteSettings.update({ where: { clubId: String(clubId) }, data: next })
      : await prisma().siteSettings.create({ data: { id: newId(), clubId: String(clubId), ...next } });
    return pgRowToDoc(row);
  }
  // mongo: вложенный патч → dotted $set, чтобы не затирать соседние подполя auth/footer/socials.
  const set = { club: clubId };
  for (const k of ['siteName', 'logoUrl', 'tagline', 'menu']) if (patch[k] !== undefined) set[k] = patch[k];
  for (const parent of ['auth', 'footer', 'socials', 'theme']) {
    if (patch[parent]) for (const [k, v] of Object.entries(patch[parent])) set[`${parent}.${k}`] = v;
  }
  return SiteSettingsMongo.findOneAndUpdate(
    { club: clubId },
    { $set: set },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();
}

module.exports = { findByClub, upsertByClub, usePg, _pgRowToDoc: pgRowToDoc };
