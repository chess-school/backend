// club.service.js — операции над клубами (мульти-арендность #7): список клубов пользователя
// для переключателя, создание клуба с владельцем, помощники членства.

const clubRepo = require('../repositories/club.repo'); // шов tenant (mongo|pg по TENANT_DB)
const membershipRepo = require('../repositories/clubMembership.repo'); // шов tenant
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
    for (let i = 2; await clubRepo.existsBySlug(slug); i += 1) slug = `${root}-${i}`;
    return slug;
};

/** Клубы пользователя (для свитчера): [{ club, role }] */
const getUserClubs = async (userId) => {
    const memberships = await membershipRepo.findByUserWithClub(userId);
    return memberships
        .filter((m) => m.club)
        .map((m) => ({ role: m.role, club: m.club }));
};

/** Создать клуб: текущий пользователь становится владельцем (+ членство owner). */
const createClub = async (ownerId, { name, slug, city, plan, brand } = {}) => {
    if (!name || String(name).trim().length < 2) throw badRequest('Club name is required.', 'CLUB_NAME_REQUIRED');
    const safePlan = ['start', 'club', 'academy'].includes(plan) ? plan : 'start';
    const finalSlug = slug ? (await clubRepo.existsBySlug(slugify(slug)) ? await uniqueSlug(slug) : slugify(slug)) : await uniqueSlug(name);

    const club = await clubRepo.create({
        name: String(name).trim(),
        slug: finalSlug,
        city: city ? String(city).trim() : undefined,
        plan: safePlan,
        owner: ownerId,
        ...(brand && brand.primaryColor ? { brand: { primaryColor: brand.primaryColor } } : {}),
        limits: clubRepo.limitsForPlan(safePlan),
    });

    // Владелец — активное членство с ролью owner (идемпотентно)
    await membershipRepo.upsert(club._id, ownerId, { setOnInsert: { role: 'owner', status: 'active' } });
    return club;
};

/** Клуб по id с проверкой членства пользователя */
const getClubForMember = async (clubId, userId) => {
    const membership = await membershipRepo.findActive(clubId, userId);
    if (!membership) throw notFound('Club not found.', 'CLUB_NOT_FOUND');
    const club = await clubRepo.findById(clubId);
    if (!club) throw notFound('Club not found.', 'CLUB_NOT_FOUND');
    return { club, role: membership.role };
};

module.exports = { getUserClubs, createClub, getClubForMember, slugify, uniqueSlug };
