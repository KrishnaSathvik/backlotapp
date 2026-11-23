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

test('avatar palettes have no near-black colors (avatars stay visible on the dark theme)', () => {
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const palette of AVATAR_PALETTES) for (const color of palette) assert.ok(luminance(color) >= 0.08, `${color} is too dark`);
});
