// club.service.js — операции над клубами (мульти-арендность #7): список клубов пользователя
// для переключателя, создание клуба с владельцем, помощники членства.

const Club = require('../models/Club');
const ClubMembership = require('../models/ClubMembership');
const { badRequest, notFound } = require('../utils/apiError');

const DIACRITICS = /[̀-ͯ]/g; // комбинируемые диакритические знаки
const slugify = (s) => String(s || '')
    .normalize('NFKD').replace(DIACRITICS, '') // снимаем диакритику (ń→n, ś→s …)
    .replace(/ł/gi, 'l')                       // польский ł не раскладывается NFKD
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40) || 'club';

/** Уникальный slug: добавляем -2, -3… при коллизии */
const uniqueSlug = async (base) => {
    const root = slugify(base);
    let slug = root;
    for (let i = 2; await Club.exists({ slug }); i += 1) slug = `${root}-${i}`;
    return slug;
};

/** Клубы пользователя (для свитчера): [{ club, role }] */
const getUserClubs = async (userId) => {
    const memberships = await ClubMembership.find({ user: userId, status: 'active' })
        .populate('club', 'name slug logoUrl brand plan status city')
        .lean();
    return memberships
        .filter((m) => m.club)
        .map((m) => ({ role: m.role, club: m.club }));
};

/** Создать клуб: текущий пользователь становится владельцем (+ членство owner). */
const createClub = async (ownerId, { name, slug, city, plan, brand } = {}) => {
    if (!name || String(name).trim().length < 2) throw badRequest('Club name is required.', 'CLUB_NAME_REQUIRED');
    const finalSlug = slug ? (await Club.exists({ slug: slugify(slug) }) ? await uniqueSlug(slug) : slugify(slug)) : await uniqueSlug(name);

    const club = await Club.create({
        name: String(name).trim(),
        slug: finalSlug,
        city: city ? String(city).trim() : undefined,
        plan: ['start', 'club', 'academy'].includes(plan) ? plan : 'start',
        owner: ownerId,
        ...(brand && brand.primaryColor ? { brand: { primaryColor: brand.primaryColor } } : {}),
        limits: Club.limitsForPlan(['start', 'club', 'academy'].includes(plan) ? plan : 'start'),
    });

    // Владелец — активное членство с ролью owner (идемпотентно)
    await ClubMembership.updateOne(
        { club: club._id, user: ownerId },
        { $setOnInsert: { club: club._id, user: ownerId, role: 'owner', status: 'active' } },
        { upsert: true },
    );
    return club;
};

/** Клуб по id с проверкой членства пользователя */
const getClubForMember = async (clubId, userId) => {
    const membership = await ClubMembership.findOne({ club: clubId, user: userId, status: 'active' }).lean();
    if (!membership) throw notFound('Club not found.', 'CLUB_NOT_FOUND');
    const club = await Club.findById(clubId).lean();
    if (!club) throw notFound('Club not found.', 'CLUB_NOT_FOUND');
    return { club, role: membership.role };
};

module.exports = { getUserClubs, createClub, getClubForMember, slugify, uniqueSlug };
