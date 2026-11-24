// members.controller.js — участники активного клуба (req.club / req.clubRole).
const membersService = require('../services/members.service');

/** @route GET /api/v2/members — список участников клуба. */
const list = async (req, res) => {
  const members = await membersService.listMembers(req.club);
  res.json({ data: members });
};

/** @route PATCH /api/v2/members/:userId/role — сменить роль участника. */
const changeRole = async (req, res) => {
  const updated = await membersService.changeRole(req.club, req.clubRole, req.params.userId, req.body.role);
  res.json({ data: updated });
};

/** @route POST /api/v2/members/invite — пригласить существующего пользователя по email. */
const invite = async (req, res) => {
  const m = await membersService.inviteByEmail(req.club, req.clubRole, req.body.email, req.body.role);
  res.status(201).json({ data: m });
};

/** @route DELETE /api/v2/members/:userId — удалить участника (status=removed). */
const remove = async (req, res) => {
  await membersService.removeMember(req.club, req.clubRole, req.params.userId);
  res.json({ ok: true });
};

module.exports = { list, changeRole, invite, remove };
