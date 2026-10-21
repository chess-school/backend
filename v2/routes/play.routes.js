// v2/routes/play.routes.js — онлайн-партии: лобби, вызовы, состояние партии.
// Ходы, часы, ничья, сдача и автоподбор — через socket.io namespace /play (sockets/play.sockets.js).
// Ошибки — { msg, code, details? }.

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const withErrorHandling = require('../utils/withErrorHandling');
const authMiddleware = require('../middleware/authV2.middleware');
const validate = require('../middleware/validate');
const challenges = require('../services/play/challenge.service');
const { getGameManager } = require('../services/play');
const { PRESETS, LIMITS } = require('../utils/timeControl');

const idParam = (name) => param(name).isMongoId().withMessage(`${name} must be a valid id`);

/** GET /api/v2/play/presets — пресеты и пределы контроля времени (публично) */
router.get('/presets', (req, res) => res.json({ data: { presets: PRESETS, limits: LIMITS } }));

/** GET /api/v2/play/me — мои рейтинги по категориям, активные партии, мои вызовы */
router.get('/me', authMiddleware, async (req, res) => res.json({ data: await challenges.overview(req.user) }));

/** GET /api/v2/play/games — мои завершённые партии */
router.get('/games', authMiddleware,
    validate([query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1–50')]),
    async (req, res) => res.json({ data: await challenges.myGames(req.user, { limit: Number(req.query.limit) || 20 }) }));

/** GET /api/v2/play/games/:gameId — полное состояние партии (игроки и зрители) */
router.get('/games/:gameId', validate([idParam('gameId')]),
    async (req, res) => res.json({ data: await getGameManager().snapshot(req.params.gameId) }));

/** GET /api/v2/play/challenges — открытые вызовы лобби */
router.get('/challenges', authMiddleware, async (req, res) => res.json({ data: await challenges.listOpenChallenges(req.user) }));

/**
 * POST /api/v2/play/challenges — создать вызов
 * { minutes 1–180, increment 0–60, rated, color: white|black|random, isPrivate (по ссылке), ratingRange? 50–1000 }
 */
router.post('/challenges', authMiddleware,
    validate([
        body('minutes').isInt({ min: LIMITS.minMinutes, max: LIMITS.maxMinutes }).withMessage(`minutes must be ${LIMITS.minMinutes}–${LIMITS.maxMinutes}`).toInt(),
        body('increment').isInt({ min: 0, max: LIMITS.maxIncrement }).withMessage(`increment must be 0–${LIMITS.maxIncrement}`).toInt(),
        body('rated').optional().isBoolean().withMessage('rated must be a boolean').toBoolean(),
        body('isPrivate').optional().isBoolean().withMessage('isPrivate must be a boolean').toBoolean(),
        body('color').optional().isIn(['white', 'black', 'random']).withMessage('color must be white, black or random'),
        body('ratingRange').optional({ values: 'null' }).isInt({ min: 50, max: 1000 }).withMessage('ratingRange must be 50–1000').toInt(),
    ]),
    async (req, res) => {
        const { minutes, increment, rated, isPrivate, color, ratingRange } = req.body;
        res.status(201).json({ data: await challenges.createChallenge(req.user, { minutes, increment, rated, isPrivate, color, ratingRange }) });
    });

/** POST /api/v2/play/challenges/:challengeId/accept — принять вызов -> { gameId } */
router.post('/challenges/:challengeId/accept', authMiddleware, validate([idParam('challengeId')]),
    async (req, res) => res.json({ data: await challenges.acceptChallenge(req.user, req.params.challengeId) }));

/** DELETE /api/v2/play/challenges/:challengeId — отозвать свой вызов */
router.delete('/challenges/:challengeId', authMiddleware, validate([idParam('challengeId')]),
    async (req, res) => res.json({ data: await challenges.cancelChallenge(req.user, req.params.challengeId) }));

module.exports = withErrorHandling(router);
