// v2/routes/members.routes.js — управление участниками активного клуба.
// Клуб берётся из X-Club-Id (resolveClub), права — по клубной роли (clubPermissions).
const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const resolveClub = require('../middleware/resolveClubV2.middleware');
const validate = require('../middleware/validate');
const { can, ALL_ROLES } = require('../utils/clubPermissions');
const { forbidden } = require('../utils/apiError');
const membersController = require('../controllers/members.controller');

/** Гард по клубной капабилити (manageMembers / manageRoles). */
const requireCap = (cap) => (req, res, next) => {
  if (!can(req.clubRole, cap)) return next(forbidden('You do not have permission to manage club members.', 'MEMBERS_FORBIDDEN'));
  next();
};

const userIdParam = param('userId').isMongoId().withMessage('userId must be a valid id');
// owner назначить нельзя (передача владения — отдельно); остальные роли допустимы.
const assignableRoles = ALL_ROLES.filter((r) => r !== 'owner');

const base = [authMiddleware, resolveClub, resolveClub.requireClub];

router.get('/', ...base, requireCap('manageMembers'), membersController.list);

router.post('/invite', ...base, requireCap('manageMembers'), validate([
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('role').optional().isIn(assignableRoles).withMessage('Invalid role'),
]), membersController.invite);

router.patch('/:userId/role', ...base, requireCap('manageRoles'), validate([
  userIdParam,
  body('role').isIn(assignableRoles).withMessage('Invalid role'),
]), membersController.changeRole);

router.delete('/:userId', ...base, requireCap('manageMembers'), validate([userIdParam]), membersController.remove);

module.exports = withErrorHandling(router);
