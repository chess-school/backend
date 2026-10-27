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

module.exports = { getSettings, buildPublic, PLATFORM_DEFAULTS };
