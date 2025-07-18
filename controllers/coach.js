const User = require('../models/User');
const Notification = require('../models/Notification');
const Request = require('../models/Request');
const { findUserByEmail, findUserById, checkUserRole } = require('../utils/userUtils');
const mongoose = require('mongoose');

// 🔁 1. Обновление coach-профиля
const updateCoachProfile = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.roles.includes('coach')) {
    return res.status(403).json({ msg: 'Access denied' });
  }

  user.coachProfile = {
    ...user.coachProfile,
    title: req.body.title || user.coachProfile?.title || '',
    experience: req.body.experience || user.coachProfile?.experience || '',
    bio: req.body.bio || user.coachProfile?.bio || '',
    price: req.body.price ?? user.coachProfile?.price,
    services: Array.isArray(req.body.services) ? req.body.services : user.coachProfile?.services || [],
  };

  await user.save();

  res.json({
    msg: 'Coach profile updated',
    coachProfile: user.coachProfile,
  });
};

// 🔁 2. Назначить студента тренеру
const assignStudent = async (req, res) => {
  const { coachEmail, studentEmail } = req.body;
  const coach = await findUserByEmail(coachEmail);
  checkUserRole(coach, 'coach');

  let student = await findUserByEmail(studentEmail);
  if (!student.roles.includes('student')) {
    student = await User.findOneAndUpdate(
      { email: studentEmail },
      { $addToSet: { roles: 'student' } },
      { new: true }
    );
  }

  student.trainer = coach._id;
  student.trainerEmail = coach.email;
  await student.save();

  if (!coach.students.includes(student._id)) {
    coach.students.push(student._id);
    await coach.save();
  }

  res.json({ msg: 'Student assigned to coach successfully', student });
};

// 🔁 3. Получить всех тренеров
const getCoaches = async (req, res) => {
  const coaches = await User.find({ roles: 'coach' }).select('-password');

  const formatted = coaches.map(coach => ({
    ...coach.toObject(),
    photoUrl: coach.avatar?.data
      ? `${process.env.BASE_URL}/auth/avatar/${coach._id}`
      : null,
  }));

  res.status(200).json(formatted);
};

// 🔁 4. Получить тренеров по email
const getCoachesByEmail = async (req, res) => {
  const { emails } = req.body;

  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ msg: 'Invalid email list' });
  }

  const coaches = await User.find({ email: { $in: emails } }).select('-password');

  const formatted = coaches.map(coach => ({
    _id: coach._id,
    firstName: coach.firstName,
    lastName: coach.lastName,
    email: coach.email,
    roles: coach.roles,
    photoUrl: coach.avatar?.data
      ? `${process.env.BASE_URL}/auth/avatar/${coach._id}`
      : null,
  }));

  res.json(formatted);
};

// 🔁 5. Получить студентов тренера
const getStudents = async (req, res) => {
  const { coachEmail } = req.query;
  const coach = await findUserByEmail(coachEmail);
  checkUserRole(coach, 'coach');

  if (!coach || !Array.isArray(coach.students)) {
    return res.json([]);
  }

  const studentIds = coach.students.map(s => s._id ? s._id.toString() : s.toString());

  res.json(studentIds);
};

// 🔁 6. Удалить студента у тренера
const removeStudent = async (req, res) => {
  const { coachEmail, studentId } = req.query;
  
  if (!coachEmail || !studentId) {
    return res.status(400).json({ msg: 'Coach email and student ID are required' });
  }

  if (!mongoose.Types.ObjectId.isValid(studentId)) {
    return res.status(400).json({ msg: 'Invalid student ID format' });
  }

  const coach = await findUserByEmail(coachEmail);
  checkUserRole(coach, 'coach');

  const studentObjectId = new mongoose.Types.ObjectId(studentId);

  await User.updateOne(
    { _id: coach._id },
    { $pull: { students: { _id: studentObjectId } } }
  );

  await User.updateOne(
    { _id: studentObjectId },
    { 
      $unset: { 
        trainer: "", 
        trainerEmail: "" 
      } 
    }
  );
  
  res.status(200).json({ msg: 'Student has been successfully unassigned from the coach.' });
};

// 🔁 7. Получить тренера по ID
const getCoachById = async (req, res) => {
  const { id } = req.params;
  const coach = await findUserById(id);
  res.json(coach);
};

// 🔁 8. Получить студента по ID
const getStudentById = async (req, res) => {
  const { coachEmail, studentId } = req.query;
  
  if (!coachEmail || !studentId) {
    return res.status(400).json({ msg: 'Coach email and student ID are required' });
  }

  const coach = await findUserByEmail(coachEmail);
  checkUserRole(coach, 'coach');

  const student = await findUserById(studentId);
  
  if (!student) {
    return res.status(404).json({ msg: 'Student not found' });
  }

  if (!student.trainer || student.trainer.toString() !== coach._id.toString()) {
    return res.status(403).json({ msg: 'Access denied: student is not assigned to this coach' });
  }

  res.json(student);
};

// 🔁 9. Получить заявки тренеру
const getRequests = async (req, res) => {
  const coachId = req.user.id;
  const requests = await Request.find({ coach: coachId })
    .populate('student', 'firstName lastName email')
    .select('student experience goals createdAt status');

  res.status(200).json(requests);
};

// 🔁 10. Создать заявку
const createRequest = async (req, res) => {
  const studentId = req.user.id;
  const { coachId, experience, goals } = req.body;

  const existingRequest = await Request.findOne({
    student: studentId,
    coach: coachId,
    status: 'pending',
  });

  if (existingRequest) {
    return res.status(400).json({ msg: 'Request already sent' });
  }

  const newRequest = new Request({ student: studentId, coach: coachId, experience, goals });
  await newRequest.save();

  // 📬 Создать уведомление для тренера
  await new Notification({
    recipient: coachId,
    type: 'request',
    content: 'Новая заявка от студента',
    metadata: {
      studentId,
      requestId: newRequest._id,
    },
  }).save();

  res.status(201).json({ msg: 'Request successfully sent' });
};

// 🔁 11. Обработка заявки
const handleRequest = async (req, res) => {
  const { request_id } = req.query;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ msg: 'Invalid status' });
  }

  const request = await Request.findById(request_id).populate('student coach');
  if (!request) return res.status(404).json({ msg: 'Request not found' });

  request.status = status;
  await request.save();

  if (status === 'approved') {
    const student = request.student;
    const coach = request.coach;

    if (!coach || !student) {
      return res.status(400).json({ msg: 'Invalid coach or student data' });
    }

    if (!coach.students.includes(student._id)) {
      student.trainer = coach._id;
      student.trainerEmail = coach.email;
      await student.save();

      coach.students.push(student._id);
      await coach.save();
    }
  }

  await new Notification({
    recipient: request.student._id,
    type: 'statusUpdate',
    content: `Your request was ${status === 'approved' ? 'approved' : 'rejected'}`,
    metadata: { requestId: request_id },
  }).save();

  res.status(200).json({ msg: `Request ${status}` });
};

module.exports = {
  updateCoachProfile,
  assignStudent,
  getCoaches,
  getCoachesByEmail,
  getStudents,
  removeStudent,
  getCoachById,
  getStudentById,
  getRequests,
  createRequest,
  handleRequest,
};
