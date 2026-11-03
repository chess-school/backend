// services/sitePage.service.js — валидация/санитайз блоков страниц клуба (шаг 3) + стартовый контент.
//
// Главная задача безопасности: клуб-редактор НЕ должен иметь возможности внедрить на свой (а тем
// более на чужой) сайт произвольный HTML/скрипт. Поэтому блоки — это строго типизированные ДАННЫЕ:
//   • неизвестные типы блоков выбрасываются;
//   • в каждом блоке остаются только известные поля (чужие props отбрасываются);
//   • все пользовательские строки проходят через stripTags (срезаем `<...>` и схлопываем пробелы)
//     и лимит длины — то есть «<script>…» превращается в безобидный текст ещё до записи в БД;
//   • видео принимаем только с YouTube/Vimeo (из ссылки достаём id), остальное отбрасываем;
//   • ссылки/картинки — только относительные (/…) либо http(s), иначе поле пустеет (нет javascript:).
//
// Текстовые поля многоязычны: { pl, uk, en }. Фронт на рендере выбирает язык с фолбэком.

const LANGS = ['pl', 'uk', 'en'];

// Срезаем любые теги и управляющие угловые скобки, нормализуем пробелы, режем по длине.
const stripTags = (v, max = 2000) => {
    if (typeof v !== 'string') return '';
    return v
        .replace(/<[^>]*>/g, ' ')   // <script>, <img ...>, любые теги → пробел
        .replace(/[<>]/g, ' ')      // одиночные угловые скобки тоже убираем
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
};

// Многоязычное поле → { pl, uk, en } из чистых строк (отсутствующие языки = '').
const cleanI18n = (v, max = 2000) => {
    const out = { pl: '', uk: '', en: '' };
    if (v && typeof v === 'object') {
        for (const l of LANGS) out[l] = stripTags(v[l], max);
    } else if (typeof v === 'string') {
        // Допускаем простую строку — кладём во все языки (удобно для переносимого контента).
        const s = stripTags(v, max);
        out.pl = out.uk = out.en = s;
    }
    return out;
};

// Безопасная ссылка: только относительная (/…) или http(s). Иначе — пусто (режем javascript:, data: и пр.).
const safeUrl = (v, max = 600) => {
    const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
    if (!s) return '';
    if (s.startsWith('/')) return s;
    if (/^https?:\/\//i.test(s)) return s;
    return '';
};

// id ассета медиатеки (24-символьный ObjectId) — иначе пусто.
const assetId = (v) => (typeof v === 'string' && /^[a-f\d]{24}$/i.test(v.trim()) ? v.trim() : '');

// Из ссылки/значения достаём провайдер и id ролика. Поддержка: youtube (watch?v=, youtu.be, embed),
// vimeo (vimeo.com/<id>). Ничего не подошло → null (блок-видео выбрасывается).
const parseVideo = (raw) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return null;
    let m;
    if ((m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,20})/i))) {
        return { provider: 'youtube', videoId: m[1] };
    }
    if ((m = s.match(/vimeo\.com\/(?:video\/)?(\d{5,15})/i))) {
        return { provider: 'vimeo', videoId: m[1] };
    }
    // Голый id (без ссылки) — трактуем как youtube по умолчанию.
    if (/^[\w-]{6,20}$/.test(s)) return { provider: 'youtube', videoId: s };
    return null;
};

const ALIGNS = ['left', 'center', 'right'];
const align = (v) => (ALIGNS.includes(v) ? v : 'left');
const clampLevel = (v) => (Number(v) >= 1 && Number(v) <= 3 ? Math.floor(Number(v)) : 2);

// Санитайз одной картинки (для photo/gallery/banner): id ассета + безопасный url + альт/подпись.
const cleanImage = (v) => ({
    assetId: assetId(v && v.assetId),
    url: safeUrl(v && v.url),
    alt: stripTags(v && v.alt, 300),
});

// Пер-типовые санитайзеры. Каждый возвращает ЧИСТЫЙ объект props (только известные поля) или null,
// если блок бессмысленный (напр. видео без распознанной ссылки) — тогда блок выбрасывается.
const BLOCK_TYPES = {
    heading: (p) => ({ text: cleanI18n(p.text, 160), level: clampLevel(p.level), align: align(p.align) }),
    text: (p) => ({ text: cleanI18n(p.text, 5000), align: align(p.align) }),
    quote: (p) => ({ text: cleanI18n(p.text, 1000), author: stripTags(p.author, 120) }),
    divider: () => ({}),
    photo: (p) => {
        const img = cleanImage(p);
        if (!img.assetId && !img.url) return null;          // пустая картинка — не блок
        return { ...img, caption: cleanI18n(p.caption, 300) };
    },
    gallery: (p) => {
        const items = (Array.isArray(p.items) ? p.items : [])
            .map(cleanImage)
            .filter((i) => i.assetId || i.url)
            .slice(0, 24);
        if (!items.length) return null;
        return { items };
    },
    slider: (p) => {
        const items = (Array.isArray(p.items) ? p.items : [])
            .map(cleanImage)
            .filter((i) => i.assetId || i.url)
            .slice(0, 12);
        if (!items.length) return null;
        const n = Number(p.interval);
        return { items, interval: n >= 2 && n <= 15 ? Math.floor(n) : 5 };  // сек между слайдами
    },
    banner: (p) => ({
        bg: cleanImage(p.bg || {}),
        bgColor: safeColor(p.bgColor),
        title: cleanI18n(p.title, 160),
        subtitle: cleanI18n(p.subtitle, 300),
        buttonLabel: cleanI18n(p.buttonLabel, 60),
        buttonUrl: safeUrl(p.buttonUrl, 300),
    }),
    video: (p) => {
        const v = parseVideo(p.url || p.videoId);
        if (!v) return null;
        return { ...v, caption: cleanI18n(p.caption, 300) };
    },
};

function safeColor(v) {
    const s = typeof v === 'string' ? v.trim() : '';
    return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s) ? s : '';
}

// Главная функция: вход — произвольный массив блоков из тела запроса; выход — безопасный массив.
// Неизвестные типы и «пустые» блоки отбрасываются; у каждого блока остаются только известные props.
const sanitizeBlocks = (blocks) => {
    if (!Array.isArray(blocks)) return [];
    const out = [];
    for (const b of blocks.slice(0, 200)) {                 // жёсткий потолок на число блоков
        if (!b || typeof b !== 'object') continue;
        const fn = BLOCK_TYPES[b.type];
        if (!fn) continue;                                   // неизвестный тип → выброс
        const props = fn(b.props || {});
        if (props === null) continue;                        // бессмысленный блок → выброс
        out.push({
            id: typeof b.id === 'string' ? b.id.replace(/[^\w-]/g, '').slice(0, 40) : '',
            type: b.type,
            props,
        });
    }
    return out;
};

const KNOWN_BLOCK_TYPES = Object.keys(BLOCK_TYPES);

// --- Стартовый контент -------------------------------------------------------------------------
// Нейтральные дефолтные страницы для нового клуба (без чужого бренда «Mind Over Board»).
// Отдаются редактору (шаг 4), когда у клуба ещё нет своей страницы — чтобы было с чего начать.
const starterPage = (slug, clubName) => {
    const name = clubName || 'our club';
    if (slug === 'about') {
        return {
            title: 'About',
            blocks: sanitizeBlocks([
                { type: 'heading', props: { text: { pl: `O ${name}`, uk: `Про ${name}`, en: `About ${name}` }, level: 1, align: 'center' } },
                { type: 'text', props: { text: {
                    pl: 'Opowiedz o swoim klubie: misja, trenerzy, osiągnięcia.',
                    uk: 'Розкажіть про свій клуб: місія, тренери, досягнення.',
                    en: 'Tell visitors about your club: mission, coaches, achievements.',
                } } },
                { type: 'divider', props: {} },
            ]),
        };
    }
    // home по умолчанию
    return {
        title: 'Home',
        blocks: sanitizeBlocks([
            { type: 'heading', props: { text: { pl: name, uk: name, en: name }, level: 1, align: 'center' } },
            { type: 'text', props: { text: {
                pl: 'Witamy w naszym klubie szachowym.',
                uk: 'Ласкаво просимо до нашого шахового клубу.',
                en: 'Welcome to our chess club.',
            }, align: 'center' } },
        ]),
    };
};

module.exports = { sanitizeBlocks, KNOWN_BLOCK_TYPES, starterPage, stripTags, parseVideo };
