// clubPermissions.js — единая модель клубных ролей и их прав (мульти-арендность #7).
// Источник правды и для бэкенд-гардов (members.service), и зеркалится на фронт (nav).
//
// Роли (ClubMembership.role):
//   owner   — владелец: всё, включая биллинг, удаление клуба и назначение admin.
//   admin   — со-владелец: всё кроме биллинга/удаления клуба/передачи владения.
//   manager — операционка: участники, заявки, сайт, расписание; НЕ ведёт обучение.
//   trainer — тренер: группы/курсы/домашки/расписание своих учеников.
//   student — ученик.
//   parent  — родитель ученика.

// Ранг роли: сравнения «строго выше/ниже» (нельзя трогать равных/старших по рангу).
const ROLE_RANK = { owner: 5, admin: 4, manager: 3, trainer: 2, student: 1, parent: 1 };

// Капабилити по роли.
const CAPS = {
  owner: new Set(['billing', 'deleteClub', 'manageRoles', 'manageMembers', 'manageSite', 'manageLeads', 'teach', 'schedule']),
  admin: new Set(['manageRoles', 'manageMembers', 'manageSite', 'manageLeads', 'teach', 'schedule']),
  manager: new Set(['manageMembers', 'manageLeads', 'manageSite', 'schedule']),
  trainer: new Set(['teach', 'schedule']),
  student: new Set(),
  parent: new Set(),
};

const ALL_ROLES = Object.keys(ROLE_RANK);

/** Есть ли у клубной роли капабилити. */
const can = (role, cap) => !!(role && CAPS[role] && CAPS[role].has(cap));

/** Ранг роли (0 для неизвестной). */
const rankOf = (role) => ROLE_RANK[role] || 0;

/**
 * Может ли actorRole управлять участником с ролью targetRole (менять роль / удалять).
 * Правило: нужна капабилити manageMembers И actor строго старше target по рангу
 * (нельзя трогать равных и старших — защита от эскалации и «увода» владельца).
 */
const canManageMember = (actorRole, targetRole) =>
  can(actorRole, 'manageMembers') && rankOf(actorRole) > rankOf(targetRole);

/**
 * Может ли actorRole НАЗНАЧИТЬ роль newRole.
 * Правило: нужна manageRoles, newRole валидна, нельзя назначать owner (это передача
 * владения — отдельное действие), и назначаемая роль строго ниже ранга actor.
 */
const canAssignRole = (actorRole, newRole) =>
  can(actorRole, 'manageRoles') && ALL_ROLES.includes(newRole) && newRole !== 'owner' && rankOf(actorRole) > rankOf(newRole);

// Клубные роли, которым нужна глобальная капабилити COACH + коуч-профиль (вести обучение).
const TEACHING_ROLES = new Set(['owner', 'admin', 'trainer']);
const isTeachingRole = (role) => TEACHING_ROLES.has(role);

module.exports = { ROLE_RANK, CAPS, ALL_ROLES, can, rankOf, canManageMember, canAssignRole, isTeachingRole };
