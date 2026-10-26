// v2/models/ClassroomSession.js
//
// Экземпляр реально проведённого занятия в Интерактивном классе (в отличие от Schedule — это ПЛАН
// события, а Course.lessons — учебный контент). Создаётся при первом входе в урок из расписания,
// связывает событие расписания с группой, фиксирует фактические время начала/конца и посещаемость.
// Живое состояние доски во время урока держит classroomManager (Redis/память); сюда попадает только
// то, что должно пережить урок: кто пришёл и когда он шёл. Посещаемость дополняют LiveKit-вебхуки.

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Одна запись присутствия на пользователя за сессию; lastSeenAt обновляется при повторных входах
// и по LiveKit-вебхукам (participant_joined/left), leftAt ставится, когда участник вышел окончательно.
const AttendanceSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },
    role: { type: String, enum: ['coach', 'student'], required: true },
    joinedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
}, { _id: false });

const ClassroomSessionSchema = new Schema({
    // Клуб-владелец (мульти-арендность #7). Проставляется при создании из req.club.
    club: { type: Schema.Types.ObjectId, ref: 'Club', index: true },
    // Группа — для групповых занятий; у индивидуальных (1-на-1) группы нет (null), вместо неё student.
    group: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    student: { type: Schema.Types.ObjectId, ref: 'TestUser', default: null }, // ученик индивидуального урока
    coach: { type: Schema.Types.ObjectId, ref: 'Coach', required: true }, // кто проводит (из Schedule.coach)
    // Событие расписания, из которого вошли. Опционально: сессия может быть ad-hoc (без события).
    schedule: { type: Schema.Types.ObjectId, ref: 'ScheduleV2', default: null },
    status: { type: String, enum: ['live', 'ended'], default: 'live' },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    attendance: [AttendanceSchema],
}, { timestamps: true });

// История занятий группы (карточка группы, календарь)
ClassroomSessionSchema.index({ group: 1, startedAt: -1 });
// Не более одной ЖИВОЙ сессии на событие расписания — страхует гонку параллельных входов.
// partial: ad-hoc сессии (schedule=null) и завершённые под ограничение не попадают.
ClassroomSessionSchema.index(
    { schedule: 1 },
    { unique: true, partialFilterExpression: { status: 'live', schedule: { $type: 'objectId' } } }
);

module.exports = mongoose.model('ClassroomSession', ClassroomSessionSchema);
