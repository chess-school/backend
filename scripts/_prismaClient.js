// Отдельный PrismaClient для one-off скриптов (ETL-миграции, импорт корпуса).
//
// Prisma 7: Rust-движок убран — подключение обязано идти через driver adapter
// (@prisma/adapter-pg). Размер пула задаём напрямую (`max`), а не через
// `connection_limit` в URL (pg-драйвер этот Prisma-параметр игнорирует).
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

/**
 * @param {number} [max=10] размер пула pg. Скрипты импорта берут меньше (5),
 *   чтобы не конкурировать за коннекты с кластером приложения.
 * @returns {import('@prisma/client').PrismaClient}
 */
module.exports = function makeScriptPrisma(max = 10) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL не задан (нужен для подключения к Postgres)');
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max });
  return new PrismaClient({ adapter });
};
