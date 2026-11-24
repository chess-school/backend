// members.service.js — управление участниками клуба (экран «Участники»).
// Все действия скоупятся активным клубом (req.club) и проверяются по роли актёра (req.clubRole)
// через clubPermissions. Глобальная капабилити COACH синхронизируется при смене роли.

const membershipRepo = require('../repositories/clubMembership.repo');
const userRepo = require('../repositories/user.repo');
const { canManageMember, canAssignRole, ALL_ROLES } = require('../utils/clubPermissions');
const { syncStaffCapability } = require('./club.service');
const { badRequest, forbidden, notFound } = require('../utils/apiError');

/** Список участников клуба с карточкой пользователя: [{ userId, role, status, user, createdAt }]. */
const listMembers = async (clubId) => {
    const memberships = await membershipRepo.findByClub(clubId);
    const userIds = [...new Set(memberships.map((m) => String(m.user)))];
    const users = await userRepo.findByIdList(userIds);
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return memberships.map((m) => {
        const u = byId.get(String(m.user));
        return {
            userId: String(m.user),
            role: m.role,
            status: m.status,
            createdAt: m.createdAt,
            user: u ? {
                uuid: u.uuid,
                firstName: u.firstName,
                lastName: u.lastName,
                email: u.email,
                avatarUrl: u.avatarUrl,
            } : null,
        };
    });
};

/** Сменить роль участника. actorRole — роль текущего пользователя в клубе. */
const changeRole = async (clubId, actorRole, targetUserId, newRole) => {
    if (!ALL_ROLES.includes(newRole)) throw badRequest('Unknown role.', 'ROLE_UNKNOWN');
    const target = await membershipRepo.findOneAny(clubId, targetUserId);
    if (!target || target.status === 'removed') throw notFound('Member not found.', 'MEMBER_NOT_FOUND');
    if (target.role === 'owner') throw forbidden('Owner role cannot be changed here.', 'OWNER_IMMUTABLE');
    if (!canManageMember(actorRole, target.role)) throw forbidden('Not allowed to manage this member.', 'MEMBER_FORBIDDEN');
    if (!canAssignRole(actorRole, newRole)) throw forbidden('Not allowed to assign this role.', 'ROLE_FORBIDDEN');

    const updated = await membershipRepo.updateRole(clubId, targetUserId, newRole);
    // Повышение в обучающую роль выдаёт COACH + коуч-профиль. Понижение COACH НЕ снимаем:
    // роль-капабилити может использоваться в другом клубе; это не даёт доступа к данным (скоуп по клубу).
    await syncStaffCapability(targetUserId, newRole, clubId);
    return updated;
};

/** Пригласить существующего пользователя по email. role по умолчанию student. */
const inviteByEmail = async (clubId, actorRole, email, role = 'student') => {
    if (!email) throw badRequest('Email is required.', 'EMAIL_REQUIRED');
    if (!canAssignRole(actorRole, role)) throw forbidden('Not allowed to assign this role.', 'ROLE_FORBIDDEN');
    const user = await userRepo.findByEmail(String(email).toLowerCase());
    if (!user) throw notFound('No user with this email. Ask them to register first.', 'USER_NOT_FOUND');

    const existing = await membershipRepo.findOneAny(clubId, user._id);
    if (existing && existing.status === 'active') throw badRequest('Already a member.', 'ALREADY_MEMBER');

    if (existing) {
        await membershipRepo.updateRole(clubId, user._id, role);
        await membershipRepo.setStatus(clubId, user._id, 'active');
    } else {
        await membershipRepo.upsert(clubId, user._id, { setOnInsert: { role, status: 'active' } });
    }
    await syncStaffCapability(user._id, role, clubId);
    return membershipRepo.findOneAny(clubId, user._id);
};

/** Удалить участника (status=removed). Владельца удалить нельзя. */
const removeMember = async (clubId, actorRole, targetUserId) => {
    const target = await membershipRepo.findOneAny(clubId, targetUserId);
    if (!target || target.status === 'removed') throw notFound('Member not found.', 'MEMBER_NOT_FOUND');
    if (target.role === 'owner') throw forbidden('Owner cannot be removed.', 'OWNER_IMMUTABLE');
    if (!canManageMember(actorRole, target.role)) throw forbidden('Not allowed to remove this member.', 'MEMBER_FORBIDDEN');
    return membershipRepo.setStatus(clubId, targetUserId, 'removed');
};

module.exports = { listMembers, changeRole, inviteByEmail, removeMember };
