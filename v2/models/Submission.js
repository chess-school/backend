// models/Submission.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubmissionSchema = new Schema({
    // На какое задание это ответ
    assignment: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
    // Какой студент его сдал
    student: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },

    // Содержимое ответа
    contentText: { type: String },
    contentFileUrl: { type: String }, // Ссылка на загруженный файл (скриншот, PGN-файл)

    // Статус и оценка
    status: {
        type: String,
        enum: ['submitted', 'needs_revision', 'approved'],
        default: 'submitted'
    },
    review: {
        comment: { type: String },
        reviewedBy: { type: Schema.Types.ObjectId, ref: 'Coach' },
        reviewedAt: { type: Date },
    },
}, { timestamps: true });

// Уникальный индекс, чтобы студент не мог сдать одно ДЗ дважды
SubmissionSchema.index({ assignment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('Submission', SubmissionSchema);