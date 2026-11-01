// Шов хранения клубов (v2 Club) — strangler MongoDB → PostgreSQL. Флаг TENANT_DB: 'mongo'|'pg'.
// Отдаёт форму Mongo-дока Club: { _id, name, slug, city, logoUrl, brand:{primaryColor}, owner,
// plan, limits:{...}, status, billing:{...}, botConfig, createdAt, updatedAt }.
const mongoose = require('mongoose');
const ClubMongo = require('../models/Club');

const usePg = () => String(process.env.TENANT_DB || 'mongo').toLowerCase() === 'pg';
let _prisma = null;
const prisma = () => { if (!_prisma) { const { PrismaClient } = require('@prisma/client'); _prisma = new PrismaClient(); } return _prisma; };
const newId = () => new mongoose.Types.ObjectId().toString();

// Лимиты тарифа (та же карта, что в v2/models/Club.js pre-save).
const PLAN_LIMITS = {
  start: { maxStudents: 30, maxTrainers: 1, maxLessonSize: 8 },
  club: { maxStudents: 150, maxTrainers: 10, maxLessonSize: 30 },
  academy: { maxStudents: null, maxTrainers: null, maxLessonSize: null },
};
const limitsForPlan = (plan) => ({ ...(PLAN_LIMITS[plan] || PLAN_LIMITS.start) });

const pgRowToDoc = (r) => r && {
  _id: r.id,
  name: r.name,
  slug: r.slug,
  city: r.city ?? undefined,
  logoUrl: r.logoUrl ?? undefined,
  brand: { primaryColor: r.brandPrimaryColor },
  owner: r.ownerId,
  plan: r.plan,
  limits: { maxStudents: r.limitsMaxStudents, maxTrainers: r.limitsMaxTrainers, maxLessonSize: r.limitsMaxLessonSize },
  status: r.status,
  billing: { stripeCustomerId: r.billingStripeCustomerId ?? undefined, stripeSubscriptionId: r.billingStripeSubscriptionId ?? undefined, currentPeriodEnd: r.billingCurrentPeriodEnd ?? undefined },
  botConfig: r.botConfig ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
};

// patch (форма Mongo-дока, в т.ч. вложенные brand/limits/billing) -> плоские PG-колонки.
const pgData = (p) => {
  const d = {};
  if (p.name !== undefined) d.name = p.name;
  if (p.slug !== undefined) d.slug = p.slug;
  if (p.city !== undefined) d.city = p.city ?? null;
  if (p.logoUrl !== undefined) d.logoUrl = p.logoUrl ?? null;
  if (p.owner !== undefined) d.ownerId = String(p.owner);
  if (p.plan !== undefined) d.plan = p.plan;
  if (p.status !== undefined) d.status = p.status;
  if (p.brand && p.brand.primaryColor !== undefined) d.brandPrimaryColor = p.brand.primaryColor;
  if (p.limits) {
    if (p.limits.maxStudents !== undefined) d.limitsMaxStudents = p.limits.maxStudents;
    if (p.limits.maxTrainers !== undefined) d.limitsMaxTrainers = p.limits.maxTrainers;
    if (p.limits.maxLessonSize !== undefined) d.limitsMaxLessonSize = p.limits.maxLessonSize;
  }
  if (p.billing) {
    if (p.billing.stripeCustomerId !== undefined) d.billingStripeCustomerId = p.billing.stripeCustomerId ?? null;
    if (p.billing.stripeSubscriptionId !== undefined) d.billingStripeSubscriptionId = p.billing.stripeSubscriptionId ?? null;
    if (p.billing.currentPeriodEnd !== undefined) d.billingCurrentPeriodEnd = p.billing.currentPeriodEnd ?? null;
  }
  if (p.botConfig !== undefined) d.botConfig = p.botConfig;
  return d;
};

async function findById(id) {
  if (usePg()) return pgRowToDoc(await prisma().club.findUnique({ where: { id: String(id) } })) || null;
  return ClubMongo.findById(id).lean();
}

// findOne({ slug, status:'active' }) — публичная витрина/окно входа.
async function findActiveBySlug(slug) {
  if (usePg()) return pgRowToDoc(await prisma().club.findFirst({ where: { slug: String(slug).toLowerCase(), status: 'active' } })) || null;
  return ClubMongo.findOne({ slug: String(slug).toLowerCase(), status: 'active' }).lean();
}

// findOne({ _id, status:'active' }).
async function findActiveById(id) {
  if (usePg()) return pgRowToDoc(await prisma().club.findFirst({ where: { id: String(id), status: 'active' } })) || null;
  return ClubMongo.findOne({ _id: id, status: 'active' }).lean();
}

async function existsBySlug(slug) {
  if (usePg()) return !!(await prisma().club.findUnique({ where: { slug: String(slug).toLowerCase() }, select: { id: true } }));
  return !!(await ClubMongo.exists({ slug: String(slug).toLowerCase() }));
}

async function create(data) {
  if (usePg()) {
    const plan = data.plan || 'start';
    const limits = data.limits || limitsForPlan(plan);
    const row = await prisma().club.create({ data: { id: newId(), ...pgData({ ...data, plan, limits }) } });
    return pgRowToDoc(row);
  }
  return (await ClubMongo.create(data)).toObject();
}

// updateById(id, patch) -> обновлённый док. При смене plan пересчитываем limits (как pre-save).
async function updateById(id, patch = {}) {
  const p = { ...patch };
  if (p.plan !== undefined && p.limits === undefined) p.limits = limitsForPlan(p.plan);
  if (usePg()) {
    try { return pgRowToDoc(await prisma().club.update({ where: { id: String(id) }, data: pgData(p) })); }
    catch (e) { if (e.code === 'P2025') return null; throw e; }
  }
  const set = {};
  if (p.brand && p.brand.primaryColor !== undefined) set['brand.primaryColor'] = p.brand.primaryColor;
  for (const k of ['name', 'slug', 'city', 'logoUrl', 'owner', 'plan', 'status', 'limits', 'billing', 'botConfig']) if (p[k] !== undefined) set[k] = p[k];
  return ClubMongo.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
}

module.exports = {
  findById, findActiveBySlug, findActiveById, existsBySlug, create, updateById,
  limitsForPlan, PLAN_LIMITS, usePg, _pgRowToDoc: pgRowToDoc,
};
