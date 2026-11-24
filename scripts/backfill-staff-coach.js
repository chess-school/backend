// Бэкфилл капабилити «вести обучение» для уже существующих участников клубов.
// До фикса онбординга владелец клуба не получал глобальную роль COACH + коуч-профиль,
// поэтому не видел кабинет/обучающие функции. Пробегаем все активные членства с обучающей
// ролью (owner/admin/trainer) и выдаём COACH + коуч-профиль (идемпотентно).
//
// Запуск:  node scripts/backfill-staff-coach.js [--dry]
// Требует TENANT_DB/USER_DB/COACHING_DB=pg (как в проде). Безопасно повторять.

require('dotenv').config();
const userRepo = require('../v2/repositories/user.repo');
const coachRepo = require('../v2/repositories/coach.repo');
const { isTeachingRole } = require('../v2/utils/clubPermissions');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');

(async () => {
  if (String(process.env.TENANT_DB || '').toLowerCase() !== 'pg') {
    console.warn('⚠ TENANT_DB != pg — скрипт рассчитан на прод (PostgreSQL). Прерываю.');
    process.exit(1);
  }
  const prisma = makeScriptPrisma();
  const memberships = await prisma.clubMembership.findMany({
    where: { status: 'active' },
    select: { userId: true, clubId: true, role: true },
  });
  const staff = memberships.filter((m) => isTeachingRole(m.role));
  console.log(`Активных членств: ${memberships.length}, из них обучающих (owner/admin/trainer): ${staff.length}`);

  let roleGranted = 0;
  let profileCreated = 0;
  for (const m of staff) {
    const before = await userRepo.findById(m.userId, { select: 'roles' });
    const hasCoach = (before?.roles || []).includes('COACH');
    const hadProfile = !!(await coachRepo.findByUser(m.userId));
    if (DRY) {
      if (!hasCoach) roleGranted += 1;
      if (!hadProfile) profileCreated += 1;
      continue;
    }
    if (!hasCoach) { await userRepo.addRole(m.userId, 'COACH'); roleGranted += 1; }
    if (!hadProfile) { await coachRepo.upsertByUser(m.userId, { set: {}, club: m.clubId }); profileCreated += 1; }
  }
  console.log(`${DRY ? '[DRY] ' : ''}Выдано COACH: ${roleGranted}; создано коуч-профилей: ${profileCreated}`);
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
