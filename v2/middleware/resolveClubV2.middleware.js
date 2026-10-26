// resolveClubV2.middleware.js — определяет активный клуб запроса (мульти-арендность #7).
// Ставится ПОСЛЕ authV2. Источник клуба: заголовок X-Club-Id (или ?clubId=); если не задан —
// берём клуб пользователя по умолчанию (где он owner, иначе любое активное членство).
// Проверяет, что пользователь — активный участник клуба. Выставляет:
//   req.club       — ObjectId клуба (строка) или null
//   req.clubRole   — роль в клубе: owner|trainer|student|parent
//   req.membership — документ членства (lean)
//
// Поведение гибкое для поэтапного внедрения: если клуб не определить — req.club=null, next()
// (скоуп-контроллеры сами требуют клуб через requireClub). Невалидный X-Club-Id с чужим клубом — 403.

const mongoose = require('mongoose');
const ClubMembership = require('../models/ClubMembership');

const resolveClubV2 = async (req, res, next) => {
    try {
        if (!req.user || !req.user.id) return next(); // без аутентификации клуб не резолвим
        const headerId = req.headers['x-club-id'] || req.query.clubId;

        if (headerId) {
            if (!mongoose.Types.ObjectId.isValid(String(headerId))) {
                return res.status(400).json({ msg: 'X-Club-Id must be a valid id.', code: 'INVALID_CLUB_ID' });
            }
            const membership = await ClubMembership.findOne({ club: headerId, user: req.user.id, status: 'active' }).lean();
            if (!membership) {
                return res.status(403).json({ msg: 'You are not a member of this club.', code: 'NOT_CLUB_MEMBER' });
            }
            req.club = String(membership.club);
            req.clubRole = membership.role;
            req.membership = membership;
            return next();
        }

        // Клуб по умолчанию: сначала где owner, затем любое активное членство
        const memberships = await ClubMembership.find({ user: req.user.id, status: 'active' }).lean();
        const chosen = memberships.find((m) => m.role === 'owner') || memberships[0] || null;
        req.club = chosen ? String(chosen.club) : null;
        req.clubRole = chosen ? chosen.role : null;
        req.membership = chosen;
        return next();
    } catch (e) {
        return next(e);
    }
};

/** Жёсткий guard: требует определённого клуба (для скоуп-эндпоинтов). */
const requireClub = (req, res, next) => {
    if (!req.club) return res.status(400).json({ msg: 'Active club is required.', code: 'CLUB_REQUIRED' });
    next();
};

module.exports = resolveClubV2;
module.exports.requireClub = requireClub;
