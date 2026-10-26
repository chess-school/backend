// club.controller.js — клубы пользователя (переключатель), создание клуба (онбординг), детали, сводка.
const clubService = require('../services/club.service');
const Club = require('../models/Club');
const ClubMembership = require('../models/ClubMembership');
const Group = require('../models/Group');
const Schedule = require('../models/Schedule');
const Payment = require('../models/Payment');
const Coach = require('../models/Coach');
const { notFound } = require('../utils/apiError');

const coachName = (coach) => {
    const u = coach && coach.user;
    return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '—';
};

/** @route GET /api/v2/clubs/mine — клубы текущего пользователя для переключателя */
const getMyClubs = async (req, res) => {
    const clubs = await clubService.getUserClubs(req.user.id);
    res.json({ data: clubs });
};

/** @route POST /api/v2/clubs — создать клуб (текущий пользователь становится владельцем) */
const createClub = async (req, res) => {
    const { name, slug, city, plan, brand } = req.body;
    const club = await clubService.createClub(req.user.id, { name, slug, city, plan, brand });
    res.status(201).json(club);
};

/** @route GET /api/v2/clubs/:clubId — детали клуба (только участнику) */
const getClub = async (req, res) => {
    const data = await clubService.getClubForMember(req.params.clubId, req.user.id);
    res.json(data);
};

/** @route GET /api/v2/clubs/overview — РЕАЛЬНАЯ сводка активного клуба для консоли владельца.
 *  Возвращает только то, что реально есть в БД; метрики без источника (посещаемость, прогресс,
 *  лидеры, график) помечены null — фронт показывает честные пустые состояния, без выдуманных цифр. */
const getOverview = async (req, res) => {
    const clubId = req.club;
    if (!clubId) return res.json({ data: null });

    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

    const [club, students, trainers, groupsRaw, todayRaw, upcomingGroup, payments] = await Promise.all([
        Club.findById(clubId).lean(),
        ClubMembership.countDocuments({ club: clubId, role: 'student', status: 'active' }),
        ClubMembership.countDocuments({ club: clubId, role: 'trainer', status: 'active' }),
        Group.find({ club: clubId }).populate({ path: 'coach', populate: { path: 'user', select: 'firstName lastName' } }).lean(),
        Schedule.find({ club: clubId, date: { $gte: dayStart, $lt: dayEnd } })
            .populate({ path: 'coach', populate: { path: 'user', select: 'firstName lastName' } }).sort({ date: 1 }).lean(),
        Schedule.find({ club: clubId, 'context.type': 'group', date: { $gte: now } }).sort({ date: 1 }).lean(),
        Payment.find({ club: clubId }).select('amount currency status').lean(),
    ]);

    // Ближайшее групповое занятие по каждой группе
    const nextByGroup = {};
    for (const s of upcomingGroup) { const g = String(s.context.refId); if (!nextByGroup[g]) nextByGroup[g] = s; }

    const groups = groupsRaw.map((g) => ({
        id: String(g._id),
        name: g.name,
        description: g.description || '',
        trainer: coachName(g.coach),
        students: Array.isArray(g.members) ? g.members.length : 0,
        nextLesson: nextByGroup[String(g._id)]
            ? { title: nextByGroup[String(g._id)].title, date: nextByGroup[String(g._id)].date }
            : null,
        // Нет источника данных — не выдумываем:
        attendance: null,
        courseProgress: null,
    }));

    const todayLessons = todayRaw.map((s) => ({
        time: new Date(s.date).toISOString(),
        title: s.title,
        trainer: coachName(s.coach),
        type: s.context && s.context.type ? s.context.type : null,
        online: !!s.link,
        status: s.status,
    }));

    // Платежи: суммируем успешные по валютам
    const paidByCurrency = {};
    let pending = 0;
    for (const p of payments) {
        if (p.status === 'succeeded') paidByCurrency[p.currency || 'USD'] = (paidByCurrency[p.currency || 'USD'] || 0) + (p.amount || 0);
        else if (p.status === 'pending') pending += 1;
    }

    res.json({
        data: {
            club: { name: club.name, plan: club.plan, limits: club.limits, slug: club.slug },
            counts: { students, trainers, groups: groups.length },
            payments: { byCurrency: paidByCurrency, pending },
            todayLessons,
            groups,
            bots: {
                telegram: !!(club.botConfig && club.botConfig.telegram && club.botConfig.telegram.enabled),
                whatsapp: !!(club.botConfig && club.botConfig.whatsapp && club.botConfig.whatsapp.enabled),
            },
            // Пока нет источника данных — фронт покажет пустые состояния:
            metrics: { attendance: null, puzzlesSolved7d: null, solvedChart: null, leaders: null },
        },
    });
};

/** @route GET /api/v2/clubs/by-slug/:slug — ПУБЛИЧНЫЙ бренд и витрина клуба для сайта /c/<slug>.
 *  Отдаёт только безопасные публичные поля + (если залогинен) членство пользователя. */
const getBySlug = async (req, res) => {
    const slug = String(req.params.slug || '').toLowerCase();
    const club = await Club.findOne({ slug, status: 'active' })
        .select('name slug city logoUrl brand plan').lean();
    if (!club) throw notFound('Club not found.', 'CLUB_NOT_FOUND');

    // Публичная витрина: тренеры клуба (верхнеуровнево) и число групп
    const [coachesRaw, groupsCount] = await Promise.all([
        Coach.find({ club: club._id }).populate('user', 'firstName lastName avatarUrl').limit(12).lean(),
        Group.countDocuments({ club: club._id }),
    ]);
    const coaches = coachesRaw.map((c) => ({
        name: c.user ? `${c.user.firstName || ''} ${c.user.lastName || ''}`.trim() : '—',
        headline: (c.headline && (c.headline.en || Object.values(c.headline)[0])) || '',
        title: c.fideProfile && c.fideProfile.title ? c.fideProfile.title : null,
    }));

    let membership = null;
    if (req.user && req.user.id) {
        const m = await ClubMembership.findOne({ club: club._id, user: req.user.id, status: 'active' }).lean();
        if (m) membership = { role: m.role, status: m.status };
    }

    res.json({ data: { club, coaches, groupsCount, membership } });
};

module.exports = { getMyClubs, createClub, getClub, getOverview, getBySlug };
