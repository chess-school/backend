// site.controller.js — публичные настройки сайта клуба (мульти-арендность #7, шаг 1).
// GET /api/v2/site/settings — ПУБЛИЧНЫЙ (без входа). Отдаёт бренд/тексты/соцсети активного клуба,
// чтобы страница входа, футер и шапка брали их из БД, а не из кода. Клуб определяется:
//   1) ?slug=<slug>            — для публичного сайта клуба /c/<slug> и окна входа /login?club=<slug>
//   2) заголовок X-Club-Id     — для залогиненного пользователя (активный клуб в консоли)
//   3) ничего не нашли         — платформенные дефолты (debiut), без чужого бренда
// Ответ ВСЕГДА валиден: пустые поля клуба заменяются нейтральными дефолтами платформы.

const mongoose = require('mongoose');
const Club = require('../models/Club');
const SiteSettings = require('../models/SiteSettings');
const ClubMembership = require('../models/ClubMembership');

// Нейтральные дефолты платформы — то, что показывается БЕЗ клубного контекста.
// Никакого «Mind Over Board» и выдуманных цифр: факты и соцсети пусты, пока клуб их не заполнит.
const PLATFORM_DEFAULTS = {
    siteName: 'debiut',
    logoUrl: '',
    tagline: '',
    primaryColor: '#2B50E0',
    auth: { promoTitle: '', promoSubtitle: '', backgroundUrl: '', buttonColor: '', facts: [] },
    footer: { text: '', legalName: 'debiut', links: [] },
    socials: {},
    menu: [],
};

// Чистим соцсети от пустых значений, чтобы фронт не рисовал «пустые» иконки.
const cleanSocials = (s) => {
    const out = {};
    if (!s) return out;
    for (const [k, v] of Object.entries(s.toObject ? s.toObject() : s)) {
        if (v && String(v).trim()) out[k] = String(v).trim();
    }
    return out;
};

// Собираем безопасный публичный объект: сохранённые настройки клуба поверх дефолтов из Club,
// а те — поверх платформенных дефолтов. Отдаём только публичные поля бренда.
const buildPublic = (club, s) => {
    const base = PLATFORM_DEFAULTS;
    const facts = (s && Array.isArray(s.auth?.facts) ? s.auth.facts : [])
        .filter((f) => f && (f.value || f.label))
        .slice(0, 3)
        .map((f) => ({ value: f.value || '', label: f.label || '' }));
    return {
        clubId: club ? String(club._id) : null,
        slug: club ? club.slug : null,
        isClub: !!club,
        siteName: (s && s.siteName) || (club && club.name) || base.siteName,
        logoUrl: (s && s.logoUrl) || (club && club.logoUrl) || base.logoUrl,
        tagline: (s && s.tagline) || base.tagline,
        city: (club && club.city) || '',
        primaryColor: (club && club.brand && club.brand.primaryColor) || base.primaryColor,
        auth: {
            promoTitle: (s && s.auth?.promoTitle) || base.auth.promoTitle,
            promoSubtitle: (s && s.auth?.promoSubtitle) || base.auth.promoSubtitle,
            backgroundUrl: (s && s.auth?.backgroundUrl) || base.auth.backgroundUrl,
            buttonColor: (s && s.auth?.buttonColor) || base.auth.buttonColor,
            facts,
        },
        footer: {
            text: (s && s.footer?.text) || base.footer.text,
            legalName: (s && s.footer?.legalName) || (club && club.name) || base.footer.legalName,
            links: (s && Array.isArray(s.footer?.links) ? s.footer.links : [])
                .filter((l) => l && l.label && l.url)
                .map((l) => ({ label: l.label, url: l.url })),
        },
        socials: cleanSocials(s && s.socials),
        menu: (s && Array.isArray(s.menu) ? s.menu : [])
            .filter((m) => m && !m.hidden && m.label && m.path)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((m) => ({ key: m.key || m.path, label: m.label, path: m.path })),
    };
};

/** @route GET /api/v2/site/settings — публичные настройки сайта активного клуба (или дефолты платформы). */
const getSettings = async (req, res) => {
    let club = null;

    const slug = req.query.slug ? String(req.query.slug).toLowerCase().trim() : '';
    if (slug) {
        club = await Club.findOne({ slug, status: 'active' }).select('name slug city logoUrl brand').lean();
    } else {
        // Без slug — пробуем активный клуб залогиненного пользователя (X-Club-Id, только для его клуба).
        const headerId = req.headers['x-club-id'];
        if (headerId && req.user && req.user.id && mongoose.Types.ObjectId.isValid(String(headerId))) {
            const member = await ClubMembership.findOne({ club: headerId, user: req.user.id, status: 'active' }).lean();
            if (member) {
                club = await Club.findOne({ _id: headerId, status: 'active' }).select('name slug city logoUrl brand').lean();
            }
        }
    }

    // Неизвестный/чужой клуб → не 404, а платформенные дефолты (окно входа/футер всегда должны отрисоваться).
    const settings = club ? await SiteSettings.findOne({ club: club._id }).lean() : null;
    res.json({ data: buildPublic(club, settings) });
};

// --- Редактирование настроек владельцем клуба (консоль) ------------------------------------------

const SOCIAL_KEYS = ['facebook', 'instagram', 'twitter', 'youtube', 'telegram'];

/** @route GET /api/v2/site/settings/admin — СЫРЫЕ сохранённые настройки активного клуба для формы.
 *  Требует входа и активного клуба (resolveClub). Возвращает что реально лежит в БД (пустое = пустое),
 *  плюс имя/цвет/лого клуба для предзаполнения. */
const getAdminSettings = async (req, res) => {
    const [club, s] = await Promise.all([
        Club.findById(req.club).select('name slug logoUrl brand city').lean(),
        SiteSettings.findOne({ club: req.club }).lean(),
    ]);
    res.json({
        data: {
            club: { name: club?.name || '', slug: club?.slug || '', primaryColor: club?.brand?.primaryColor || '#2B50E0', logoUrl: club?.logoUrl || '', city: club?.city || '' },
            settings: s || null,
        },
    });
};

/** @route PATCH /api/v2/site/settings — сохранить настройки сайта активного клуба (только owner).
 *  Цвет пишем в Club.brand.primaryColor (его читает публичная витрина), остальное — в SiteSettings. */
const updateSettings = async (req, res) => {
    const b = req.body || {};
    const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

    // Настройки сайта (upsert). undefined-поля не трогаем ($set только заданное).
    const set = {};
    if (b.siteName !== undefined) set.siteName = str(b.siteName, 120);
    if (b.logoUrl !== undefined) set.logoUrl = str(b.logoUrl, 500);
    if (b.tagline !== undefined) set.tagline = str(b.tagline, 200);
    if (b.auth) {
        if (b.auth.promoTitle !== undefined) set['auth.promoTitle'] = str(b.auth.promoTitle, 120);
        if (b.auth.promoSubtitle !== undefined) set['auth.promoSubtitle'] = str(b.auth.promoSubtitle, 300);
        if (b.auth.backgroundUrl !== undefined) set['auth.backgroundUrl'] = str(b.auth.backgroundUrl, 500);
        if (b.auth.buttonColor !== undefined) set['auth.buttonColor'] = str(b.auth.buttonColor, 9);
        if (Array.isArray(b.auth.facts)) {
            set['auth.facts'] = b.auth.facts
                .map((f) => ({ value: str(f?.value, 24) || '', label: str(f?.label, 48) || '' }))
                .filter((f) => f.value || f.label)
                .slice(0, 3);
        }
    }
    if (b.footer) {
        if (b.footer.text !== undefined) set['footer.text'] = str(b.footer.text, 300);
        if (b.footer.legalName !== undefined) set['footer.legalName'] = str(b.footer.legalName, 120);
    }
    if (b.socials && typeof b.socials === 'object') {
        for (const k of SOCIAL_KEYS) {
            if (b.socials[k] !== undefined) set[`socials.${k}`] = str(b.socials[k], 300) || '';
        }
    }

    const settings = await SiteSettings.findOneAndUpdate(
        { club: req.club },
        { $set: { club: req.club, ...set } },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();

    // Цвет бренда — в документ клуба (его читает публичная витрина и шапка)
    let club;
    if (typeof b.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.primaryColor.trim())) {
        club = await Club.findByIdAndUpdate(req.club, { $set: { 'brand.primaryColor': b.primaryColor.trim() } }, { new: true })
            .select('name slug logoUrl brand city').lean();
    } else {
        club = await Club.findById(req.club).select('name slug logoUrl brand city').lean();
    }

    res.json({ data: { settings, public: buildPublic(club, settings) } });
};

module.exports = { getSettings, getAdminSettings, updateSettings, buildPublic, PLATFORM_DEFAULTS };
