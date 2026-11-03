// Unit: автогенерация страниц сайта. Тестируем чистые функции (промпт/парс) и полный цикл
// generatePages с ИНЪЕКЦИЕЙ claude (без реального спавна) и фейковым репозиторием.
const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../../v2/services/siteGenerate.service');

test('buildPrompt: содержит имя клуба, язык и схему', () => {
  const p = svc.buildPrompt({ text: 'Hello', urls: ['https://x.test/a'], clubName: 'Hetman', lang: 'pl' });
  assert.match(p, /Hetman/);
  assert.match(p, /Polish/);
  assert.match(p, /"pages"/);
  assert.match(p, /https:\/\/x\.test\/a/);
});

test('parseGenerated: срезает ```json-ограждение и достаёт pages', () => {
  const raw = 'Here you go:\n```json\n{"pages":{"home":{"title":"H","blocks":[]}}}\n```\nDone.';
  const pages = svc.parseGenerated(raw);
  assert.ok(pages.home);
  assert.equal(pages.home.title, 'H');
});

test('parseGenerated: достаёт объект без ограждения (по первой { и последней })', () => {
  const pages = svc.parseGenerated('prefix {"pages":{"about":{"blocks":[]}}} suffix');
  assert.ok(pages.about);
});

test('parseGenerated: бросает, если нет pages', () => {
  assert.throws(() => svc.parseGenerated('{"foo":1}'), /pages/);
});

test('extractResult: достаёт .result из envelope и бросает на is_error', () => {
  assert.equal(svc.extractResult(JSON.stringify({ result: 'TEXT', is_error: false })), 'TEXT');
  assert.throws(() => svc.extractResult(JSON.stringify({ result: 'boom', is_error: true })), /error/);
});

test('generatePages: цикл промпт→claude→санитайз→upsert черновиков', async () => {
  const modelJson = {
    pages: {
      home: { title: 'Welcome', blocks: [
        { type: 'heading', props: { text: 'Hi', level: 1, align: 'center' } },
        { type: 'text', props: { text: 'Join us' } },
        { type: 'script', props: { text: '<script>bad</script>' } }, // неизвестный тип → выбросится
      ] },
      about: { title: 'About', blocks: [{ type: 'text', props: { text: 'We teach chess' } }] },
      coaches: { title: 'Coaches', blocks: [] }, // пустые — пропускаем
    },
  };
  const runClaude = async () => JSON.stringify({ result: '```json\n' + JSON.stringify(modelJson) + '\n```', is_error: false });

  const calls = [];
  const repo = {
    getVersion: async () => 0,
    upsertDraft: async (clubId, slug, data) => { calls.push({ clubId, slug, data }); return { slug, ...data }; },
  };

  const summary = await svc.generatePages({
    clubId: 'club1', text: 'source', urls: [], clubName: 'Hetman', lang: 'en', updatedBy: 'u1', repo, runClaude,
  });

  // home (2 валидных блока, script выброшен) + about (1); coaches пустой — не сохранён
  assert.deepEqual(summary, [{ slug: 'home', blocks: 2 }, { slug: 'about', blocks: 1 }]);
  const home = calls.find((c) => c.slug === 'home');
  assert.equal(home.data.title, 'Welcome');
  assert.equal(home.data.version, 1);
  assert.equal(home.data.blocks.length, 2);
  assert.equal(home.data.blocks[0].type, 'heading');
  // текст-строка превратилась в многоязычный объект (sanitizeBlocks)
  assert.equal(typeof home.data.blocks[0].props.text, 'object');
  assert.ok(home.data.blocks[0].props.text.en || home.data.blocks[0].props.text.pl);
});
