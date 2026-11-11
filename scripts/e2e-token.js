// Минтит короткоживущий accessToken для e2e-прогона (Playwright): берёт существующего юзера,
// подписывает тем же payload/секретом, что и логин (accessToken.js сверит sessionTokenVersion с БД).
// Печатает ТОЛЬКО сам токен в stdout. Запуск: node scripts/e2e-token.js [--role=ADMIN|COACH]
require('dotenv').config();
const jwt = require('jsonwebtoken');
const prisma = require('../v2/lib/prisma')();

const roleArg = (process.argv.find((a) => a.startsWith('--role=')) || '').split('=')[1];

(async () => {
  const where = roleArg ? { roles: { has: roleArg } } : {};
  const user = await prisma.user.findFirst({
    where,
    select: { id: true, roles: true, uuid: true, sessionTokenVersion: true },
  });
  if (!user) { console.error('e2e-token: нет подходящего пользователя'); process.exit(1); }
  // payload ДОЛЖЕН совпадать с generateAccessToken (auth.controller.js): { id, roles, sessionTokenVersion, uuid, ver:2 }
  const payload = { id: user.id, roles: user.roles, sessionTokenVersion: user.sessionTokenVersion, uuid: user.uuid, ver: 2 };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '6h' });
  process.stdout.write(token);
  process.exit(0);
})().catch((e) => { console.error('e2e-token:', e.message); process.exit(1); });
