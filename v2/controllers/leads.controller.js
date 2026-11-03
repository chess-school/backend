// leads.controller.js — заявки на пробное (Leads).
// Публичный приём с сайта клуба (антиспам) + кабинет владельца (список, смена статуса).

const leadsRepo = require('../repositories/leads.repo');
const clubRepo = require('../repositories/club.repo');
const coachRepo = require('../repositories/coach.repo');
const userRepo = require('../repositories/user.repo');
const { notify } = require('../services/notify');
const { stripTags } = require('../services/sitePage.service');

const clean = (v, max) => stripTags(typeof v === 'string' ? v : '', max);
const LEVELS = ['new', 'rules', 'tournaments'];
const FORMATS = ['offline', 'online'];

// Простой лимит частоты в памяти процесса (не кластер-wide, но отсекает бот-флуд): 5 заявок/час/IP.
const hits = new Map();
const rateLimited = (ip) => {
  const now = Date.now();
  const since = now - 60 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter((t) => t > since);
  if (arr.length >= 5) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  return false;
};

/** @route POST /api/v2/clubs/by-slug/:slug/leads — ПУБЛИЧНАЯ заявка на пробное. */
const createPublic = async (req, res) => {
  const b = req.body || {};

  // Honeypot: скрытое поле `company` заполняется только ботами — делаем вид, что приняли.
  if (b.company) return res.status(200).json({ ok: true });

  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ msg: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' });

  const club = await clubRepo.findActiveBySlug(String(req.params.slug || '').toLowerCase());
  if (!club) return res.status(404).json({ msg: 'Club not found.', code: 'CLUB_NOT_FOUND' });

  const name = clean(b.name, 120);
  const email = clean(b.email, 200);
  const phone = clean(b.phone, 40);
  if (!name) return res.status(422).json({ msg: 'Name is required.', code: 'VALIDATION_ERROR' });
  if (!email && !phone) return res.status(422).json({ msg: 'Provide an email or a phone number.', code: 'NO_CONTACT' });
  if (b.consent !== true && b.consent !== 'true') return res.status(422).json({ msg: 'Consent to data processing is required.', code: 'NO_CONSENT' });

  const who = b.who === 'child' ? 'child' : 'self';

  // Тренер (если заявка с профиля): coachUuid → user → coach этого клуба.
  let coachId;
  if (b.coachUuid) {
    const u = await userRepo.findByUuid(String(b.coachUuid));
    const coach = u && (await coachRepo.findByUser(u._id));
    if (coach && String(coach.club) === String(club._id)) coachId = coach._id;
  }

  const lead = await leadsRepo.create({
    club: club._id, source: 'site', pagePath: clean(b.pagePath, 300),
    who, name,
    childAge: who === 'child' && Number(b.childAge) ? Math.max(3, Math.min(99, Math.floor(Number(b.childAge)))) : undefined,
    email, phone,
    level: LEVELS.includes(b.level) ? b.level : '',
    format: FORMATS.includes(b.format) ? b.format : '',
    preferredTime: clean(b.preferredTime, 120),
    coach: coachId,
    status: 'new',
    consent: { at: new Date(), ip },
  });

  // Уведомление владельцу (+ тренеру, если заявка к нему). Тип SYSTEM_ANNOUNCEMENT —
  // отдельный LEAD_CREATED добавим позже (чтобы сейчас не трогать enum в проде).
  const msg = `New trial request from ${name}`;
  const desc = email || phone;
  await notify({ recipient: club.owner, type: 'SYSTEM_ANNOUNCEMENT', message: msg, description: desc, link: '/club/leads', entity: { type: 'User', id: String(lead._id) } });
  if (coachId && b.coachUuid) {
    const u = await userRepo.findByUuid(String(b.coachUuid));
    if (u && String(u._id) !== String(club.owner)) {
      await notify({ recipient: u._id, type: 'SYSTEM_ANNOUNCEMENT', message: msg, description: desc, link: '/club/leads' });
    }
  }

  res.status(201).json({ ok: true });
};

/** @route GET /api/v2/leads?status= — список заявок активного клуба (владелец). */
const list = async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const leads = await leadsRepo.listByClub(req.club, { status });
  res.json({ data: leads });
};

/** @route PATCH /api/v2/leads/:id — сменить статус/заметку (владелец). */
const update = async (req, res) => {
  const b = req.body || {};
  const patch = {};
  const STATUSES = ['new', 'contacted', 'trial_scheduled', 'trial_done', 'converted', 'lost'];
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(422).json({ msg: 'Invalid status.', code: 'VALIDATION_ERROR' });
    patch.status = b.status;
  }
  if (b.note !== undefined) patch.note = clean(b.note, 2000);
  if (b.lostReason !== undefined) patch.lostReason = clean(b.lostReason, 300);
  const lead = await leadsRepo.updateInClub(req.club, req.params.id, patch);
  if (!lead) return res.status(404).json({ msg: 'Lead not found.', code: 'LEAD_NOT_FOUND' });
  res.json({ data: lead });
};

module.exports = { createPublic, list, update };
