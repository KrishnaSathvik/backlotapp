import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_PALETTES, AVATAR_VARIANTS, creatorIdentity } from './identity.ts';

test('creatorIdentity is stable for the same uid', () => {
  const uid = 'Zx81kQp0aLm3vT9nB2cD';
  assert.deepEqual(creatorIdentity(uid), creatorIdentity(uid));
});

test('creatorIdentity gives a two-word name and a known avatar style', () => {
  for (const uid of ['a', 'user-1', 'user-2', 'xYz123456789', '']) {
    const id = creatorIdentity(uid);
    assert.match(id.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.ok(AVATAR_VARIANTS.includes(id.variant));
    assert.ok(AVATAR_PALETTES.includes(id.palette));
  }
});

test('creatorIdentity varies across accounts', () => {
  const names = new Set(Array.from({ length: 50 }, (_, i) => creatorIdentity(`uid-${i}`).name));
  assert.ok(names.size > 30);
});

test('creatorIdentity mixes avatar styles across accounts', () => {
  const variants = new Set(Array.from({ length: 50 }, (_, i) => creatorIdentity(`uid-${i}`).variant));
  assert.equal(variants.size, AVATAR_VARIANTS.length);
});
