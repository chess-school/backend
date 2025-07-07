const Homework = require('../models/Homework');
const Schedule = require('../models/Schedule'); 
const errorHandler = require('../middleware/errorHandler');
const Notification = require('../models/Notification');

const sendHomework = errorHandler(async (req, res) => {
  const { studentId, scheduleId, homeworkText } = req.body;

  if (!studentId || !scheduleId) {
      return res.status(400).json({ msg: 'studentId and scheduleId are required.' });
  }

  const scheduleEvent = await Schedule.findById(scheduleId);
  if (!scheduleEvent) {
    return res.status(404).json({ msg: 'Schedule event not found.' });
  }
  
  if (scheduleEvent.student.toString() !== req.user.id || studentId !== req.user.id) {
    return res.status(403).json({ msg: 'Access denied. You can only submit homework for your own schedule.' });
  }

  const homeworkData = {
    student: studentId,
    coach: scheduleEvent.coach,
    schedule: scheduleId,
    text: homeworkText, 
  };

  if (req.file) {
    homeworkData.screenshot = {
      data: req.file.buffer,
      contentType: req.file.mimetype
    };
  }
  
  const newHomework = new Homework(homeworkData);
  await newHomework.save();

  scheduleEvent.status = 'completed';
  await scheduleEvent.save();

  res.status(201).json({ msg: 'Homework submitted successfully.', homework: newHomework });
});

const getHomeworkForReview = errorHandler(async (req, res) => {
  const coachId = req.user.id;

  const homeworksRaw = await Homework.find({ coach: coachId, status: 'pending' })
    .select('-screenshot.data') 
    .populate('student', 'firstName lastName email')
    .populate('schedule', 'title date')
    .sort({ submittedAt: -1 })
    .lean();

  const homeworks = homeworksRaw.map(hw => ({
    ...hw,
    hasScreenshot: !!(hw.screenshot && hw.screenshot.contentType), 
  }));
  
  res.status(200).json(homeworks);
});

const reviewHomework = errorHandler(async (req, res) => {
    const { homeworkId } = req.params;
    const { status, comment } = req.body;

    const homework = await Homework.findById(homeworkId)
        .populate('schedule', 'title')
        .populate('student', '_id'); 

    if (!homework) {
        return res.status(404).json({ msg: 'Homework not found.' });
    }

    if (!homework.student) {
        return res.status(500).json({ msg: 'Critical error: Student reference is missing.' });
    }

    if (homework.coach.toString() !== req.user.id) {
        console.error('[СБОЙ] Попытка доступа к чужому ДЗ.');
        return res.status(403).json({ msg: 'Access denied.' });
    }

    homework.status = status;
    homework.review = { comment, reviewedAt: new Date() };
    await homework.save();
    
    const scheduleTitle = homework.schedule ? homework.schedule.title : 'уроку';

    const notificationPayload = {
        recipient: homework.student._id,
        type: 'homework_reviewed',
        content: `Ваше домашнее задание по теме "${scheduleTitle}" было проверено.`,
        metadata: { homeworkId: homework._id, status }
    };
    
    const newNotification = new Notification(notificationPayload);
    await newNotification.save();
    
    res.status(200).json({ msg: 'Homework reviewed successfully.', homework });
});

const getHomeworkScreenshot = errorHandler(async (req, res) => {
    const homework = await Homework.findById(req.params.id);

    if (!homework || !homework.screenshot || !homework.screenshot.data) {
        return res.status(404).send('Not found');
    }

    res.set('Content-Type', homework.screenshot.contentType);
    res.send(homework.screenshot.data);
});

module.exports = {
  sendHomework,
  getHomeworkScreenshot,
  getHomeworkForReview, 
  reviewHomework,
};