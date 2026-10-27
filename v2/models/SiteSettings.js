// models/SiteSettings.js — настройки публичного сайта одного клуба (мульти-арендность #7, шаг 1).
// Одна запись на клуб (club — unique). Отвязывает бренд/тексты/соцсети от кода: раньше
// название, слоган, тексты окна входа и футер были зашиты в home-page/about-page/AuthPage/Footer,
// из-за чего у любого клуба на страницах светилось «Mind Over Board». Теперь каждый клуб
// хранит своё. Пустые поля фронт заменяет нейтральными дефолтами платформы (debiut) —
// никаких выдуманных цифр и чужого бренда.
//
// Безопасность: тут только данные (строки/ссылки/цвета), НИКАКОГО произвольного HTML.
// Блочный конструктор страниц (шаги 3–4) живёт отдельно в SitePage и тоже без сырого HTML.

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// До 3 «цифр-фактов» в окне входа/на лендинге. Если клуб не заполнил — блок скрывается.
const FactSchema = new Schema({
    value: { type: String, trim: true, maxlength: 24 },   // напр. «GM & IM», «+250», «12»
    label: { type: String, trim: true, maxlength: 48 },   // напр. «titled coaches»
}, { _id: false });

// Ссылка в футере (безопасная: подпись + URL, без разметки).
const FooterLinkSchema = new Schema({
    label: { type: String, trim: true, maxlength: 60 },
    url: { type: String, trim: true, maxlength: 300 },
}, { _id: false });

// Пункт меню сайта клуба — задел под шаг 4 (владелец добавляет/прячет/переставляет пункты).
const MenuItemSchema = new Schema({
    key: { type: String, trim: true, maxlength: 40 },     // стабильный id пункта
    label: { type: String, trim: true, maxlength: 60 },
    path: { type: String, trim: true, maxlength: 200 },   // внутренний путь, напр. /about
    hidden: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
}, { _id: false });

const SiteSettingsSchema = new Schema({
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true, unique: true, index: true },

    // Бренд
    siteName: { type: String, trim: true, maxlength: 120 },   // отображаемое имя сайта (fallback — Club.name)
    logoUrl: { type: String, trim: true, maxlength: 500 },
    tagline: { type: String, trim: true, maxlength: 200 },    // короткий слоган под именем

    // Окно входа / регистрации (шаг 5 дополнит фоном и цветом кнопки — поля уже тут)
    auth: {
        promoTitle: { type: String, trim: true, maxlength: 120 },     // вместо «Think deeper.»
        promoSubtitle: { type: String, trim: true, maxlength: 300 },  // вместо «Play sharper.»-подзаголовка
        backgroundUrl: { type: String, trim: true, maxlength: 500 },  // фоновое фото левой панели
        buttonColor: { type: String, trim: true, maxlength: 9 },      // #RRGGBB(AA)
        facts: { type: [FactSchema], default: [], validate: [(a) => a.length <= 3, 'facts: максимум 3'] },
    },

    // Футер
    footer: {
        text: { type: String, trim: true, maxlength: 300 },       // описание под брендом
        legalName: { type: String, trim: true, maxlength: 120 },  // имя для копирайта «© год <legalName>»
        links: { type: [FooterLinkSchema], default: [] },
    },

    // Соцсети (пустое значение = иконка скрыта; «выдуманных» ссылок больше нет)
    socials: {
        facebook: { type: String, trim: true, maxlength: 300 },
        instagram: { type: String, trim: true, maxlength: 300 },
        twitter: { type: String, trim: true, maxlength: 300 },
        youtube: { type: String, trim: true, maxlength: 300 },
        telegram: { type: String, trim: true, maxlength: 300 },
    },

    // Меню сайта клуба (шаг 4). Пусто — фронт показывает дефолтный набор.
    menu: { type: [MenuItemSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('SiteSettings', SiteSettingsSchema);
