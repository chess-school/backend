// Единый общий экземпляр PrismaClient на процесс (воркер кластера).
//
// РАНЬШЕ каждый репозиторий (v2/repositories/*.repo.js) делал свой `new PrismaClient()`.
// При ~30 репозиториях × 4 воркерах это давало десятки независимых пулов соединений,
// каждый по умолчанию на (num_cpus*2+1) коннектов → Postgres исчерпывал
// `max_connections` и отдавал плавающие 500 (PrismaClientInitializationError,
// "remaining connection slots are reserved for roles with the SUPERUSER attribute").
//
// ТЕПЕРЬ клиент один на процесс (ленивая инициализация сохранена — при флагах *_DB=mongo
// БД не трогается до первого обращения).
//
// Prisma 7: Rust-движок убран, подключение идёт через driver adapter (@prisma/adapter-pg).
// Размер пула задаём напрямую в адаптере (`max`), а не через `connection_limit` в URL
// (pg-драйвер его не понимает): 4 воркера × max(10) держат сумму коннектов < max_connections.
let _client = null;

// Пул коннектов на воркер. Раньше был connection_limit=10 в DATABASE_URL (Prisma 6);
// в v7 за пул отвечает pg-драйвер адаптера, параметр URL он игнорирует.
const POOL_MAX = Number(process.env.PG_POOL_MAX) || 10;

function getPrisma() {
  if (!_client) {
    const { PrismaClient } = require('@prisma/client');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: POOL_MAX,
    });
    _client = new PrismaClient({ adapter });
  }
  return _client;
}

module.exports = getPrisma;
