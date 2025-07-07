const Homework = require('../models/Homework');
const Schedule = require('../models/Schedule'); 
const errorHandler = require('../middleware/errorHandler');
const Notification = require('../models/Notification');

const sendHomework = errorHandler(async (req, res) => {
  // ----- ДИАГНОСТИЧЕСКИЕ ЛОГИ (добавьте их) -----
  console.log('--- Получен запрос на /homework/send ---');
  console.log('req.body:', req.body); // Посмотрим на все текстовые поля
  console.log('req.file:', req.file); // Посмотрим на данные файла от multer
  // ---------------------------------------------

  const { studentId, scheduleId, homeworkText } = req.body;

  // Проверка на наличие обязательных полей
  if (!studentId || !scheduleId) {
      return res.status(400).json({ msg: 'studentId and scheduleId are required.' });
  }

  const scheduleEvent = await Schedule.findById(scheduleId);
  if (!scheduleEvent) {
    return res.status(404).json({ msg: 'Schedule event not found.' });
  }

  // Небольшая проверка прав: студент может сдавать ДЗ только для своего расписания.
  // req.user.id приходит из authMiddleware, предполагаем, что он соответствует студенту
  if (scheduleEvent.student.toString() !== req.user.id || studentId !== req.user.id) {
    return res.status(403).json({ msg: 'Access denied. You can only submit homework for your own schedule.' });
  }

  const homeworkData = {
    student: studentId,
    coach: scheduleEvent.coach,
    schedule: scheduleId,
    // Используем `homeworkText` из `req.body`
    text: homeworkText, 
  };

  // Важная проверка! Используем req.file, который создал multer
  if (req.file) {
    console.log('Файл найден, добавляем в homeworkData...'); // лог
    homeworkData.screenshot = {
      data: req.file.buffer,
      contentType: req.file.mimetype
    };
  } else {
    console.log('Файл в запросе не найден (req.file is empty).'); // лог
  }
  
  const newHomework = new Homework(homeworkData);
  await newHomework.save();

  // Обновляем статус занятия на "завершено" после сдачи ДЗ
  scheduleEvent.status = 'completed';
  await scheduleEvent.save();

  res.status(201).json({ msg: 'Homework submitted successfully.', homework: newHomework });
});

// Контроллер для получения всех ДЗ для тренера
const getHomeworkForReview = errorHandler(async (req, res) => {
  const coachId = req.user.id;

  // Изменим запрос: выбираем все поля, КРОМЕ screenshot.data
  const homeworksRaw = await Homework.find({ coach: coachId, status: 'pending' })
    .select('-screenshot.data') // <-- ВАЖНО: исключаем тяжелое поле
    .populate('student', 'firstName lastName email')
    .populate('schedule', 'title date')
    .sort({ submittedAt: -1 })
    .lean(); // .lean() для производительности, возвращает обычные JS-объекты

  // Добавим новое поле hasScreenshot для удобства фронтенда
  const homeworks = homeworksRaw.map(hw => ({
    ...hw,
    hasScreenshot: !!(hw.screenshot && hw.screenshot.contentType), // true, если скриншот есть
  }));
  
  res.status(200).json(homeworks);
});


const reviewHomework = errorHandler(async (req, res) => {
    // Обернем все в try...catch для максимально подробного логирования
    try {
        console.log('--- НАЧАЛО ПРОВЕРКИ ДЗ (reviewHomework) ---');
        
        const { homeworkId } = req.params;
        console.log(`[ШАГ 1] Получен ID домашнего задания: ${homeworkId}`);

        const { status, comment } = req.body;
        console.log(`[ШАГ 2] Получены данные: status=${status}, comment=${comment || 'no comment'}`);

        // Ищем ДЗ и сразу популируем связанные данные
        const homework = await Homework.findById(homeworkId)
            .populate('schedule', 'title')
            .populate('student', '_id'); // Важно, чтобы _id был в полях

        if (!homework) {
            console.error('[СБОЙ] Домашнее задание с таким ID не найдено в базе данных.');
            return res.status(404).json({ msg: 'Homework not found.' });
        }
        console.log('[ШАГ 3] Домашнее задание найдено в БД.');

        // КРИТИЧЕСКИ ВАЖНАЯ ПРОВЕРКА
        if (!homework.student) {
            console.error('[СБОЙ] У этого ДЗ отсутствует привязка к студенту (homework.student is null).');
            return res.status(500).json({ msg: 'Critical error: Student reference is missing.' });
        }
        console.log(`[ШАГ 4] Студент найден, ID: ${homework.student._id}`);

        // Проверка прав тренера
        if (homework.coach.toString() !== req.user.id) {
             console.error('[СБОЙ] Попытка доступа к чужому ДЗ.');
            return res.status(403).json({ msg: 'Access denied.' });
        }

        // Обновляем данные
        homework.status = status;
        homework.review = { comment, reviewedAt: new Date() };
        console.log('[ШАГ 5] Данные ДЗ обновлены в памяти.');

        await homework.save();
        console.log('[ШАГ 6] Обновленное ДЗ успешно сохранено в БД.');
        
        const scheduleTitle = homework.schedule ? homework.schedule.title : 'уроку';

        // Создаем уведомление
        console.log(`[ШАГ 7] Создание уведомления для студента ${homework.student._id}`);
        const notificationPayload = {
            recipient: homework.student._id,
            type: 'homework_reviewed',
            content: `Ваше домашнее задание по теме "${scheduleTitle}" было проверено.`,
            metadata: { homeworkId: homework._id, status }
        };
        
        const newNotification = new Notification(notificationPayload);
        await newNotification.save();
        
        console.log('[ШАГ 8] Уведомление успешно создано и сохранено.');
        console.log('--- ПРОВЕРКА ДЗ ЗАВЕРШЕНА УСПЕШНО ---');

        res.status(200).json({ msg: 'Homework reviewed successfully.', homework });

    } catch (error) {
        // ЭТОТ БЛОК ПОЙМАЕТ ОШИБКУ И ВЫВЕДЕТ ЕЕ В КОНСОЛЬ СЕРВЕРА
        console.error('!!!!!!!! КРИТИЧЕСКАЯ ОШИБКА ВНУТРИ КОНТРОЛЛЕРА reviewHomework !!!!!!!!');
        console.error(error); // Выводим полный стек ошибки
        
        // Передаем ошибку дальше в глобальный errorHandler, который вернет 500
        throw error;
    }
});

const getHomeworkScreenshot = errorHandler(async (req, res) => {
  try {
    const homework = await Homework.findById(req.params.id);

    // Если ДЗ не найдено или у него нет скриншота, возвращаем ошибку
    if (!homework || !homework.screenshot || !homework.screenshot.data) {
      return res.status(404).send('Not found');
    }

    // Устанавливаем правильный заголовок Content-Type
    res.set('Content-Type', homework.screenshot.contentType);
    // Отправляем бинарные данные изображения
    res.send(homework.screenshot.data);
  } catch (error) {
    res.status(500).send('Server error');
  }
});



module.exports = {
  sendHomework,
  getHomeworkScreenshot,
  getHomeworkForReview, 
  reviewHomework,
};