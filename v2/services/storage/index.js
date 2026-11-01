// services/storage/index.js — абстракция хранилища файлов медиатеки (шаг 2 плана сайтов клубов).
//
// Два драйвера за единым интерфейсом:
//   • mongo (ПО УМОЛЧАНИЮ) — байты в коллекции MediaBlob, отдача через GET /site/media/file/*.
//                            Работает сразу, без внешней инфраструктуры и без ключей.
//   • s3    — S3-совместимое хранилище (цель плана — Cloudflare R2: дёшево, за отдачу не платишь).
//             Включается переменными окружения; файлы отдаёт сам бакет/CDN.
//
// Так деплой шага 2 не блокируется провиженом R2: сегодня работает на mongo, завтра выставили
// S3_* и STORAGE_DRIVER=s3 — новые загрузки уходят в R2 (старые mongo-ссылки продолжают жить).
//
// Интерфейс драйвера:
//   name                                   — 'mongo' | 's3'
//   put({ key, body, contentType, club })  → { url }   — сохранить объект, вернуть публичную ссылку
//   remove(keys: string[])                 → Promise    — удалить объекты по ключам (тихо к отсутствующим)
//   read(key)                              → { data, contentType } | null  — прочитать (только mongo)

const mongoDriver = require('./mongo.driver');
const s3Driver = require('./s3.driver');

// Явный выбор через STORAGE_DRIVER; иначе — s3, если настроен бакет и ключи, иначе mongo.
const resolveDriverName = () => {
    const explicit = (process.env.STORAGE_DRIVER || '').toLowerCase().trim();
    if (explicit === 'mongo' || explicit === 's3') return explicit;
    if (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) return 's3';
    return 'mongo';
};

let cached = null;
const driver = () => {
    const name = resolveDriverName();
    if (!cached || cached.name !== name) {
        cached = name === 's3' ? s3Driver : mongoDriver;
    }
    return cached;
};

module.exports = {
    driverName: () => driver().name,
    put: (args) => driver().put(args),
    remove: (keys) => driver().remove(keys),
    read: (key) => driver().read(key),
};
