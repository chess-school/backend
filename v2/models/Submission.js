// models/Submission.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubmissionSchema = new Schema({
    // Клуб-владелец (мульти-арендность #7). Проставляется при создании из req.club (или наследуется от Assignment).
    club: { type: Schema.Types.ObjectId, ref: 'Club', index: true },
    // На какое задание это ответ
    assignment: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
    // Какой студент его сдал
    student: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true },

    // Содержимое ответа
    contentText: { type: String },
    contentFileUrl: { type: String }, // Ссылка на загруженный файл (скриншот, PGN-файл)
    // Вложение (скриншот позиции), хранится в документе; data не выбирается по умолчанию —
    // списки сдач не тянут мегабайты картинок. Отдаётся через GET /submissions/:id/attachment
    attachment: {
        data: { type: Buffer, select: false },
        contentType: { type: String },
        size: { type: Number },
        filename: { type: String },
    },
    submittedAt: { type: Date, default: Date.now }, // время последней (пере)сдачи

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
// Успеваемость студента: все его сдачи по статусам
SubmissionSchema.index({ student: 1, status: 1 });

module.exports = mongoose.model('Submission', SubmissionSchema);