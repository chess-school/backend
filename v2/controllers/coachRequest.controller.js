// v2/controllers/coachRequest.controller.js — тонкий слой над coachRequest.service

const service = require('../services/coachRequest.service');

/** POST /api/v2/coaches/:coachId/requests — ученик отправляет заявку тренеру */
const createRequest = async (req, res) => {
    const { experience, goals } = req.body;
    res.status(201).json({ data: await service.createRequest(req.user, req.params.coachId, { experience, goals }, req.club) });
};

/** GET /api/v2/coaches/requests/sent — мои отправленные заявки */
const listSentRequests = async (req, res) => {
    res.json({ data: await service.listSentRequests(req.user) });
};

/** GET /api/v2/coaches/me/requests?status= — заявки мне как тренеру */
const listCoachRequests = async (req, res) => {
    res.json({ data: await service.listCoachRequests(req.user, { status: req.query.status }, req.club) });
};

/** PATCH /api/v2/coaches/me/requests/:requestId — { status: approved|rejected, courseId? } */
const decideRequest = async (req, res) => {
    const { status, courseId } = req.body;
    res.json({ data: await service.decideRequest(req.user, req.params.requestId, { status, courseId }) });
};

module.exports = { createRequest, listSentRequests, listCoachRequests, decideRequest };
