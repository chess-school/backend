#!/usr/bin/env node
/**
 * Миграция на мульти-арендность (#7): заводит дефолтный клуб, членства всех пользователей
 * и проставляет club на существующих tenant-документах.
 *
 * БЕЗОПАСНОСТЬ: по умолчанию DRY-RUN — только печатает, что БУДЕТ изменено, ничего не пишет.
 * Применение к боевой БД — только с флагом --apply и ПОСЛЕ бэкапа (mongodump).
 *
 *   node scripts/migrate-multitenancy.js              # dry-run (отчёт)
 *   node scripts/migrate-multitenancy.js --apply      # применить
 *
 * Идемпотентна: повторный запуск не плодит клуб/членства и не трогает уже проставленные club.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const TestUser = require('../v2/models/User');
const Club = require('../v2/models/Club');
const ClubMembership = require('../v2/models/ClubMembership');

// tenant-коллекции: на них проставляем club. Используем .collection (нативный драйвер) —
// корректные имена коллекций и обход strict-схемы (поле club добавляется в схемы отдельно).
const TENANT_MODELS = [
    'Group', 'Course', 'PuzzleBook', 'Schedule', 'Assignment', 'Submission',
    'ClassroomSession', 'Payment', 'Coach', 'CoachApplication', 'CoachRequest',
    'TrainingContract', 'SavedGames',
].map((name) => {
    try { return require(`../v2/models/${name}`); } catch { return null; }
}).filter(Boolean);

const DEFAULT_CLUB = {
    name: 'Mind Over Board',
    slug: 'mind-over-board',
    city: 'Poznań',
    plan: 'club', // 116 пользователей > лимита Start (30)
};
const OWNER_EMAIL = 'nikitaoneofchess@gmail.com';

const APPLY = process.argv.includes('--apply');

const log = (...a) => console.log(...a);

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    log(`\n=== Миграция мульти-арендности — режим: ${APPLY ? 'APPLY (запись)' : 'DRY-RUN (только отчёт)'} ===\n`);

    // 1) Владелец: ADMIN по email, иначе любой ADMIN, иначе первый пользователь
    let owner = await TestUser.findOne({ email: OWNER_EMAIL });
    if (!owner) owner = await TestUser.findOne({ roles: 'ADMIN' });
    if (!owner) owner = await TestUser.findOne().sort({ createdAt: 1 });
    if (!owner) { log('НЕТ пользователей — нечего мигрировать.'); return mongoose.disconnect(); }
    log(`Владелец клуба: ${owner.firstName} ${owner.lastName} <${owner.email}> (${owner._id})`);

    // 2) Дефолтный клуб (идемпотентно по slug)
    let club = await Club.findOne({ slug: DEFAULT_CLUB.slug });
    if (!club) {
        log(`Клуб '${DEFAULT_CLUB.slug}' — будет СОЗДАН (plan=${DEFAULT_CLUB.plan}).`);
        if (APPLY) {
            club = await Club.create({ ...DEFAULT_CLUB, owner: owner._id, limits: Club.limitsForPlan(DEFAULT_CLUB.plan) });
            log(`  создан club ${club._id}`);
        }
    } else {
        log(`Клуб '${DEFAULT_CLUB.slug}' уже есть (${club._id}).`);
    }
    const clubId = club ? club._id : '<new-club-id>';

    // 3) Членства всех пользователей
    const users = await TestUser.find().select('_id roles email').lean();
    let owners = 0, trainers = 0, students = 0, existing = 0;
    const ops = [];
    for (const u of users) {
        const roles = (u.roles || []).map((r) => String(r).toUpperCase());
        let role = 'student';
        if (String(u._id) === String(owner._id)) role = 'owner';
        else if (roles.includes('COACH')) role = 'trainer';
        if (role === 'owner') owners++; else if (role === 'trainer') trainers++; else students++;
        ops.push({
            updateOne: {
                filter: { club: clubId, user: u._id },
                update: { $setOnInsert: { club: clubId, user: u._id, role, status: 'active' } },
                upsert: true,
            },
        });
    }
    if (club) existing = await ClubMembership.countDocuments({ club: clubId });
    log(`\nЧленства: ${users.length} пользователей → owner:${owners} trainer:${trainers} student:${students}. Уже есть членств: ${existing}.`);
    if (APPLY && club && ops.length) {
        const res = await ClubMembership.bulkWrite(ops);
        log(`  upsert членств: вставлено ${res.upsertedCount}, совпало ${res.matchedCount}`);
    }

    // 4) Проставить club на tenant-документах
    log('\nTenant-документы (без club → проставить):');
    for (const M of TENANT_MODELS) {
        const coll = M.collection;
        const total = await coll.countDocuments({});
        const missing = await coll.countDocuments({ club: { $exists: false } });
        log(`  ${coll.collectionName.padEnd(20)} всего ${String(total).padStart(6)} · без club ${String(missing).padStart(6)}`);
        if (APPLY && club && missing) {
            const r = await coll.updateMany({ club: { $exists: false } }, { $set: { club: clubId } });
            log(`     → проставлено club: ${r.modifiedCount}`);
        }
    }

    log(`\n=== Готово (${APPLY ? 'ПРИМЕНЕНО' : 'dry-run — записи не было'}). ===\n`);
    await mongoose.disconnect();
})().catch((e) => { console.error('Ошибка миграции:', e); process.exit(1); });
