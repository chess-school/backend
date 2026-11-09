// Единый общий экземпляр PrismaClient на процесс (воркер кластера).
//
// РАНЬШЕ каждый репозиторий (v2/repositories/*.repo.js) делал свой `new PrismaClient()`.
// При ~30 репозиториях × 4 воркерах это давало десятки независимых пулов соединений,
// каждый по умолчанию на (num_cpus*2+1) коннектов → Postgres исчерпывал
// `max_connections` и отдавал плавающие 500 (PrismaClientInitializationError,
// "remaining connection slots are reserved for roles with the SUPERUSER attribute").
//
// ТЕПЕРЬ клиент один на процесс (ленивая инициализация сохранена — при флагах *_DB=mongo
// БД не трогается до первого обращения). Размер пула задаётся `connection_limit`
// в DATABASE_URL (см. .env): 4 воркера × connection_limit держат сумму < max_connections.
let _client = null;

function getPrisma() {
  if (!_client) {
    const { PrismaClient } = require('@prisma/client');
    _client = new PrismaClient();
  }
  return _client;
}

module.exports = getPrisma;
