// v2/services/homework.service.js
//
// Домашние задания: тренер задаёт ДЗ (Assignment) — обычно к занятию в расписании,
// студент сдаёт ответ (Submission: текст и/или скриншот), тренер проверяет.
//
// Кому адресовано ДЗ (Assignment.context):
//   student — одному студенту; group — участникам группы; course — студентам с активной записью на курс.
// Права:
//   тренер видит и меняет только свои ДЗ и сдачи по ним; ADMIN — любые;
//   студент видит ДЗ, адресованные ему, и только свои сдачи.

const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Schedule = require('../models/Schedule');
const Group = require('../models/Group');
const Coach = require('../models/Coach');
const TrainingContract = require('../models/TrainingContract');
const Notification = require('../models/Notification');
const { forbidden, notFound, conflict, unprocessable } = require('../utils/apiError');

const SUBMISSION_FIELDS = 'assignment student contentText attachment.contentType attachment.size attachment.filename status review submittedAt createdAt updatedAt';

// =================================================================
//                            ОБЩЕЕ
// =================================================================

const getCoachId = async (userId) => {
    const coach = await Coach.findOne({ user: userId }).select('_id').lean();
    return coach ? coach._id : null;
};

const requireCoachId = async (user) => {
    const coachId = await getCoachId(user.id);
    if (!coachId) {
        throw forbidden('Create your coach profile (PUT /api/v2/coaches/me) before managing homework.', 'COACH_PROFILE_REQUIRED');
    }
    return coachId;
};

/** Уведомление — «по возможности»: его сбой не должен ронять сдачу или проверку ДЗ */
const notify = async (payload) => {
    try {
        await Notification.create(payload);
    } catch (e) {
        console.error('Homework notification failed:', e.message);
    }
};

/** Условие «ДЗ адресовано этому студенту»: лично, через его группы или через активные записи на курсы */
const studentAudience = async (studentId) => {
    const [groupIds, courseIds] = await Promise.all([
        Group.find({ members: studentId }).distinct('_id'),
        TrainingContract.find({ student: studentId, status: 'active' }).distinct('course'),
    ]);
    return {
        $or: [
            { 'context.type': 'student', 'context.refId': new mongoose.Types.ObjectId(String(studentId)) },
            { 'context.type': 'group', 'context.refId': { $in: groupIds } },
            { 'context.type': 'course', 'context.refId': { $in: courseIds } },
        ],
    };
};

const toSubmissionDto = (s) => s && ({
    _id: s._id,
    assignment: s.assignment,
    student: s.student,
    status: s.status,
    contentText: s.contentText || '',
    attachment: s.attachment && s.attachment.contentType
        ? { contentType: s.attachment.contentType, size: s.attachment.size, filename: s.attachment.filename }
        : null,
    review: s.review && (s.review.comment || s.review.reviewedAt) ? { comment: s.review.comment || '', reviewedAt: s.review.reviewedAt } : null,
    submittedAt: s.submittedAt || s.createdAt,
});

// =================================================================
//                       ТРЕНЕР: ЗАДАНИЯ
// =================================================================

/**
 * Создаёт ДЗ к занятию. Адресат берётся из занятия: индивидуальное -> студент, групповое -> группа.
 * payload: { scheduleId, title?, description, dueDate? }
 */
const createAssignment = async (user, payload) => {
    const coachId = await requireCoachId(user);
    const lesson = await Schedule.findById(payload.scheduleId).select('coach context title').lean();
    if (!lesson) throw notFound('Lesson not found.', 'LESSON_NOT_FOUND');
    if (String(lesson.coach) !== String(coachId)) throw forbidden('You can add homework only to your own lessons.', 'NOT_YOUR_LESSON');

    const contextType = { individual: 'student', group: 'group', course_wide: 'course' }[lesson.context.type];
    if (!contextType) throw unprocessable('This lesson type does not support homework.', 'UNSUPPORTED_LESSON');

    let assignment;
    try {
        assignment = await Assignment.create({
            title: payload.title || lesson.title,
            description: payload.description,
            author: coachId,
            context: { type: contextType, refId: lesson.context.refId },
            schedule: lesson._id,
            dueDate: payload.dueDate,
        });
    } catch (e) {
        if (e.code === 11000) throw conflict('This lesson already has homework. Edit it instead.', 'HOMEWORK_EXISTS');
        throw e;
    }

    // Индивидуальное ДЗ — уведомляем студента; групповое — всех участников группы
    const recipients = contextType === 'student'
        ? [lesson.context.refId]
        : contextType === 'group' ? (await Group.findById(lesson.context.refId).select('members').lean())?.members || [] : [];
    await Promise.all(recipients.map((recipient) => notify({
        recipient,
        type: 'NEW_ASSIGNMENT',
        message: `New homework: ${assignment.title}`,
        metadata: { link: '/students-shedule', entity: { type: 'Assignment', id: assignment._id } },
    })));
    return assignment.toObject();
};

/** ДЗ тренера; filters: { scheduleId } */
const listCoachAssignments = async (user, filters) => {
    const coachId = await requireCoachId(user);
    const query = { author: coachId };
    if (filters.scheduleId) query.schedule = filters.scheduleId;
    return Assignment.find(query).sort({ createdAt: -1 }).limit(200).lean();
};

const loadOwnAssignment = async (user, assignmentId) => {
    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) throw notFound('Homework not found.', 'HOMEWORK_NOT_FOUND');
    if (!user.roles.includes('ADMIN')) {
        const coachId = await requireCoachId(user);
        if (String(assignment.author) !== String(coachId)) throw notFound('Homework not found.', 'HOMEWORK_NOT_FOUND');
    }
    return assignment;
};

/** payload: { title?, description?, dueDate? (null — снять срок) } */
const updateAssignment = async (user, assignmentId, payload) => {
    const assignment = await loadOwnAssignment(user, assignmentId);
    if (payload.title !== undefined) assignment.title = payload.title;
    if (payload.description !== undefined) assignment.description = payload.description;
    if (payload.dueDate !== undefined) assignment.dueDate = payload.dueDate || undefined;
    await assignment.save();
    return assignment.toObject();
};

/** Удалить можно только ДЗ, по которому ещё никто не сдавал работу */
const deleteAssignment = async (user, assignmentId) => {
    const assignment = await loadOwnAssignment(user, assignmentId);
    if (await Submission.exists({ assignment: assignment._id })) {
        throw conflict('Students have already submitted this homework; it cannot be deleted.', 'HAS_SUBMISSIONS');
    }
    await assignment.deleteOne();
};

// =================================================================
//                       ТРЕНЕР: ПРОВЕРКА
// =================================================================

/** Сдачи по ДЗ тренера; filters: { status } (по умолчанию — ждут проверки) */
const listSubmissionsForReview = async (user, filters) => {
    const coachId = await requireCoachId(user);
    const assignmentIds = await Assignment.find({ author: coachId }).distinct('_id');
    const submissions = await Submission.find({ assignment: { $in: assignmentIds }, status: filters.status || 'submitted' })
        .select(SUBMISSION_FIELDS)
        .populate('student', 'uuid firstName lastName email')
        .populate({ path: 'assignment', select: 'title description dueDate schedule', populate: { path: 'schedule', select: 'title date' } })
        .sort({ submittedAt: -1 })
        .limit(200)
        .lean();
    return submissions.map((s) => ({ ...toSubmissionDto(s), student: s.student, assignment: s.assignment }));
};

/** payload: { status: 'approved' | 'needs_revision', comment? } */
const reviewSubmission = async (user, submissionId, payload) => {
    const submission = await Submission.findById(submissionId).select(SUBMISSION_FIELDS);
    if (!submission) throw notFound('Submission not found.', 'SUBMISSION_NOT_FOUND');
    const assignment = await loadOwnAssignment(user, submission.assignment).catch(() => {
        throw notFound('Submission not found.', 'SUBMISSION_NOT_FOUND');
    });
    if (payload.status === 'needs_revision' && !payload.comment) {
        throw unprocessable('Explain what to fix: a comment is required when sending homework back.', 'VALIDATION_ERROR',
            [{ field: 'comment', message: 'comment is required for needs_revision' }]);
    }

    submission.status = payload.status;
    submission.review = { comment: payload.comment || '', reviewedBy: assignment.author, reviewedAt: new Date() };
    await submission.save();

    await notify({
        recipient: submission.student,
        type: 'SUBMISSION_REVIEWED',
        message: payload.status === 'approved'
            ? `Homework "${assignment.title}" was approved`
            : `Homework "${assignment.title}" needs revision`,
        description: payload.comment || undefined,
        metadata: { link: '/students-shedule', entity: { type: 'Assignment', id: assignment._id } },
    });
    return toSubmissionDto(submission);
};

// =================================================================
//                     СТУДЕНТ: МОИ ДЗ И СДАЧА
// =================================================================

/** ДЗ, адресованные студенту, вместе с его сдачей и названием/датой занятия */
const listMyAssignments = async (user) => {
    const audience = await studentAudience(user.id);
    const assignments = await Assignment.find(audience)
        .populate('schedule', 'title date')
        .sort({ dueDate: 1, createdAt: -1 })
        .limit(200)
        .lean();
    const submissions = await Submission.find({ student: user.id, assignment: { $in: assignments.map((a) => a._id) } })
        .select(SUBMISSION_FIELDS)
        .lean();
    const byAssignment = new Map(submissions.map((s) => [String(s.assignment), s]));
    return assignments.map((a) => ({
        _id: a._id,
        title: a.title,
        description: a.description || '',
        dueDate: a.dueDate || null,
        lesson: a.schedule ? { _id: a.schedule._id, title: a.schedule.title, date: a.schedule.date } : null,
        createdAt: a.createdAt,
        submission: toSubmissionDto(byAssignment.get(String(a._id))) || null,
    }));
};

/**
 * Сдать или пересдать ДЗ. Пересдача возможна, пока работа не принята.
 * payload: { contentText? }, file: { buffer, mimetype, size, originalname }? (multer)
 */
const submitAssignment = async (user, assignmentId, payload, file) => {
    const assignment = await Assignment.findById(assignmentId).select('title author').lean();
    // ДЗ, адресованное не этому студенту, для него не существует
    if (!assignment || !(await Assignment.exists({ _id: assignmentId, ...(await studentAudience(user.id)) }))) {
        throw notFound('Homework not found.', 'HOMEWORK_NOT_FOUND');
    }

    const text = (payload.contentText || '').trim();
    const existing = await Submission.findOne({ assignment: assignmentId, student: user.id }).select(SUBMISSION_FIELDS);
    if (!text && !file && !(existing && existing.attachment && existing.attachment.contentType)) {
        throw unprocessable('Add a text answer or a screenshot.', 'EMPTY_SUBMISSION',
            [{ field: 'contentText', message: 'Provide contentText or a file' }]);
    }
    if (existing && existing.status === 'approved') {
        throw conflict('This homework has already been approved.', 'ALREADY_APPROVED');
    }

    const update = { contentText: text, status: 'submitted', submittedAt: new Date() };
    if (file) {
        update.attachment = { data: file.buffer, contentType: file.mimetype, size: file.size, filename: file.originalname };
    }

    let submission;
    try {
        submission = await Submission.findOneAndUpdate(
            { assignment: assignmentId, student: user.id, status: { $ne: 'approved' } },
            { $set: update, $setOnInsert: { assignment: assignmentId, student: user.id } },
            { new: true, upsert: true, runValidators: true, projection: SUBMISSION_FIELDS },
        );
    } catch (e) {
        // Гонка с проверкой: работу приняли между чтением и записью
        if (e.code === 11000) throw conflict('This homework has already been approved.', 'ALREADY_APPROVED');
        throw e;
    }

    const coach = await Coach.findById(assignment.author).select('user').lean();
    if (coach) {
        await notify({
            recipient: coach.user,
            type: 'SUBMISSION_RECEIVED',
            message: `${existing ? 'Homework resubmitted' : 'Homework submitted'}: ${assignment.title}`,
            metadata: { link: '/inbox', entity: { type: 'Assignment', id: assignment._id } },
        });
    }
    return { submission: toSubmissionDto(submission), created: !existing };
};

/** Вложение сдачи: видит сам студент, автор ДЗ и ADMIN */
const getSubmissionAttachment = async (user, submissionId) => {
    const submission = await Submission.findById(submissionId).select('+attachment.data').lean();
    if (!submission || !submission.attachment || !submission.attachment.data) {
        throw notFound('Attachment not found.', 'ATTACHMENT_NOT_FOUND');
    }
    const isOwner = String(submission.student) === String(user.id);
    if (!isOwner && !user.roles.includes('ADMIN')) {
        const coachId = await getCoachId(user.id);
        const isAuthor = coachId && await Assignment.exists({ _id: submission.assignment, author: coachId });
        if (!isAuthor) throw notFound('Attachment not found.', 'ATTACHMENT_NOT_FOUND');
    }
    // lean() отдаёт Buffer как BSON Binary — без преобразования Express отправил бы не те байты
    const { data } = submission.attachment;
    return { ...submission.attachment, data: Buffer.isBuffer(data) ? data : Buffer.from(data.buffer) };
};

module.exports = {
    createAssignment,
    listCoachAssignments,
    updateAssignment,
    deleteAssignment,
    listSubmissionsForReview,
    reviewSubmission,
    listMyAssignments,
    submitAssignment,
    getSubmissionAttachment,
};
