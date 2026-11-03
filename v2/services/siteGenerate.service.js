// Автогенерация страниц сайта клуба через локальный `claude -p` (тот же движок, что у tg-канала —
// аутентифицирован в ~/.claude, без API-ключа). Модель читает присланный текст + публичные ссылки
// (WebFetch) и возвращает СТРОГИЙ JSON по нашей схеме блоков; мы прогоняем его через sanitizeBlocks
// (срезает HTML/мусор/неизвестные типы) и кладём черновиками. Владелец потом правит/публикует.
const { execFile } = require('node:child_process');
const { sanitizeBlocks } = require('./sitePage.service');

const PAGES = ['home', 'about', 'coaches', 'achievements'];
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_TIMEOUT = Number(process.env.SITE_GEN_TIMEOUT_MS || 180000); // 3 мин на вызов

const LANG_NAME = { pl: 'Polish', uk: 'Ukrainian', en: 'English' };

// Строгий промпт: Claude возвращает ТОЛЬКО JSON нашей схемы (plain-строки, без картинок).
const buildPrompt = ({ text = '', urls = [], clubName = 'the club', lang = 'en', clubSlug = '' }) => {
  const langName = LANG_NAME[String(lang).slice(0, 2)] || 'English';
  const urlBlock = urls.length
    ? `\nAlso fetch and read these public URLs with WebFetch, extract anything useful, and SKIP any you cannot access (login-walled feeds like a private Facebook timeline will not work — just ignore them):\n${urls.map((u) => `- ${u}`).join('\n')}\n`
    : '';
  const textBlock = text ? `\nSource material provided by the club owner:\n"""\n${String(text).slice(0, 20000)}\n"""\n` : '';
  // CTA баннера ведёт на запись именно в ЭТОТ клуб (а не на общую регистрацию платформы).
  const joinUrl = clubSlug ? `/register?club=${clubSlug}` : '/register';
  return `You are generating public website content for a chess club called "${clubName}".
Write ALL visible text in ${langName}.
${textBlock}${urlBlock}
Produce content for four pages: home, about, coaches, achievements.
Output ONLY a single JSON object — no prose, no explanations, no markdown code fences — with EXACTLY this shape:
{"pages":{"home":{"title":"...","blocks":[BLOCK,...]},"about":{"title":"...","blocks":[...]},"coaches":{"title":"...","blocks":[...]},"achievements":{"title":"...","blocks":[...]}}}
Each BLOCK is one of:
{"type":"heading","props":{"text":"...","level":1,"align":"left"}}   (level 1|2|3; align left|center|right)
{"type":"text","props":{"text":"...","align":"left"}}
{"type":"quote","props":{"text":"...","author":"..."}}
{"type":"banner","props":{"title":"...","subtitle":"...","buttonLabel":"...","buttonUrl":"${joinUrl}","bgColor":"#2B50E0"}}
{"type":"divider","props":{}}
Rules:
- All text values are PLAIN strings. No HTML, no markdown.
- NEVER invent facts. Do not make up images, photos, names of real people, coach titles (GM/IM/FM), ratings, numbers, prices, awards, achievements, quotes or testimonials. Use ONLY what appears in the source material above.
- If the source lacks a specific fact, simply OMIT that block or sentence — do NOT write filler. NEVER write placeholder or instructional copy addressed to the editor (forbidden: "this is a starting point", "placeholder", "ready for you to edit", "add your story/logo/photo here", "lorem ipsum", "edit this"). Every block must read as finished, public-facing copy.
- A block with nothing real to say must be dropped entirely rather than filled with generic text.
- 4 to 10 blocks per page. Headlines are benefits, not labels (e.g. "Learn to think three moves ahead", not "About us").
- The public site header already shows the club name and city, so do NOT open the home page by repeating the club name as the first heading — open with a value-proposition headline instead.
- Start each page with a heading (level 1 for home, level 2 for others).
- Use a banner (with its "${joinUrl}" button) only on the home page.`;
};

// Спавн `claude -p ... --output-format json`. Инъектируется в тестах.
function runClaudeRaw(prompt) {
  return new Promise((resolve, reject) => {
    execFile(
      CLAUDE_BIN,
      ['-p', prompt, '--output-format', 'json', '--allowedTools', 'WebFetch', 'WebSearch', '--max-turns', '30'],
      { timeout: CLAUDE_TIMEOUT, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`claude invocation failed: ${err.message} ${String(stderr || '').slice(-300)}`));
        resolve(stdout);
      },
    );
  });
}

// Из envelope `claude --output-format json` достаём текст модели (.result).
const extractResult = (stdout) => {
  let env;
  try { env = JSON.parse(stdout); } catch { return String(stdout); } // вдруг уже чистый текст
  if (env && env.is_error) throw new Error(`claude returned an error: ${String(env.result).slice(0, 300)}`);
  return env && typeof env.result === 'string' ? env.result : String(stdout);
};

// Из текста модели достаём JSON-объект (срезаем ```-ограждения / прелюдию/эпилог).
const parseGenerated = (resultStr) => {
  let s = String(resultStr).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  else {
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
  }
  const obj = JSON.parse(s);
  const pages = obj && obj.pages;
  if (!pages || typeof pages !== 'object') throw new Error('generated JSON has no "pages" object');
  return pages;
};

// Полный цикл: промпт → claude → парс → санитайз → апсерт черновиков.
// repo и runClaude инъектируются (в проде — sitePage.repo и runClaudeRaw).
const generatePages = async ({ clubId, text, urls, clubName, lang, clubSlug, updatedBy, repo, runClaude = runClaudeRaw }) => {
  const prompt = buildPrompt({ text, urls, clubName, lang, clubSlug });
  const stdout = await runClaude(prompt);
  const pages = parseGenerated(extractResult(stdout));

  const summary = [];
  for (const slug of PAGES) {
    const p = pages[slug];
    if (!p || typeof p !== 'object') continue;
    const blocks = sanitizeBlocks(Array.isArray(p.blocks) ? p.blocks : []);
    if (!blocks.length) continue;
    const title = typeof p.title === 'string' ? p.title.trim().slice(0, 160) : '';
    const existingVersion = await repo.getVersion(clubId, slug);
    const version = (existingVersion || 0) + 1;
    await repo.upsertDraft(clubId, slug, { title, blocks, version, updatedBy });
    summary.push({ slug, blocks: blocks.length });
  }
  return summary;
};

module.exports = { buildPrompt, extractResult, parseGenerated, generatePages, PAGES };
