import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_TRAINING_AGENTS, absoluteUrl, disallowAiTraining, jsonLd, readSiteUrl } from './site.ts';
import { checkProductionConfig } from './config-check.ts';

/** L4: public-site URL handling. */

test('SEO1. SITE_URL must be an https origin; nothing is guessed when it is missing', () => {
  assert.deepEqual(readSiteUrl({}), { url: null });
  assert.equal(readSiteUrl({ SITE_URL: 'https://backlot.example/' }).url, 'https://backlot.example');
  assert.equal(readSiteUrl({ SITE_URL: 'http://localhost:3000' }).url, 'http://localhost:3000');
  assert.match(readSiteUrl({ SITE_URL: 'http://backlot.example' }).error!, /https/);
  assert.match(readSiteUrl({ SITE_URL: 'https://backlot.example/app' }).error!, /origin only/);
  assert.match(readSiteUrl({ SITE_URL: 'not a url' }).error!, /valid URL/);
  assert.equal(absoluteUrl('/privacy', { SITE_URL: 'https://backlot.example' }), 'https://backlot.example/privacy');
  assert.equal(absoluteUrl('/privacy', {}), null);
});

test('SEO2. JSON-LD cannot close its script tag', () => {
  const out = jsonLd({ name: '</script><script>alert(1)</script> ' });
  assert.ok(!out.includes('<'));
  assert.ok(!out.includes(' '));
  assert.deepEqual(JSON.parse(out), { name: '</script><script>alert(1)</script> ' });
});

test('SEO3. the production check rejects a bad SITE_URL and warns when it is unset', () => {
  const bad = checkProductionConfig({ NODE_ENV: 'production', SITE_URL: 'http://backlot.example' });
  assert.ok(bad.errors.some((e) => /SITE_URL must use https/.test(e)));
  const unset = checkProductionConfig({ NODE_ENV: 'production' });
  assert.ok(unset.warnings.some((w) => /SITE_URL is not set/.test(w)));
  assert.ok(!unset.errors.some((e) => /SITE_URL/.test(e)));
});

test('SEO4. training crawlers are disallowed by default; search crawlers are never listed', () => {
  assert.equal(disallowAiTraining({}), true);
  assert.equal(disallowAiTraining({ ROBOTS_DISALLOW_AI_TRAINING: 'true' }), true);
  assert.equal(disallowAiTraining({ ROBOTS_DISALLOW_AI_TRAINING: 'false' }), false);
  for (const search of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User']) {
    assert.ok(!AI_TRAINING_AGENTS.includes(search), `${search} stays allowed`);
  }
});
