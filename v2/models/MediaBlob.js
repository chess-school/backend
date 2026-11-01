// models/MediaBlob.js — байты файла для драйвера хранилища `mongo` (дефолт, без внешней инфры).
// Вынесено из MediaAsset отдельной коллекцией, чтобы список медиатеки (MediaAsset.find) НЕ тянул
// тяжёлые буферы — он читает только метаданные, а байты отдаёт публичный роут GET /site/media/file/*.
// Когда клуб переключат на S3/R2 (env), этот драйвер не используется и коллекция остаётся пустой.

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MediaBlobSchema = new Schema({
    key: { type: String, required: true, unique: true, index: true },   // совпадает с variant.key
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
    contentType: { type: String, trim: true, maxlength: 60 },
    data: { type: Buffer, required: true },
}, { timestamps: true });

module.exports = mongoose.model('MediaBlob', MediaBlobSchema);
