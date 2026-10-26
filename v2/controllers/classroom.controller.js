// v2/controllers/classroom.controller.js
//
// Выдача одноразовых токенов доступа к медиа-микросервису LiveKit (WebRTC SFU) для «Интерактивного
// класса». Видео/аудио/демонстрацию экрана обслуживает отдельный сервис LiveKit; основной бэкенд —
// только «мозг» урока: авторизует участника и подписывает ему JWT с нужными правами.
//
// Комната LiveKit = учебная группа (Group). Роль в комнате выводится из отношения к группе:
//   — тренер группы (Group.coach.user === req.user.id) или ADMIN — coach: публикует камеру/микрофон
//     И демонстрацию экрана, подписан на всех, roomAdmin (может модерировать — mute/kick);
//   — участник группы (Group.members) — student: публикует только камеру/микрофон, подписан на всех,
//     БЕЗ демонстрации экрана по умолчанию;
//   — остальные — 403.

const { AccessToken, TrackSource, WebhookReceiver } = require('livekit-server-sdk');
const Group = require('../models/Group');
const User = require('../models/User');
const Schedule = require('../models/Schedule');
const ClassroomSession = require('../models/ClassroomSession');
const { authorize, roomIdForLesson } = require('../services/classroom/classroomManager');
const { handleLivekitEvent } = require('../services/classroom/livekitWebhook');
const { notFound, forbidden, badRequest } = require('../utils/apiError');

// Источники, которые разрешено публиковать каждой роли
const COACH_SOURCES = [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
const STUDENT_SOURCES = [TrackSource.CAMERA, TrackSource.MICROPHONE];

const TOKEN_TTL = '2h';
const roomName = (groupId) => `classroom-${groupId}`;

/**
 * @route   POST /api/v2/classrooms/:id/token
 * @desc    Выдать JWT доступа к LiveKit-комнате урока (права по роли участника)
 * @access  Private (тренер группы, её участник или ADMIN)
 */
const generateToken = async (req, res) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
        // Конфигурация сервера, а не ошибка клиента — 503, чтобы фронт показал «видео недоступно»
        return res.status(503).json({ msg: 'Media service is not configured.', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    const roomId = req.params.id;
    // Авторизация и роль — единая логика с сокетами и входом из расписания (classroomManager.authorize).
    // Групповая комната (roomId = groupId) или индивидуальная (roomId = `lesson-<eventId>`). ADMIN = права тренера.
    const { role } = await authorize(roomId, req.user);

    // Отображаемое имя участника в сетке видео
    const user = await User.findById(req.user.id).select('firstName lastName avatarUrl').lean();
    const displayName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User' : 'User';

    const at = new AccessToken(apiKey, apiSecret, {
        identity: req.user.id,
        name: displayName,
        // Клиент читает роль/аватар из participant.metadata (сетка, значок тренера)
        metadata: JSON.stringify({ role, uuid: req.user.uuid, avatarUrl: user?.avatarUrl || null }),
        ttl: TOKEN_TTL,
    });
    at.addGrant({
        roomJoin: true,
        room: roomName(roomId),
        canPublish: true,
        canSubscribe: true,
        canPublishData: true, // реакции/служебные data-сообщения LiveKit
        roomAdmin: role === 'coach',
        canPublishSources: role === 'coach' ? COACH_SOURCES : STUDENT_SOURCES,
    });

    const token = await at.toJwt();
    return res.status(200).json({ token, url: livekitUrl, room: roomName(roomId), identity: req.user.id, role });
};

/**
 * @route   POST /api/v2/classrooms/from-schedule/:eventId
 * @desc    Войти в урок из события расписания: создаёт/возобновляет live-сессию и отмечает присутствие.
 *          Возвращает всё нужное клиенту, чтобы дальше взять LiveKit-токен (/:groupId/token) и
 *          подключиться к socket.io namespace /classroom (комната class:<groupId>).
 * @access  Private (тренер группы, её участник или ADMIN)
 */
const enterFromSchedule = async (req, res) => {
    const { eventId } = req.params;
    const event = await Schedule.findById(eventId).select('coach context');
    if (!event) throw notFound('Schedule event not found.', 'EVENT_NOT_FOUND');
    const type = event.context && event.context.type;
    // Живой класс: групповой (комната = группа) или индивидуальный 1-на-1 (комната = `lesson-<eventId>`)
    let roomId, groupId = null, student = null;
    if (type === 'group') {
        groupId = String(event.context.refId);
        roomId = groupId;
    } else if (type === 'individual') {
        roomId = roomIdForLesson(eventId);
        student = String(event.context.refId);
    } else {
        throw badRequest('This schedule event cannot host a classroom.', 'NOT_A_CLASSROOM_EVENT');
    }

    // Авторизация и роль — единая логика с токен-эндпоинтом и сокетами (classroomManager.authorize)
    const { role } = await authorize(roomId, req.user);

    // Идемпотентный вход: одна live-сессия на событие (partial-unique индекс schedule+status страхует гонку)
    let session;
    try {
        session = await ClassroomSession.findOneAndUpdate(
            { schedule: eventId, status: 'live' },
            { $setOnInsert: { group: groupId, student, coach: event.coach, schedule: eventId, status: 'live', startedAt: new Date(), attendance: [], ...(req.club ? { club: req.club } : {}) } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
    } catch (e) {
        if (e.code === 11000) session = await ClassroomSession.findOne({ schedule: eventId, status: 'live' });
        else throw e;
    }

    // Отметка присутствия атомарно (без load-modify-save, чтобы параллельные входы не затирали друг друга)
    const now = new Date();
    const touched = await ClassroomSession.updateOne(
        { _id: session._id, 'attendance.user': req.user.id },
        { $set: { 'attendance.$.lastSeenAt': now, 'attendance.$.leftAt': null } }
    );
    if (touched.matchedCount === 0) {
        await ClassroomSession.updateOne(
            { _id: session._id, 'attendance.user': { $ne: req.user.id } },
            { $push: { attendance: { user: req.user.id, role, joinedAt: now, lastSeenAt: now, leftAt: null } } }
        );
    }

    return res.status(200).json({
        sessionId: String(session._id),
        groupId: roomId, // непрозрачный ключ комнаты: groupId (группа) или `lesson-<eventId>` (индивидуальный)
        room: roomName(roomId),
        role,
        status: session.status,
        startedAt: session.startedAt,
    });
};

/**
 * @route   POST /api/v2/classrooms/sessions/:sessionId/end
 * @desc    Завершить сессию урока (идемпотентно): status=ended, фиксирует время выхода участников.
 * @access  Private (только тренер группы или ADMIN)
 */
const endSession = async (req, res) => {
    const { sessionId } = req.params;
    const session = await ClassroomSession.findById(sessionId);
    if (!session) throw notFound('Classroom session not found.', 'SESSION_NOT_FOUND');

    const roomId = session.group ? String(session.group) : roomIdForLesson(String(session.schedule));
    const { role } = await authorize(roomId, req.user);
    if (role !== 'coach') throw forbidden('Only the coach can end the session.', 'NOT_COACH');

    if (session.status !== 'ended') {
        const now = new Date();
        session.status = 'ended';
        session.endedAt = now;
        session.attendance.forEach((a) => { if (!a.leftAt) a.leftAt = now; });
        await session.save();
    }
    return res.status(200).json({ sessionId: String(session._id), status: session.status, endedAt: session.endedAt });
};

/**
 * @route   GET /api/v2/classrooms/:id/sessions
 * @desc    История занятий группы (последние — первыми). Доступна любому участнику группы.
 * @access  Private (тренер группы, её участник или ADMIN)
 */
const listSessions = async (req, res) => {
    const groupId = req.params.id;
    await authorize(groupId, req.user); // бросит 403/404, если не участник/группа удалена

    const sessions = await ClassroomSession.find({ group: groupId })
        .sort({ startedAt: -1 })
        .limit(100)
        .select('status startedAt endedAt schedule attendance')
        .lean();

    const data = sessions.map((s) => ({
        sessionId: String(s._id),
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        scheduleId: s.schedule ? String(s.schedule) : null,
        attendanceCount: s.attendance.length,
    }));
    return res.status(200).json({ data });
};

/**
 * @route   POST /api/v2/classrooms/webhooks/livekit
 * @desc    Приём серверных событий LiveKit (participant_joined/left, room_finished) → посещаемость.
 *          Аутентификация — подпись LiveKit в заголовке Authorization (НЕ authV2); тело нужно сырым,
 *          поэтому роут монтируется с express.raw. Всегда отвечаем 200 на принятое событие, чтобы
 *          LiveKit не ретраил; невалидная подпись — 401.
 * @access  Public (подписано ключом LiveKit)
 */
const handleLivekitWebhook = async (req, res) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
        return res.status(503).json({ msg: 'Media service is not configured.', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    // express.raw отдаёт Buffer; receiver сверяет sha256 именно сырого тела — не пересобираем из объекта
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : '');
    let event;
    try {
        event = await new WebhookReceiver(apiKey, apiSecret).receive(body, req.headers.authorization);
    } catch (e) {
        return res.status(401).json({ msg: 'Invalid webhook signature.', code: 'WEBHOOK_INVALID_SIGNATURE' });
    }

    const result = await handleLivekitEvent(event);
    return res.status(200).json({ received: true, ...result });
};

module.exports = { generateToken, enterFromSchedule, endSession, listSessions, handleLivekitWebhook };
