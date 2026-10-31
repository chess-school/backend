const contractRepo = require('../repositories/trainingContract.repo'); // шов coaching (mongo|pg по COACHING_DB)
const Course = require('../models/Course');
const coachRepo = require('../repositories/coach.repo'); // шов coaching

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

    // 1. Проверяем, существует ли курс и опубликован ли он (некорректный id -> 400 в errorHandlerV2)
    const course = await Course.findOne({ _id: courseId, status: 'published' });
    if (!course) {
        return res.status(404).json({ msg: 'Published course not found.', code: 'COURSE_NOT_FOUND' });
    }
    
    // 2. Проверяем, не записан ли студент уже на этот курс
    const existingContract = await contractRepo.findOne({ student: studentId, course: courseId });
    if (existingContract) {
        return res.status(409).json({ msg: 'You are already enrolled in this course.', code: 'ALREADY_ENROLLED' });
    }

    // 3. Находим основного тренера курса (например, первого в списке авторов)
    const primaryCoach = await coachRepo.findById(course.authors[0]);
    if (!primaryCoach) {
        return res.status(404).json({ msg: 'Could not find a coach for this course.', code: 'COACH_NOT_FOUND' });
    }
    if (String(primaryCoach.user) === req.user.id) {
        return res.status(422).json({ msg: 'You cannot enroll in your own course.', code: 'SELF_ENROLLMENT' });
    }
    const isFree = !course.price || course.price.amount === 0;

    // 4. Создаем новый контракт
    let newContract;
    try {
        newContract = await contractRepo.create({
            student: studentId,
            course: courseId,
            coach: primaryCoach._id, // Привязываем к основному тренеру
            // Бесплатный курс оплачивать нечем: без этого запись навсегда застревала в pending_payment
            status: isFree ? 'active' : 'pending_payment',
            startDate: isFree ? new Date() : undefined,
            priceAtPurchase: course.price, // Фиксируем цену на момент покупки
            // Клуб-владелец (#7): предпочитаем клуб курса, иначе — активный клуб запроса
            ...(course.club ? { club: course.club } : (req.club ? { club: req.club } : {})),
            // packageSnapshot можно будет заполнить из данных курса
        });
    } catch (e) {
        // Два одновременных запроса: второй упирается в уникальный индекс (student, course)
        if (e.code === 'DUPLICATE_ENROLLMENT') {
            return res.status(409).json({ msg: 'You are already enrolled in this course.', code: 'ALREADY_ENROLLED' });
        }
        throw e;
    }

    // В будущем здесь можно инициировать процесс оплаты
    // await createPaymentSession(newContract._id);

    res.status(201).json({
        msg: isFree ? 'Successfully enrolled.' : 'Successfully enrolled. Awaiting payment.',
        contract: newContract,
    });
};


/**
 * @desc    Получить список всех своих учебных контрактов (курсов, на которые записан).
 * @route   GET /api/v2/my-training/contracts
 * @access  Private
 */
const getMyContracts = async (req, res) => {
    // Изоляция по клубу (#7): если активный клуб определён — только контракты этого клуба
    // Джойны course + coach.user — в шве (app-level, без кросс-БД populate)
    const contracts = await contractRepo.findForStudentWithRefs(req.user.id, req.club);

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
    const coachProfile = await coachRepo.findByUser(req.user.id);
    if (!coachProfile) {
        return res.status(404).json({ msg: 'Coach profile not found.', code: 'COACH_PROFILE_REQUIRED' });
    }

    // 2. Контракты, где этот тренер — куратор. Джойны student + course(title) — в шве.
    // Изоляция по клубу (#7): если активный клуб определён — только контракты этого клуба
    const contracts = await contractRepo.findForCoachWithRefs(coachProfile._id, req.club);

    res.json({ data: contracts });
};


module.exports = {
    enrollInCourse,
    getMyContracts,
    getMyStudents
};