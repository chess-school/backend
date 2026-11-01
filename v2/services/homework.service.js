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

const assignmentRepo = require('../repositories/assignment.repo'); // шов learning (mongo|pg по LEARNING_DB)
const submissionRepo = require('../repositories/submission.repo'); // шов learning
const scheduleRepo = require('../repositories/schedule.repo'); // шов learning
const userRepo = require('../repositories/user.repo'); // шов identity (mongo|pg по USER_DB)
const Group = require('../models/Group');
const coachRepo = require('../repositories/coach.repo'); // шов coaching (mongo|pg по COACHING_DB)
const contractRepo = require('../repositories/trainingContract.repo'); // шов coaching
const { notify: emitNotification } = require('./notify');
const puzzleBookRepo = require('../repositories/puzzleBook.repo'); // шов content (mongo|pg по CONTENT_DB)
const { forbidden, notFound, conflict, unprocessable } = require('../utils/apiError');

// =================================================================
//                            ОБЩЕЕ
// =================================================================

const getCoachId = async (userId) => {
    const coach = await coachRepo.findByUser(userId);
    return coach ? coach._id : null;
};

const requireCoachId = async (user) => {
    const coachId = await getCoachId(user.id);
    if (!coachId) {
        throw forbidden('Create your coach profile (PUT /api/v2/coaches/me) before managing homework.', 'COACH_PROFILE_REQUIRED');
    }
    return coachId;
};

/** Уведомление — «по возможности»: его сбой не должен ронять сдачу или проверку ДЗ.
 *  Идёт через общий сервис (репозиторий-шов mongo|pg); он сам глотает ошибки.
 *  Call-site'ы передают Mongo-форму с metadata — мапим её в плоские link/entity. */
const notify = ({ recipient, type, message, description, metadata }) =>
    emitNotification({ recipient, type, message, description, link: metadata?.link, entity: metadata?.entity });

/** Аудитория студента (семантика): ему лично, через его группы или активные записи на курсы.
 *  Фильтр по этой аудитории строит шов assignment.repo (одинаково для mongo|pg). */
const studentAudience = async (studentId) => {
    const [groupIds, courseIds] = await Promise.all([
        Group.find({ members: studentId }).distinct('_id'),
        contractRepo.distinct('course', { student: studentId, status: 'active' }),
    ]);
    return { studentId, groupIds, courseIds };
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
const createAssignment = async (user, payload, club) => {
    const coachId = await requireCoachId(user);
    const lesson = await scheduleRepo.findById(payload.scheduleId);
    if (!lesson) throw notFound('Lesson not found.', 'LESSON_NOT_FOUND');
    if (String(lesson.coach) !== String(coachId)) throw forbidden('You can add homework only to your own lessons.', 'NOT_YOUR_LESSON');

    const contextType = { individual: 'student', group: 'group', course_wide: 'course' }[lesson.context.type];
    if (!contextType) throw unprocessable('This lesson type does not support homework.', 'UNSUPPORTED_LESSON');

    let assignment;
    try {
        assignment = await assignmentRepo.create({
            title: payload.title || lesson.title,
            description: payload.description,
            author: coachId,
            context: { type: contextType, refId: lesson.context.refId },
            schedule: lesson._id,
            dueDate: payload.dueDate,
            ...(club ? { club } : {}),
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
    return assignment;
};

/**
 * Создаёт ДЗ типа «решать задачи из задачника» — не привязано к занятию, адресуется студенту или группе.
 * payload: { contextType: 'student'|'group', contextRefId, puzzleBookId, title?, description?, puzzleTarget?, dueDate?, plan? }
 */
const createPuzzleAssignment = async (user, payload, club) => {
    const coachId = await requireCoachId(user);
    if (!['student', 'group'].includes(payload.contextType)) {
        throw unprocessable('contextType must be student or group.', 'VALIDATION_ERROR');
    }
    const book = await puzzleBookRepo.findById(payload.puzzleBookId, { select: 'title' });
    if (!book) throw notFound('Puzzle book not found.', 'BOOK_NOT_FOUND');

    const plan = Array.isArray(payload.plan)
        ? payload.plan.filter((p) => p && p.date).map((p) => ({
            date: new Date(p.date),
            puzzleCount: Math.max(0, Math.round(Number(p.puzzleCount)) || 0),
            note: String(p.note || '').slice(0, 500),
        }))
        : [];

    const assignment = await assignmentRepo.create({
        title: payload.title || `Solve puzzles: ${book.title}`,
        description: payload.description,
        author: coachId,
        context: { type: payload.contextType, refId: payload.contextRefId },
        kind: 'puzzles',
        puzzleBook: book._id,
        puzzleTarget: Math.max(0, Math.round(Number(payload.puzzleTarget)) || 0),
        dueDate: payload.dueDate,
        plan,
        ...(club ? { club } : {}),
    });

    // Уведомляем адресатов: ссылка ведёт прямо на решение задачника
    const recipients = payload.contextType === 'student'
        ? [payload.contextRefId]
        : (await Group.findById(payload.contextRefId).select('members').lean())?.members || [];
    await Promise.all(recipients.map((recipient) => notify({
        recipient,
        type: 'NEW_ASSIGNMENT',
        message: `New homework: ${assignment.title}`,
        metadata: { link: `/books/${book._id}/solve`, entity: { type: 'Assignment', id: assignment._id } },
    })));
    return assignment;
};

/** ДЗ тренера; filters: { scheduleId } */
const listCoachAssignments = async (user, filters, club) => {
    const coachId = await requireCoachId(user);
    // Изоляция по клубу (#7): если активный клуб определён — только его ДЗ
    return assignmentRepo.findByAuthor({ author: coachId, club: club || null, schedule: filters.scheduleId || null });
};

const loadOwnAssignment = async (user, assignmentId) => {
    const assignment = await assignmentRepo.findById(assignmentId);
    if (!assignment) throw notFound('Homework not found.', 'HOMEWORK_NOT_FOUND');
    if (!user.roles.includes('ADMIN')) {
        const coachId = await requireCoachId(user);
        if (String(assignment.author) !== String(coachId)) throw notFound('Homework not found.', 'HOMEWORK_NOT_FOUND');
    }
    return assignment;
};

/** payload: { title?, description?, dueDate? (null — снять срок) } */
const updateAssignment = async (user, assignmentId, payload) => {
    await loadOwnAssignment(user, assignmentId); // проверка прав
    const fields = {};
    if (payload.title !== undefined) fields.title = payload.title;
    if (payload.description !== undefined) fields.description = payload.description;
    if (payload.dueDate !== undefined) fields.dueDate = payload.dueDate || null;
    const assignment = Object.keys(fields).length ? await assignmentRepo.updateById(assignmentId, fields) : await assignmentRepo.findById(assignmentId);
    return assignment;
};

/** Удалить можно только ДЗ, по которому ещё никто не сдавал работу */
const deleteAssignment = async (user, assignmentId) => {
    const assignment = await loadOwnAssignment(user, assignmentId);
    if (await submissionRepo.existsForAssignment(assignment._id)) {
        throw conflict('Students have already submitted this homework; it cannot be deleted.', 'HAS_SUBMISSIONS');
    }
    await assignmentRepo.deleteById(assignment._id);
};

// =================================================================
//                       ТРЕНЕР: ПРОВЕРКА
// =================================================================

/** Сдачи по ДЗ тренера; filters: { status } (по умолчанию — ждут проверки) */
const listSubmissionsForReview = async (user, filters, club) => {
    const coachId = await requireCoachId(user);
    // Изоляция по клубу (#7): если активный клуб определён — только ДЗ этого клуба
    const assignmentIds = await assignmentRepo.distinctIdsByAuthor({ author: coachId, club: club || null });
    const submissions = await submissionRepo.findForReview(assignmentIds, filters.status || 'submitted', { limit: 200 });
    // student — app-level джойн через шов (замена populate('student'))
    const studentMap = await userRepo.userCardMap(submissions.map((s) => s.student), ['uuid', 'firstName', 'lastName', 'email']);
    for (const s of submissions) s.student = s.student ? (studentMap.get(String(s.student)) || null) : null;
    // assignment(+schedule) — app-level джойн через швы (замена вложенного populate)
    const aIds = [...new Set(submissions.map((s) => String(s.assignment)).filter(Boolean))];
    const assignments = await Promise.all(aIds.map((id) => assignmentRepo.findById(id)));
    const aById = new Map(assignments.filter(Boolean).map((a) => [String(a._id), a]));
    const schedIds = [...new Set(assignments.filter((a) => a && a.schedule).map((a) => String(a.schedule)))];
    const scheds = await Promise.all(schedIds.map((id) => scheduleRepo.findById(id)));
    const schedById = new Map(scheds.filter(Boolean).map((e) => [String(e._id), e]));
    const assignmentView = (a) => a && ({
        _id: a._id, title: a.title, description: a.description, dueDate: a.dueDate,
        schedule: a.schedule && schedById.get(String(a.schedule))
            ? { _id: a.schedule, title: schedById.get(String(a.schedule)).title, date: schedById.get(String(a.schedule)).date }
            : (a.schedule || undefined),
    });
    return submissions.map((s) => ({ ...toSubmissionDto(s), student: s.student, assignment: assignmentView(aById.get(String(s.assignment))) }));
};

/** payload: { status: 'approved' | 'needs_revision', comment? } */
const reviewSubmission = async (user, submissionId, payload) => {
    const existing = await submissionRepo.findById(submissionId);
    if (!existing) throw notFound('Submission not found.', 'SUBMISSION_NOT_FOUND');
    const assignment = await loadOwnAssignment(user, existing.assignment).catch(() => {
        throw notFound('Submission not found.', 'SUBMISSION_NOT_FOUND');
    });
    if (payload.status === 'needs_revision' && !payload.comment) {
        throw unprocessable('Explain what to fix: a comment is required when sending homework back.', 'VALIDATION_ERROR',
            [{ field: 'comment', message: 'comment is required for needs_revision' }]);
    }

    const submission = await submissionRepo.setReview(submissionId, {
        status: payload.status,
        review: { comment: payload.comment || '', reviewedBy: assignment.author, reviewedAt: new Date() },
    });

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
    const assignments = await assignmentRepo.findForAudience(audience, { limit: 200 });
    const submissions = await submissionRepo.findByStudentAndAssignments(user.id, assignments.map((a) => a._id));
    // schedule(title,date) и puzzleBook(title) — app-level джойн через швы (замена populate)
    const schedIds = [...new Set(assignments.filter((a) => a.schedule).map((a) => String(a.schedule)))];
    const bookIds = [...new Set(assignments.filter((a) => a.puzzleBook).map((a) => String(a.puzzleBook)))];
    const [scheds, books] = await Promise.all([
        Promise.all(schedIds.map((id) => scheduleRepo.findById(id))),
        Promise.all(bookIds.map((id) => puzzleBookRepo.findById(id, { select: 'title' }))),
    ]);
    const schedById = new Map(scheds.filter(Boolean).map((e) => [String(e._id), e]));
    const bookById = new Map(books.filter(Boolean).map((b) => [String(b._id), b]));
    const byAssignment = new Map(submissions.map((s) => [String(s.assignment), s]));
    return assignments.map((a) => ({
        _id: a._id,
        title: a.title,
        description: a.description || '',
        dueDate: a.dueDate || null,
        lesson: a.schedule && schedById.get(String(a.schedule))
            ? { _id: a.schedule, title: schedById.get(String(a.schedule)).title, date: schedById.get(String(a.schedule)).date } : null,
        kind: a.kind || 'generic',
        puzzleBook: a.puzzleBook && bookById.get(String(a.puzzleBook))
            ? { _id: a.puzzleBook, title: bookById.get(String(a.puzzleBook)).title } : null,
        puzzleTarget: a.puzzleTarget || 0,
        plan: (a.plan || []).map((p) => ({ date: p.date, puzzleCount: p.puzzleCount || 0, note: p.note || '' })),
        createdAt: a.createdAt,
        submission: toSubmissionDto(byAssignment.get(String(a._id))) || null,
    }));
};

/**
 * Сдать или пересдать ДЗ. Пересдача возможна, пока работа не принята.
 * payload: { contentText? }, file: { buffer, mimetype, size, originalname }? (multer)
 */
const submitAssignment = async (user, assignmentId, payload, file, club) => {
    const assignment = await assignmentRepo.findById(assignmentId);
    // ДЗ, адресованное не этому студенту, для него не существует
    if (!assignment || !(await assignmentRepo.existsForAudience(assignmentId, await studentAudience(user.id)))) {
        throw notFound('Homework not found.', 'HOMEWORK_NOT_FOUND');
    }

    const text = (payload.contentText || '').trim();
    const existing = await submissionRepo.findOneByAssignmentStudent(assignmentId, user.id);
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

    // Клуб сдачи (#7): наследуется от ДЗ, иначе — из активного клуба запроса
    const submissionClub = assignment.club || club || null;
    let submission;
    try {
        submission = await submissionRepo.upsertSubmission(
            { assignmentId, studentId: user.id, club: submissionClub },
            update,
        );
    } catch (e) {
        // Гонка с проверкой: работу приняли между чтением и записью
        if (e.code === 11000) throw conflict('This homework has already been approved.', 'ALREADY_APPROVED');
        throw e;
    }

    const coach = await coachRepo.findById(assignment.author);
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
    const submission = await submissionRepo.getWithAttachment(submissionId);
    if (!submission || !submission.attachment || !submission.attachment.data) {
        throw notFound('Attachment not found.', 'ATTACHMENT_NOT_FOUND');
    }
    const isOwner = String(submission.student) === String(user.id);
    if (!isOwner && !user.roles.includes('ADMIN')) {
        const coachId = await getCoachId(user.id);
        const isAuthor = coachId && await assignmentRepo.existsAuthored(submission.assignment, coachId);
        if (!isAuthor) throw notFound('Attachment not found.', 'ATTACHMENT_NOT_FOUND');
    }
    // lean() отдаёт Buffer как BSON Binary — без преобразования Express отправил бы не те байты
    const { data } = submission.attachment;
    return { ...submission.attachment, data: Buffer.isBuffer(data) ? data : Buffer.from(data.buffer) };
};

module.exports = {
    createAssignment,
    createPuzzleAssignment,
    listCoachAssignments,
    updateAssignment,
    deleteAssignment,
    listSubmissionsForReview,
    reviewSubmission,
    listMyAssignments,
    submitAssignment,
    getSubmissionAttachment,
};
