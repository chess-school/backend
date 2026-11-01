// services/storage/s3.driver.js — драйвер S3-совместимого хранилища (цель плана — Cloudflare R2).
// Клиент @aws-sdk/client-s3 подгружается ЛЕНИВО (только когда реально выбран драйвер s3), чтобы
// дефолтный путь (mongo) не зависел от наличия пакета/конфигурации.
//
// Переменные окружения:
//   S3_ENDPOINT           — напр. https://<accountid>.r2.cloudflarestorage.com (для R2 обязателен)
//   S3_REGION             — по умолчанию 'auto' (R2)
//   S3_ACCESS_KEY_ID      — ключ доступа
//   S3_SECRET_ACCESS_KEY  — секрет
//   S3_BUCKET             — имя бакета
//   S3_PUBLIC_URL         — публичный базовый URL бакета/CDN (напр. https://media.club.com)
//   S3_FORCE_PATH_STYLE   — 'true' для path-style (некоторые S3-совместимые)

let _client = null;
let _sdk = null;

const sdk = () => {
    if (!_sdk) _sdk = require('@aws-sdk/client-s3'); // ленивый require
    return _sdk;
};

const client = () => {
    if (_client) return _client;
    const { S3Client } = sdk();
    _client = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
    });
    return _client;
};

const publicBase = () => (process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '');

const put = async ({ key, body, contentType }) => {
    const { PutObjectCommand } = sdk();
    await client().send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
    }));
    return { url: `${publicBase()}/${key}` };
};

const remove = async (keys) => {
    if (!keys || !keys.length) return;
    const { DeleteObjectsCommand } = sdk();
    await client().send(new DeleteObjectsCommand({
        Bucket: process.env.S3_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
};

// В s3 файлы отдаёт сам бакет/CDN по прямой ссылке — наш отдающий роут их не обслуживает.
const read = async () => null;

module.exports = { name: 's3', put, remove, read };
