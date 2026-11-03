// v2/routes/leads.routes.js — заявки на пробное в кабинете клуба (владелец).
const express = require('express');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const resolveClub = require('../middleware/resolveClubV2.middleware');
const { forbidden } = require('../utils/apiError');
const leadsController = require('../controllers/leads.controller');

// Заявки видит только владелец клуба (видимость для тренера — отдельным шагом).
const requireOwner = (req, res, next) => {
    if (req.clubRole !== 'owner') return next(forbidden('Only the club owner can manage leads.', 'NOT_CLUB_OWNER'));
    next();
};

router.get('/', authMiddleware, resolveClub, resolveClub.requireClub, requireOwner, leadsController.list);
router.patch('/:id', authMiddleware, resolveClub, resolveClub.requireClub, requireOwner, leadsController.update);

module.exports = withErrorHandling(router);
