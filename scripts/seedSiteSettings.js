/**
 * seedSiteSettings.js — миграция настроек сайта по клубам (мульти-арендность #7, шаг 1).
 *
 * Что делает:
 *  1) Клубу «Mind Over Board» записывает НЫНЕШНИЕ тексты MOB (которые раньше были зашиты в коде),
 *     чтобы его сайт выглядел как прежде.
 *  2) Остальным клубам (напр. Chess Cocks) создаёт ПУСТОЙ шаблон настроек — их сайт берёт
 *     нейтральные дефолты (своё имя/логотип клуба), без «Mind Over Board» и выдуманных цифр.
 *
 * Идемпотентность: существующие настройки НЕ перетираются (кроме флага --force для MOB).
 * MOB-клуб ищется по slug (--mob-slug=<slug>) или эвристике (slug/имя содержит mob|mind over board).
 *
 * Запуск (из каталога backend):
 *   node scripts/seedSiteSettings.js                 # применить
 *   node scripts/seedSiteSettings.js --dry           # показать план, ничего не писать
 *   node scripts/seedSiteSettings.js --mob-slug=mob  # явно указать slug клуба MOB
 *   node scripts/seedSiteSettings.js --force         # перезаписать настройки MOB нынешними текстами
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Club = require('../v2/models/Club');
const SiteSettings = require('../v2/models/SiteSettings');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FORCE = args.includes('--force');
const MOB_SLUG = (args.find((a) => a.startsWith('--mob-slug=')) || '').split('=')[1];

// Нынешний (ранее захардкоженный) контент MOB — переносим 1:1.
const MOB_CONTENT = {
    siteName: 'Mind Over Board',
    tagline: 'An online platform for strategic growth.',
    auth: {
        promoTitle: 'Think deeper. Play sharper.',
        promoSubtitle: 'Train with titled coaches, solve tactics and track your rating — all inside one academy.',
        facts: [
            { value: 'GM & IM', label: 'titled coaches' },
            { value: '50k+', label: 'tactics' },
            { value: '+250', label: 'avg. gain' },
        ],
    },
    footer: {
        text: 'An online platform for strategic growth.',
        legalName: 'Mind Over Board',
    },
    // Соцсети намеренно пусты: в коде стояли заглушки facebook.com/instagram.com/twitter.com —
    // не переносим «выдуманные» ссылки, владелец впишет реальные.
    socials: {},
};

const isMobClub = (club) => {
    if (MOB_SLUG) return club.slug === MOB_SLUG.toLowerCase();
    const hay = `${club.slug || ''} ${club.name || ''}`.toLowerCase();
    return /mind[\s-]?over[\s-]?board|(^|[^a-z])mob([^a-z]|$)/.test(hay);
};

(async () => {
    if (!process.env.MONGO_URI) { console.error('✗ MONGO_URI не задан в backend/.env'); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI);

    const clubs = await Club.find({}).select('name slug logoUrl brand status').lean();
    console.log(`Найдено клубов: ${clubs.length}${DRY ? '  [DRY-RUN — ничего не пишем]' : ''}\n`);

    let seededMob = 0; let stubs = 0; let skipped = 0;
    for (const club of clubs) {
        const existing = await SiteSettings.findOne({ club: club._id }).lean();
        const mob = isMobClub(club);
        const tag = mob ? 'MOB' : 'клуб';
        if (mob) {
            if (existing && !FORCE) {
                console.log(`• [${tag}] ${club.name} (${club.slug}) — настройки уже есть, пропуск (--force чтобы перезаписать)`);
                skipped++; continue;
            }
            console.log(`• [${tag}] ${club.name} (${club.slug}) — ${existing ? 'ПЕРЕЗАПИСЬ' : 'запись'} нынешних текстов MOB`);
            if (!DRY) {
                await SiteSettings.findOneAndUpdate(
                    { club: club._id },
                    { $set: { club: club._id, ...MOB_CONTENT } },
                    { upsert: true, new: true, setDefaultsOnInsert: true },
                );
            }
            seededMob++;
        } else {
            if (existing) { console.log(`• [${tag}] ${club.name} (${club.slug}) — настройки уже есть, пропуск`); skipped++; continue; }
            console.log(`• [${tag}] ${club.name} (${club.slug}) — пустой нейтральный шаблон (сайт возьмёт имя/лого клуба)`);
            if (!DRY) {
                await SiteSettings.create({ club: club._id });
            }
            stubs++;
        }
    }

    console.log(`\nИтог: MOB-настроек=${seededMob}, пустых шаблонов=${stubs}, пропущено=${skipped}`);
    if (seededMob === 0) console.log('⚠ Клуб MOB не определён. Укажи явно: --mob-slug=<slug> (см. список выше).');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('✗ Ошибка миграции:', e.message); process.exit(1); });
