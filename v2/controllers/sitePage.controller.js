// sitePage.controller.js — страницы сайта клуба из блоков (шаг 3). Публичная отдача + админ-CRUD.
//
// ПУБЛИЧНО (без входа): GET /site/pages/:slug?slug=<clubSlug> — отдаёт ТОЛЬКО опубликованную
//   страницу активного клуба (как в site.controller: клуб по ?slug= или X-Club-Id залогиненного).
//   Нет опубликованной страницы → 404 (фронт показывает свой статичный фолбэк).
// АДМИН (персонал клуба owner|trainer, активный клуб обязателен):
//   GET    /site/pages            — список страниц клуба (мета без блоков);
//   GET    /site/pages/admin/:slug — сырой черновик для редактора (нет — отдаём стартовый шаблон);
//   PUT    /site/pages/:slug      — создать/перезаписать черновик (блоки санитайзятся), +version;
//   POST   /site/pages/:slug/publish — опубликовать текущее содержимое;
//   DELETE /site/pages/:slug      — удалить страницу.
// Запись (PUT/publish/DELETE) — только owner (см. site.routes requireOwner).

const mongoose = require('mongoose');
const clubRepo = require('../repositories/club.repo'); // шов tenant (mongo|pg по TENANT_DB)
const membershipRepo = require('../repositories/clubMembership.repo'); // шов tenant
const sitePageRepo = require('../repositories/sitePage.repo'); // шов misc (mongo|pg по MISC_DB)
const { sanitizeBlocks, starterPage } = require('../services/sitePage.service');

// Клуб публичного запроса: ?slug=<clubSlug> (витрина) либо X-Club-Id активного пользователя.
// Повторяет логику site.controller.getSettings, но нам нужен только _id/name клуба.
const resolvePublicClub = async (req) => {
    const slug = req.query.slug ? String(req.query.slug).toLowerCase().trim() : '';
    if (slug) {
        return clubRepo.findActiveBySlug(slug);
    }
    const headerId = req.headers['x-club-id'];
    if (headerId && req.user && req.user.id && mongoose.Types.ObjectId.isValid(String(headerId))) {
        const member = await membershipRepo.findActive(headerId, req.user.id);
        if (member) return clubRepo.findActiveById(headerId);
    }
    return null;
};

const pageSlug = (req) => String(req.params.slug || '').toLowerCase().trim().slice(0, 60);

/** @route GET /api/v2/site/pages/:slug — ПУБЛИЧНАЯ опубликованная страница клуба. */
const getPublicPage = async (req, res) => {
    const club = await resolvePublicClub(req);
    if (!club) return next404(res);
    const page = await sitePageRepo.findPublished(club._id, pageSlug(req));
    if (!page) return next404(res);
    res.json({ data: { slug: page.slug, title: page.title, blocks: page.blocks || [], version: page.version } });
};

const next404 = (res) => res.status(404).json({ msg: 'Page not found.', code: 'PAGE_NOT_FOUND' });

// --- Админ (персонал клуба) --------------------------------------------------------------------

/** @route GET /api/v2/site/pages — список страниц активного клуба (мета, без тел блоков). */
const listPages = async (req, res) => {
    const pages = await sitePageRepo.listByClub(req.club);
    res.json({ data: pages.map((p) => ({ ...p, blockCount: undefined })) });
};

/** @route GET /api/v2/site/pages/admin/:slug — черновик для редактора; нет — стартовый шаблон. */
const getAdminPage = async (req, res) => {
    const slug = pageSlug(req);
    const page = await sitePageRepo.findByClubSlug(req.club, slug);
    if (page) {
        return res.json({ data: { page, isNew: false } });
    }
    const club = await clubRepo.findById(req.club);
    const starter = starterPage(slug, club && club.name);
    res.json({ data: { page: { slug, title: starter.title, blocks: starter.blocks, status: 'draft', version: 0 }, isNew: true } });
};

/** @route PUT /api/v2/site/pages/:slug — создать/перезаписать черновик (блоки санитайзятся). */
const savePage = async (req, res) => {
    const slug = pageSlug(req);
    if (!slug) return res.status(422).json({ msg: 'Page slug is required.', code: 'VALIDATION_ERROR' });
    const b = req.body || {};
    const blocks = sanitizeBlocks(b.blocks);
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 160) : '';

    // version инкрементим атомарно; редактирование уводит страницу в черновик (публикация — отдельно).
    const existingVersion = await sitePageRepo.getVersion(req.club, slug);
    const version = (existingVersion || 0) + 1;

    const page = await sitePageRepo.upsertDraft(req.club, slug, { title, blocks, version, updatedBy: req.user.id });
    res.json({ data: { page } });
};

/** @route POST /api/v2/site/pages/:slug/publish — опубликовать страницу. */
const publishPage = async (req, res) => {
    const slug = pageSlug(req);
    const page = await sitePageRepo.publish(req.club, slug, req.user.id);
    if (!page) return next404(res);
    res.json({ data: { page } });
};

/** @route DELETE /api/v2/site/pages/:slug — удалить страницу активного клуба. */
const deletePage = async (req, res) => {
    const slug = pageSlug(req);
    const ok = await sitePageRepo.deleteByClubSlug(req.club, slug);
    if (!ok) return next404(res);
    res.json({ data: { deleted: true } });
};

module.exports = { getPublicPage, listPages, getAdminPage, savePage, publishPage, deletePage };
