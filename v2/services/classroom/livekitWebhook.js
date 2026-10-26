// v2/services/classroom/livekitWebhook.js
//
// Применение серверных событий LiveKit к посещаемости живого урока. Подпись вебхука проверяет
// контроллер (WebhookReceiver); сюда приходит уже разобранное событие, а мы отражаем его в активной
// ClassroomSession группы. Комната LiveKit называется classroom-<groupId>, identity участника = userId
// (выставляется в classroom.controller.generateToken), роль лежит в participant.metadata ({ role }).
//
// Это «мягкий» источник присутствия: HTTP-вход из расписания (from-schedule) уже создаёт сессию и
// первую запись, а вебхуки лишь уточняют реальное время входа/выхода и ловят тех, кто подключился к
// медиа без обращения к нашему бэкенду. Нет живой сессии — событие просто игнорируется.

const mongoose = require('mongoose');
const ClassroomSession = require('../../models/ClassroomSession');

const ROOM_PREFIX = 'classroom-';
const LESSON_PREFIX = 'lesson-'; // индивидуальная комната: classroom-lesson-<eventId>

const groupIdFromRoom = (roomName) =>
    typeof roomName === 'string' && roomName.startsWith(ROOM_PREFIX) ? roomName.slice(ROOM_PREFIX.length) : null;

// Активная сессия по имени комнаты LiveKit: группа (classroom-<groupId>) или индивидуальный урок
// (classroom-lesson-<eventId>). null — комната не наша/нет живой сессии.
const liveSessionForRoom = async (roomName) => {
    const ref = groupIdFromRoom(roomName);
    if (!ref) return null;
    if (ref.startsWith(LESSON_PREFIX)) {
        const eventId = ref.slice(LESSON_PREFIX.length);
        if (!mongoose.Types.ObjectId.isValid(eventId)) return null;
        return ClassroomSession.findOne({ schedule: eventId, status: 'live' }).sort({ startedAt: -1 });
    }
    if (!mongoose.Types.ObjectId.isValid(ref)) return null;
    return ClassroomSession.findOne({ group: ref, status: 'live' }).sort({ startedAt: -1 });
};

const parseRole = (metadata) => {
    try {
        return JSON.parse(metadata).role === 'coach' ? 'coach' : 'student';
    } catch {
        return 'student';
    }
};

/**
 * Применяет одно событие LiveKit к активной сессии группы.
 * @param {{ event: string, room?: { name?: string }, participant?: { identity?: string, metadata?: string } }} event
 * @returns {Promise<{ ok?: string, ignored?: string }>} — что сделали (для логов/тестов)
 */
const handleLivekitEvent = async (event) => {
    const roomName = event && event.room && event.room.name;
    if (!groupIdFromRoom(roomName)) return { ignored: 'not-a-classroom-room' };

    // Самая свежая живая сессия комнаты (группа или индивидуальный урок)
    const session = await liveSessionForRoom(roomName);
    if (!session) return { ignored: 'no-live-session' };

    const identity = event.participant && event.participant.identity;
    const now = new Date();

    switch (event.event) {
        case 'participant_joined': {
            if (!identity || !mongoose.Types.ObjectId.isValid(identity)) return { ignored: 'bad-identity' };
            const role = parseRole(event.participant.metadata);
            // Атомарно: обновить существующую запись либо добавить новую (параллельные вебхуки не затирают)
            const touched = await ClassroomSession.updateOne(
                { _id: session._id, 'attendance.user': identity },
                { $set: { 'attendance.$.lastSeenAt': now, 'attendance.$.leftAt': null } }
            );
            if (touched.matchedCount === 0) {
                await ClassroomSession.updateOne(
                    { _id: session._id, 'attendance.user': { $ne: identity } },
                    { $push: { attendance: { user: identity, role, joinedAt: now, lastSeenAt: now, leftAt: null } } }
                );
            }
            return { ok: 'joined' };
        }
        case 'participant_left':
        case 'participant_connection_aborted': {
            if (!identity || !mongoose.Types.ObjectId.isValid(identity)) return { ignored: 'bad-identity' };
            await ClassroomSession.updateOne(
                { _id: session._id, 'attendance.user': identity },
                { $set: { 'attendance.$.leftAt': now } }
            );
            return { ok: 'left' };
        }
        case 'room_finished': {
            session.status = 'ended';
            session.endedAt = now;
            session.attendance.forEach((a) => { if (!a.leftAt) a.leftAt = now; });
            await session.save();
            return { ok: 'finished' };
        }
        default:
            return { ignored: event.event || 'unknown' };
    }
};

module.exports = { handleLivekitEvent, groupIdFromRoom, parseRole, ROOM_PREFIX };
