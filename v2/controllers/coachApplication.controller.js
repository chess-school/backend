// v2/controllers/coachApplication.controller.js — тонкий слой над coachApplication.service

const service = require('../services/coachApplication.service');

/** POST /api/v2/coaches/applications — пользователь подаёт заявку на роль тренера */
const submit = async (req, res) => {
    res.status(201).json({ data: await service.submit(req.user, req.body, req.club) });
};

/** GET /api/v2/coaches/applications/me — моя последняя заявка (статус на странице «Тренеры») */
const getMine = async (req, res) => {
    res.json({ data: await service.getMine(req.user) });
};

/** GET /api/v2/coaches/applications?status= — все заявки (ADMIN) */
const list = async (req, res) => {
    res.json({ data: await service.list(req.user, { status: req.query.status }, req.club) });
};

/** PATCH /api/v2/coaches/applications/:applicationId — решение админа { status, adminNote? } */
const decide = async (req, res) => {
    const { status, adminNote } = req.body;
    res.json({ data: await service.decide(req.user, req.params.applicationId, { status, adminNote }) });
};

module.exports = { submit, getMine, list, decide };
