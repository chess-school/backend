// v2/controllers/homework.controller.js
// HTTP-слой домашних заданий; проверки прав и логика — в services/homework.service.js.

const homework = require('../services/homework.service');

/** @route POST /api/v2/assignments  @access COACH — задать ДЗ к своему занятию */
const createAssignment = async (req, res) => {
    res.status(201).json({ data: await homework.createAssignment(req.user, req.body, req.club) });
};

/** @route POST /api/v2/assignments/puzzles  @access COACH — задать ДЗ «решать задачи из задачника» */
const createPuzzleAssignment = async (req, res) => {
    res.status(201).json({ data: await homework.createPuzzleAssignment(req.user, req.body, req.club) });
};

/** @route GET /api/v2/assignments?scheduleId=  @access COACH — свои ДЗ */
const listCoachAssignments = async (req, res) => {
    res.json({ data: await homework.listCoachAssignments(req.user, req.query, req.club) });
};

/** @route PATCH /api/v2/assignments/:assignmentId  @access COACH (автор), ADMIN */
const updateAssignment = async (req, res) => {
    res.json({ data: await homework.updateAssignment(req.user, req.params.assignmentId, req.body) });
};

/** @route DELETE /api/v2/assignments/:assignmentId  @access COACH (автор), ADMIN */
const deleteAssignment = async (req, res) => {
    await homework.deleteAssignment(req.user, req.params.assignmentId);
    res.status(204).end();
};

/** @route GET /api/v2/assignments/my  @access студент — ДЗ, адресованные мне, с моей сдачей */
const listMyAssignments = async (req, res) => {
    res.json({ data: await homework.listMyAssignments(req.user) });
};

/** @route PUT /api/v2/assignments/:assignmentId/submission  @access студент — сдать/пересдать */
const submitAssignment = async (req, res) => {
    const { submission, created } = await homework.submitAssignment(req.user, req.params.assignmentId, req.body, req.file, req.club);
    res.status(created ? 201 : 200).json({ data: submission });
};

/** @route GET /api/v2/submissions/review?status=  @access COACH — сдачи по моим ДЗ */
const listSubmissionsForReview = async (req, res) => {
    res.json({ data: await homework.listSubmissionsForReview(req.user, req.query, req.club) });
};

/** @route PATCH /api/v2/submissions/:submissionId/review  @access COACH (автор ДЗ), ADMIN */
const reviewSubmission = async (req, res) => {
    res.json({ data: await homework.reviewSubmission(req.user, req.params.submissionId, req.body) });
};

/** @route GET /api/v2/submissions/:submissionId/attachment  @access студент-автор, автор ДЗ, ADMIN */
const getSubmissionAttachment = async (req, res) => {
    const attachment = await homework.getSubmissionAttachment(req.user, req.params.submissionId);
    res.set('Content-Type', attachment.contentType);
    // Картинку показываем inline, но без исполнения: nosniff не даст браузеру трактовать её как HTML
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename || 'attachment')}"`);
    res.set('Cache-Control', 'private, max-age=300');
    res.send(attachment.data);
};

module.exports = {
    createAssignment,
    createPuzzleAssignment,
    listCoachAssignments,
    updateAssignment,
    deleteAssignment,
    listMyAssignments,
    submitAssignment,
    listSubmissionsForReview,
    reviewSubmission,
    getSubmissionAttachment,
};
