// v2/services/classroom/classroomRealtime.js — рассылка событий Интерактивного класса через
// socket.io namespace /classroom. Комнаты: class:<groupId> — все участники урока этой группы.
// Видео/аудио/экран обслуживает LiveKit (отдельный сервис); здесь — только учебная доска,
// «поднять руку», передача хода и жизненный цикл урока.

let nsp = null;

const classRoom = (groupId) => `class:${groupId}`;
// Подкомната только для тренеров урока — для данных, которые нельзя слать ученикам
// (текст решения, линия решения, ответы учеников). Сокет тренера входит в неё при join_class.
const coachRoom = (groupId) => `classcoach:${groupId}`;

const setClassroomNamespace = (namespace) => { nsp = namespace; };
const emitToClass = (groupId, event, payload) => { if (nsp) nsp.to(classRoom(groupId)).emit(event, payload); };
const emitToClassCoaches = (groupId, event, payload) => { if (nsp) nsp.to(coachRoom(groupId)).emit(event, payload); };

module.exports = { setClassroomNamespace, emitToClass, emitToClassCoaches, classRoom, coachRoom };
