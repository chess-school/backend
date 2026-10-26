// v2/services/lessonNotify.service.js
//
// Рассылка уведомлений о новом занятии: on-site (колокольчик, модель Notification) + e-mail.
// «От лица тренера»: Gmail не даёт слать с чужого адреса, поэтому имя отправителя = имя тренера,
// а Reply-To = e-mail тренера (ответы ученика уйдут напрямую тренеру). Отправка не должна ронять
// создание занятия — ошибки каждого адресата гасятся, возвращается сводка {total, failed}.
//
// Персонализация: customMessage — общий текст для всех; personalMessages[userId] — личная приписка
// конкретному адресату. В письме есть обращение по имени; оба текста показываются, если заданы.

const Notification = require('../models/Notification');
const { sendEmail } = require('../utils/email/email.service');

const escapeHtml = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const formatDate = (date) => {
    try {
        return new Date(date).toLocaleString('ru-RU', {
            day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return new Date(date).toISOString();
    }
};

const noteBlock = (label, text) => `
    <div style="margin-top:16px;padding:12px 14px;background:#f5f5f5;border-radius:8px">
      ${label ? `<div style="font-size:12px;color:#888;margin-bottom:4px">${escapeHtml(label)}</div>` : ''}
      <div style="white-space:pre-wrap">${escapeHtml(text)}</div>
    </div>`;

const buildHtml = ({ greeting, title, dateText, durationMinutes, meetingLink, siteUrl, coachName, commonNote, personalNote }) => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.5">
    ${greeting ? `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>` : ''}
    <h2 style="color:#111;margin:0 0 12px">Новое занятие в расписании</h2>
    <p style="font-size:17px;margin:0 0 4px"><b>${escapeHtml(title)}</b></p>
    <p style="margin:0 0 4px">📅 ${escapeHtml(dateText)}${durationMinutes ? ` · ${durationMinutes} мин` : ''}</p>
    ${meetingLink ? `<p style="margin:0 0 4px">🔗 Ссылка на занятие: <a href="${encodeURI(meetingLink)}">${escapeHtml(meetingLink)}</a></p>` : ''}
    <p style="margin:12px 0 0">Тренер: ${escapeHtml(coachName)}</p>
    ${commonNote ? noteBlock('', commonNote) : ''}
    ${personalNote ? noteBlock('Лично вам', personalNote) : ''}
    ${siteUrl ? `<p style="margin:20px 0 0"><a href="${encodeURI(siteUrl)}" style="display:inline-block;padding:10px 18px;background:#2e7d32;color:#fff;border-radius:8px;text-decoration:none">Открыть на сайте</a></p>` : ''}
    <hr style="border:none;border-top:1px solid #eee;margin:22px 0"/>
    <p style="color:#888;font-size:13px;margin:0">Письмо отправлено как ученику Chess School. Чтобы ответить тренеру — просто ответьте на это письмо.</p>
  </div>`;

/**
 * @param {object} p
 * @param {object} p.event        — созданное событие (title, date, durationMinutes, link)
 * @param {object} p.coach        — пользователь-тренер (firstName, lastName, email)
 * @param {Array}  p.recipients   — адресаты [{ _id, firstName, lastName, email }]
 * @param {'NEW_GROUP_LESSON'|'NEW_LESSON'} p.type
 * @param {string} [p.customMessage]            — общий текст для всех адресатов
 * @param {Object<string,string>} [p.personalMessages] — личный текст по userId
 * @param {string} [p.baseUrl]                  — базовый URL фронта для ссылки «Открыть на сайте»
 */
const notifyLessonScheduled = async ({ event, coach, recipients, type, customMessage, personalMessages, baseUrl }) => {
    const dateText = formatDate(event.date);
    const coachName = `${coach.firstName || ''} ${coach.lastName || ''}`.trim() || 'Ваш тренер';
    const path = type === 'NEW_GROUP_LESSON' ? '/my-classes' : '/students-shedule';
    const siteUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : '';
    const common = typeof customMessage === 'string' ? customMessage.trim() : '';
    const personalMap = personalMessages && typeof personalMessages === 'object' ? personalMessages : {};
    const subject = `Новое занятие: ${event.title}`;

    const tasks = (recipients || []).map(async (r) => {
        const personal = typeof personalMap[String(r._id)] === 'string' ? personalMap[String(r._id)].trim() : '';
        const greeting = r.firstName ? `Здравствуйте, ${r.firstName}!` : '';
        // on-site: к базовому тексту добавляем личную приписку, иначе общую
        const extra = personal || common;
        const notifMessage = `Новое занятие «${event.title}» — ${dateText}. Тренер: ${coachName}.${extra ? ` ${extra}` : ''}`;
        await Notification.create({ recipient: r._id, type, message: notifMessage, metadata: { link: path } });

        if (r.email) {
            const html = buildHtml({
                greeting, title: event.title, dateText, durationMinutes: event.durationMinutes,
                meetingLink: event.link, siteUrl, coachName, commonNote: common, personalNote: personal,
            });
            await sendEmail(r.email, subject, html, { fromName: `${coachName} · Chess School`, replyTo: coach.email || undefined });
        }
    });

    const results = await Promise.allSettled(tasks);
    const failed = results.filter((x) => x.status === 'rejected').length;
    if (failed) console.error(`lessonNotify: ${failed}/${results.length} адресатов с ошибкой`);
    return { total: results.length, failed };
};

module.exports = { notifyLessonScheduled };
