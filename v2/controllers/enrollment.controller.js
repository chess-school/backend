const TrainingContract = require('../models/TrainingContract');
const Course = require('../models/Course');
const Coach = require('../models/Coach');

// =================================================================
//                 ЭКШЕНЫ СО СТОРОНЫ СТУДЕНТА
// =================================================================

/**
 * @desc    Записаться (подать заявку) на курс. Создает TrainingContract.
 * @route   POST /api/v2/courses/:courseId/enroll
 * @access  Private
 */
const enrollInCourse = async (req, res) => {
    const { courseId } = req.params;
    const studentId = req.user.id;

    // 1. Проверяем, существует ли курс и опубликован ли он
    const course = await Course.findOne({ _id: courseId, status: 'published' });
    if (!course) {
        return res.status(404).json({ msg: 'Published course not found.' });
    }
    
    // 2. Проверяем, не записан ли студент уже на этот курс
    const existingContract = await TrainingContract.findOne({ student: studentId, course: courseId });
    if (existingContract) {
        return res.status(400).json({ msg: 'You are already enrolled in this course.' });
    }

    // 3. Находим основного тренера курса (например, первого в списке авторов)
    const primaryCoach = await Coach.findById(course.authors[0]);
    if (!primaryCoach) {
        return res.status(404).json({ msg: 'Could not find a coach for this course.' });
    }

    // 4. Создаем новый контракт
    const newContract = new TrainingContract({
        student: studentId,
        course: courseId,
        coach: primaryCoach._id, // Привязываем к основному тренеру
        status: 'pending_payment', // Статус по умолчанию - ожидает оплаты
        priceAtPurchase: course.price, // Фиксируем цену на момент покупки
        // packageSnapshot можно будет заполнить из данных курса
    });

    await newContract.save();

    // В будущем здесь можно инициировать процесс оплаты
    // await createPaymentSession(newContract._id);

    res.status(201).json({ msg: 'Successfully enrolled. Awaiting payment.', contract: newContract });
};


/**
 * @desc    Получить список всех своих учебных контрактов (курсов, на которые записан).
 * @route   GET /api/v2/my-training/contracts
 * @access  Private
 */
const getMyContracts = async (req, res) => {
    const contracts = await TrainingContract.find({ student: req.user.id })
        .populate({
            path: 'course',
            select: 'title description thumbnailUrl language'
        })
        .populate({
            path: 'coach',
            select: 'user',
            populate: {
                path: 'user',
                select: 'firstName lastName uuid'
            }
        })
        .sort({ createdAt: -1 });

    res.json({ data: contracts });
};

// =================================================================
//                  ЭКШЕНЫ СО СТОРОНЫ ТРЕНЕРА
// =================================================================

/**
 * @desc    Получить список студентов, записанных на курсы текущего тренера.
 * @route   GET /api/v2/coaches/me/students
 * @access  Private (role: COACH)
 */
const getMyStudents = async (req, res) => {
    // 1. Находим профиль тренера
    const coachProfile = await Coach.findOne({ user: req.user.id }).select('_id');
    if (!coachProfile) {
        return res.status(404).json({ msg: 'Coach profile not found.' });
    }
    
    // 2. Находим все контракты, где этот тренер является куратором
    const contracts = await TrainingContract.find({ coach: coachProfile._id })
        .populate({
            path: 'student',
            select: 'uuid firstName lastName email avatarUrl'
        })
        .populate({
            path: 'course',
            select: 'title'
        })
        .sort({ createdAt: -1 });
    
    // Группируем студентов для удобного отображения (опционально)
    // В данном случае просто возвращаем список контрактов
    res.json({ data: contracts });
};


module.exports = {
    enrollInCourse,
    getMyContracts,
    getMyStudents
};