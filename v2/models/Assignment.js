// models/Assignment.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AssignmentSchema = new Schema({
    title: { type: String, required: true },
    description: { type: String }, // Подробное описание задания
    
    // Кем создано задание
    author: { type: Schema.Types.ObjectId, ref: 'Coach', required: true },
    
    // Для кого предназначено задание (та же логика, что и в Schedule)
    context: {
        type: {
            type: String,
            required: true,
            enum: ['student', 'group', 'course'], // Персонально, для группы, для всего курса
        },
        refId: { type: Schema.Types.ObjectId, required: true }
    },
    
    // Опционально: может быть привязано к конкретному уроку в курсе
    lesson: { type: Schema.Types.ObjectId },

    // Занятие в расписании, к которому задано ДЗ (не больше одного ДЗ на занятие)
    schedule: { type: Schema.Types.ObjectId, ref: 'ScheduleV2' },
    
    dueDate: { type: Date }, // Срок сдачи

}, { timestamps: true });

AssignmentSchema.index({ author: 1, createdAt: -1 }); // ДЗ тренера
AssignmentSchema.index({ 'context.type': 1, 'context.refId': 1 }); // ДЗ студента / группы / курса
AssignmentSchema.index({ schedule: 1 }, { unique: true, partialFilterExpression: { schedule: { $type: 'objectId' } } });

module.exports = mongoose.model('Assignment', AssignmentSchema);