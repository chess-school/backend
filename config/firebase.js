const admin = require('firebase-admin');
// Ключ сервис-аккаунта грузим из пути ВНЕ репозитория (FIREBASE_CREDENTIALS_PATH в .env).
// Старый ключ был закоммичен в git и должен быть отозван (ротация в Google Cloud Console),
// файл удалён из репозитория (он уже в .gitignore). Fallback на локальный файл оставлен
// только для обратной совместимости на время миграции — убрать после ротации.
const credPath =
  process.env.FIREBASE_CREDENTIALS_PATH ||
  '../chess-online-bca59-firebase-adminsdk-zt8tv-c673d17c6b.json';
const serviceAccount = require(credPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const auth = admin.auth();

module.exports = { auth };
