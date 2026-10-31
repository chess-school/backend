// Единая точка создания уведомлений. Все домены зовут notify(...) вместо
// прямого Notification.create — так эмит идёт через репозиторий-шов (mongo|pg)
// и мы централизованно решаем форму/ошибкоустойчивость.
//
// Уведомления НЕ должны ронять бизнес-операцию: ошибку эмита логируем и глотаем.

const repo = require('../repositories/notification.repo');

/**
 * @param {Object} p
 * @param {string} p.recipient            id пользователя-получателя
 * @param {string} p.type                 значение enum NotificationType
 * @param {string} p.message              короткий текст
 * @param {string} [p.description]         доп. текст
 * @param {string} [p.link]               ссылка (metadata.link)
 * @param {{type:string,id:string}} [p.entity]  связанная сущность (metadata.entity)
 */
async function notify({ recipient, type, message, description, link, entity }) {
  if (!recipient || !type) return null;
  try {
    return await repo.create({ recipient, type, message, description, link, entity });
  } catch (err) {
    console.error(`[notify] failed type=${type} recipient=${recipient}:`, err.message);
    return null;
  }
}

/** Разослать одно и то же уведомление нескольким получателям. */
async function notifyMany(recipients, payload) {
  const ids = [...new Set((recipients || []).map((r) => String(r)).filter(Boolean))];
  return Promise.all(ids.map((recipient) => notify({ ...payload, recipient })));
}

module.exports = { notify, notifyMany };
