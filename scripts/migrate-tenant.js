// ETL волны tenant/coaching-остатки: MongoDB Atlas → PostgreSQL.
// clubs + clubmemberships + groups + playerv2 + coachapplications + coachrequests.
// Запуск: node scripts/migrate-tenant.js [--dry]. Atlas ТОЛЬКО на чтение. Идемпотентно (_id→PK, skipDuplicates).
// Читаем через v2-модели → правильные коллекции (Player → модель 'PlayerV2', коллекция playerv2;
// legacy `schedules`/`players` НЕ трогаем). Вложенное (limits/billing/botConfig/ratings/fideProfile) → колонки/Json.
// См. docs/postgres-migration/MIGRATION-PLAN.md.

require('dotenv').config();
const mongoose = require('mongoose');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');
const BATCH = 500;
const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const ids = (a) => (a || []).map(String);
const sid = (v) => (v ? String(v) : null);

const toClubRow = (d) => ({
  id: String(d._id),
  name: d.name,
  slug: d.slug,
  city: d.city ?? null,
  logoUrl: d.logoUrl ?? null,
  brandPrimaryColor: d.brand?.primaryColor ?? '#2B50E0',
  ownerId: String(d.owner),
  plan: d.plan ?? 'start',
  status: d.status ?? 'active',
  limitsMaxStudents: d.limits?.maxStudents ?? null,
  limitsMaxTrainers: d.limits?.maxTrainers ?? null,
  limitsMaxLessonSize: d.limits?.maxLessonSize ?? null,
  billingStripeCustomerId: d.billing?.stripeCustomerId ?? null,
  billingStripeSubscriptionId: d.billing?.stripeSubscriptionId ?? null,
  billingCurrentPeriodEnd: d.billing?.currentPeriodEnd ?? null,
  botConfig: plain(d.botConfig),
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toMembershipRow = (d) => ({
  id: String(d._id),
  clubId: String(d.club),
  userId: String(d.user),
  role: d.role,
  status: d.status ?? 'active',
  childrenIds: ids(d.children),
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toGroupRow = (d) => ({
  id: String(d._id),
  clubId: sid(d.club),
  name: d.name,
  description: d.description ?? null,
  coachId: String(d.coach),
  memberIds: ids(d.members),
  status: d.status ?? 'active',
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toPlayerRow = (d) => ({
  id: String(d._id),
  userId: String(d.user),
  ratings: plain(d.ratings),
  statsTotalWins: d.stats?.totalWins ?? 0,
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toAppRow = (d) => ({
  id: String(d._id),
  clubId: sid(d.club),
  applicantId: String(d.applicant),
  headline: d.headline ?? '',
  motivation: d.motivation,
  experience: d.experience ?? '',
  specializations: d.specializations ?? [],
  contact: d.contact ?? '',
  fideProfile: plain(d.fideProfile),
  sourceLang: d.sourceLang ?? 'en',
  status: d.status ?? 'pending',
  adminNote: d.adminNote ?? '',
  decidedAt: d.decidedAt ?? null,
  decidedById: sid(d.decidedBy),
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toReqRow = (d) => ({
  id: String(d._id),
  clubId: sid(d.club),
  studentId: String(d.student),
  coachId: String(d.coach),
  experience: d.experience,
  goals: d.goals ?? '',
  status: d.status ?? 'pending',
  decidedAt: d.decidedAt ?? null,
  enrollmentId: sid(d.enrollment),
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

async function migrateCollection(Model, toRow, prismaDelegate, label) {
  const total = await Model.countDocuments();
  console.log(`[etl] источник Atlas: ${total} ${label}`);
  if (DRY) return;
  let migrated = 0, skipped = 0;
  const cursor = Model.find().lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const rows = buf.map(toRow);
    const res = await prismaDelegate.createMany({ data: rows, skipDuplicates: true });
    migrated += res.count;
    skipped += rows.length - res.count;
    buf = [];
    process.stdout.write(`\r[etl] ${label}: перенесено ${migrated}, дублей ${skipped}   `);
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();
  const inPg = await prismaDelegate.count();
  console.log(`\n[etl] ${label}: в PG теперь ${inPg} (перенесено ${migrated}, дублей ${skipped}).`);
}

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI не задан');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не задан');

  await mongoose.connect(process.env.MONGO_URI);
  const Club = require('../v2/models/Club');
  const ClubMembership = require('../v2/models/ClubMembership');
  const Group = require('../v2/models/Group');
  const Player = require('../v2/models/Player'); // модель 'PlayerV2' → коллекция playerv2
  const CoachApplication = require('../v2/models/CoachApplication');
  const CoachRequest = require('../v2/models/CoachRequest');
  const prisma = makeScriptPrisma();

  await migrateCollection(Club, toClubRow, prisma.club, 'clubs');
  await migrateCollection(ClubMembership, toMembershipRow, prisma.clubMembership, 'clubmemberships');
  await migrateCollection(Group, toGroupRow, prisma.group, 'groups');
  await migrateCollection(Player, toPlayerRow, prisma.playerV2, 'playerv2');
  await migrateCollection(CoachApplication, toAppRow, prisma.coachApplication, 'coachapplications');
  await migrateCollection(CoachRequest, toReqRow, prisma.coachRequest, 'coachrequests');

  console.log('\n[etl] готово.');
  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('\n[etl] ОШИБКА:', e); process.exit(1); });
