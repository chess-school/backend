// Prisma 7 config (CommonJS — проект на require).
// В v7 URL-ы подключения нельзя держать в schema.prisma: для Migrate CLI
// (migrate deploy/dev/status, db execute) они задаются здесь. Рантайм приложения
// подключается отдельно через driver adapter (@prisma/adapter-pg) — см. v2/lib/prisma.js.
//
// v7 НЕ грузит .env сам — подключаем dotenv явно (как server.js).
require('dotenv').config();

const { defineConfig, env } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
});
