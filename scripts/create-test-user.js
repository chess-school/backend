// QA: создаёт/обновляет верифицированного тестового пользователя для смоук-теста (Playwright).
// Печатает email и пароль. Запуск: node scripts/create-test-user.js
require('dotenv').config({ override: true });
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../v2/lib/prisma')();

(async () => {
  const email = `qa.smoke.${Date.now()}@debiut-qa.test`;
  const password = 'QaSmoke!2026';
  const hash = await bcrypt.hash(password, 10);
  const id = crypto.randomBytes(12).toString('hex'); // 24-hex, как Mongo ObjectId

  const user = await prisma.user.create({
    data: {
      id,
      firstName: 'QA',
      lastName: 'Smoke',
      email,
      password: hash,
      emailVerified: true,
      roles: ['USER'],
    },
    select: { id: true, uuid: true, email: true, roles: true, emailVerified: true },
  });

  console.log(JSON.stringify({ ...user, password }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('create-test-user:', e.message); process.exit(1); });
