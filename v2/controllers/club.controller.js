// club.controller.js — клубы пользователя (переключатель), создание клуба (онбординг), детали, сводка.
const clubService = require('../services/club.service');
const clubRepo = require('../repositories/club.repo'); // шов tenant (mongo|pg по TENANT_DB)
const membershipRepo = require('../repositories/clubMembership.repo'); // шов tenant
const groupRepo = require('../repositories/group.repo'); // шов tenant
const scheduleRepo = require('../repositories/schedule.repo'); // шов learning (mongo|pg по LEARNING_DB)
const paymentRepo = require('../repositories/payment.repo');
const coachRepo = require('../repositories/coach.repo'); // шов coaching (mongo|pg по COACHING_DB)
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
        clubRepo.findById(clubId),
        membershipRepo.countByClubRole(clubId, 'student', 'active'),
        membershipRepo.countByClubRole(clubId, 'trainer', 'active'),
        groupRepo.findByClub(clubId),
        scheduleRepo.findClubEventsInRange(clubId, dayStart, dayEnd),
        scheduleRepo.findClubUpcomingGroup(clubId, now),
        paymentRepo.findByClub(clubId),
    ]);

    // Джойн coach→user — app-level через шов (замена populate на обеих выборках)
    await coachRepo.attachCoachField(groupsRaw);
    await coachRepo.attachCoachField(todayRaw);

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
    // Берём клуб ЛЮБОГО статуса: suspended-клуб показываем как превью владельцу/участнику,
    // чужим/анонимам — 404 (как будто не опубликован).
    const club = await clubRepo.findBySlug(slug);
    if (!club) throw notFound('Club not found.', 'CLUB_NOT_FOUND');

    let membershipDoc = null;
    if (req.user && req.user.id) {
        membershipDoc = await membershipRepo.findActive(club._id, req.user.id);
    }
    const published = club.status === 'active';
    const isOwner = !!(req.user && req.user.id && String(club.owner) === String(req.user.id));
    const canPreview = isOwner || !!membershipDoc;
    if (!published && !canPreview) throw notFound('Club not found.', 'CLUB_NOT_FOUND');

    // Публичная витрина: тренеры клуба (верхнеуровнево) и число групп
    const [coachesRaw, groupsCount] = await Promise.all([
        coachRepo.findByClubWithUser(club._id, 12), // джойн user — в шве (app-level)
        groupRepo.countByClub(club._id),
    ]);
    // Локализация полей тренера под язык запроса (с фолбэком en → первый непустой).
    const lang = req.language || 'en';
    const pickL = (loc) => (loc ? (loc[lang] || loc.en || Object.values(loc).find((v) => typeof v === 'string' && v) || '') : '');
    const pickArr = (loc) => (loc ? (loc[lang] || loc.en || Object.values(loc).find((v) => Array.isArray(v) && v.length) || []) : []);
    // Минимальная «заполненность» профиля для показа на сайте — прячет пустые/тестовые карточки
    // («yes», «test», «пипип» и т.п.) без удаления данных. Полный чек-лист (фото/имя) — в редакторе профиля.
    const MIN_BIO = 40;
    const seen = new Set();
    const coaches = coachesRaw
        .map((c) => ({
            uuid: c.user ? c.user.uuid : null,
            name: c.user ? `${c.user.firstName || ''} ${c.user.lastName || ''}`.trim() : '—',
            headline: pickL(c.headline),
            // Титул показываем ТОЛЬКО у подтверждённого профиля (ТЗ: titleVerified).
            title: (c.isVerified && c.fideProfile && c.fideProfile.title && c.fideProfile.title !== 'None') ? c.fideProfile.title : null,
            photoUrl: c.user ? (c.user.avatarUrl || null) : null,
            bio: pickL(c.bio),
            tags: (pickArr(c.specializations) || []).filter(Boolean).slice(0, 3),
        }))
        // Заполнен: есть имя, headline и содержательное bio. Дедуп по пользователю (uuid).
        .filter((c) => {
            if (!c.name || c.name === '—' || !c.headline || (c.bio || '').length < MIN_BIO) return false;
            const key = c.uuid || `${c.name}|${c.headline}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    const membership = membershipDoc ? { role: membershipDoc.role, status: membershipDoc.status } : null;

    res.json({ data: { club, coaches, groupsCount, membership, published } });
};

module.exports = { getMyClubs, createClub, getClub, getOverview, getBySlug };
