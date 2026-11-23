// Unit: CORS (config/cors.js) — B8: запрещённый origin отклоняется МЯГКО (callback(null,false)),
// а не через throw (который давал 500 INTERNAL_ERROR). + базовая логика isAllowedOrigin.
const test = require('node:test');
const assert = require('node:assert/strict');
const { corsOptions, isAllowedOrigin } = require('../../config/cors');

test('isAllowedOrigin: запрос без Origin (curl/Postman/SSR) разрешён', () => {
  assert.equal(isAllowedOrigin(undefined), true);
  assert.equal(isAllowedOrigin(''), true);
});

test('isAllowedOrigin: локальный dev-origin из whitelist разрешён', () => {
  assert.equal(isAllowedOrigin('http://localhost:5173'), true);
});

test('isAllowedOrigin: посторонний origin запрещён', () => {
  assert.equal(isAllowedOrigin('http://evil.example.com'), false);
});

test('B8: разрешённый origin → callback(null, true)', () => {
  let err = 'unset';
  let allow = 'unset';
  corsOptions.origin('http://localhost:5173', (e, a) => { err = e; allow = a; });
  assert.equal(err, null);
  assert.equal(allow, true);
});

test('B8: запрещённый origin → callback(null, false), БЕЗ выброса Error (иначе 500)', () => {
  let err = 'unset';
  let allow = 'unset';
  corsOptions.origin('http://evil.example.com', (e, a) => { err = e; allow = a; });
  assert.equal(err, null, 'не должно быть Error — иначе Express отдаст 500');
  assert.equal(allow, false);
});
