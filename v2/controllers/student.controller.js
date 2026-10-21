// v2/controllers/student.controller.js
// Тонкий слой HTTP: входные данные уже провалидированы в student.routes.js,
// бизнес-логика и проверки прав — в services/student.service.js.

const studentService = require('../services/student.service');

/**
 * @desc    Список студентов (ADMIN — все, COACH — свои по контрактам)
 * @route   GET /api/v2/students?status=&courseId=&groupId=&coachId=&search=&page=&limit=
 * @access  Private (COACH, ADMIN)
 */
const listStudents = async (req, res) => {
    const scope = await studentService.resolveScope(req.user);
    const { status, courseId, groupId, coachId, search, page = 1, limit = 20 } = req.query;
    const result = await studentService.listStudents(scope, { status, courseId, groupId, coachId, search, page, limit });
    res.json(result);
};

/**
 * @desc    Карточка студента: профиль, записи, оплаты, группы, ближайшие занятия, успеваемость
 * @route   GET /api/v2/students/:uuid   (uuid = 'me' — своя карточка)
 * @access  Private (ADMIN, COACH — свой студент, сам студент)
 */
const getStudent = async (req, res) => {
    const scope = await studentService.resolveScope(req.user);
    const uuid = req.params.uuid === 'me' ? req.user.uuid : req.params.uuid;
    res.json({ data: await studentService.getStudent(scope, uuid) });
};

/**
 * @desc    Записать студента на курс (создать TrainingContract)
 * @route   POST /api/v2/students
 * @access  Private (COACH — на свои курсы, ADMIN)
 */
const enrollStudent = async (req, res) => {
    const scope = await studentService.resolveScope(req.user);
    const student = await studentService.enrollStudent(scope, req.body);
    res.status(201).json({ msg: 'Student enrolled.', data: student });
};

/**
 * @desc    Изменить запись: статус, группа, даты, прогресс
 * @route   PATCH /api/v2/students/:uuid/enrollments/:enrollmentId
 * @access  Private (COACH — свои записи, ADMIN)
 */
const updateEnrollment = async (req, res) => {
    const scope = await studentService.resolveScope(req.user);
    const student = await studentService.updateEnrollment(scope, req.params.uuid, req.params.enrollmentId, req.body);
    res.json({ msg: 'Enrollment updated.', data: student });
};

/**
 * @desc    Удалить неоплаченную запись студента на курс
 * @route   DELETE /api/v2/students/:uuid/enrollments/:enrollmentId
 * @access  Private (COACH — свои записи, ADMIN)
 */
const deleteEnrollment = async (req, res) => {
    const scope = await studentService.resolveScope(req.user);
    await studentService.deleteEnrollment(scope, req.params.uuid, req.params.enrollmentId);
    res.status(204).end();
};

/**
 * @desc    Изменить ФИО/телефон студента
 * @route   PATCH /api/v2/students/:uuid
 * @access  Private (ADMIN)
 */
const updateStudentProfile = async (req, res) => {
    const student = await studentService.updateStudentProfile(req.params.uuid, req.body);
    res.json({ msg: 'Student profile updated.', data: student });
};

module.exports = { listStudents, getStudent, enrollStudent, updateEnrollment, deleteEnrollment, updateStudentProfile };
