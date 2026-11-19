/**
 * A fun, fixed identity for each account: a two-word name and a generated avatar
 * (one of several Boring Avatars styles in one of several palettes).
 * It's derived from the account's uid, so the same person always gets the same
 * name and icon on every login and device, with nothing stored anywhere.
 */

const ADJECTIVES = [
  'Neon', 'Golden', 'Midnight', 'Cosmic', 'Velvet', 'Electric', 'Silver', 'Crimson',
  'Quiet', 'Lucky', 'Sunny', 'Misty', 'Brave', 'Clever', 'Swift', 'Gentle',
  'Wild', 'Bold', 'Indigo', 'Amber', 'Arctic', 'Coral', 'Lunar', 'Solar',
  'Pixel', 'Retro', 'Analog', 'Rapid', 'Mellow', 'Hidden', 'Bright', 'Jade',
];

const NOUNS = [
  'Otter', 'Falcon', 'Fox', 'Panda', 'Koala', 'Heron', 'Lynx', 'Raven',
  'Tiger', 'Dolphin', 'Owl', 'Badger', 'Comet', 'Maple', 'Cactus', 'Harbor',
  'Pine', 'Meadow', 'Canyon', 'River', 'Summit', 'Lantern', 'Compass', 'Echo',
  'Reel', 'Frame', 'Lens', 'Shutter', 'Studio', 'Story', 'Pulse', 'Spark',
];

/** Avatar styles (Boring Avatars variants) and color palettes, mixed per account. */
export const AVATAR_VARIANTS = ['beam', 'marble', 'bauhaus', 'sunset'] as const;
export type AvatarVariant = (typeof AVATAR_VARIANTS)[number];

export const AVATAR_PALETTES: string[][] = [
  ['#2e66ff', '#ff9a5a', '#0b1020', '#ffd166', '#8fb3ff'], // Backlot
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'], // Desert
  ['#0b3954', '#087e8b', '#bfd7ea', '#ff5a5f', '#c81d25'], // Harbor
  ['#5f0f40', '#9a031e', '#fb8b24', '#e36414', '#0f4c5c'], // Ember
  ['#3d348b', '#7678ed', '#f7b801', '#f18701', '#f35b04'], // Dusk
];

/** FNV-1a: a small, stable string hash. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface CreatorIdentity {
  name: string;
  variant: AvatarVariant;
  palette: string[];
}

export function creatorIdentity(uid: string): CreatorIdentity {
  const h = hash(uid);
  // Different slices of the hash pick each part, so they vary independently.
  return {
    name: `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[(h >>> 5) % NOUNS.length]}`,
    variant: AVATAR_VARIANTS[(h >>> 10) % AVATAR_VARIANTS.length],
    palette: AVATAR_PALETTES[(h >>> 14) % AVATAR_PALETTES.length],
  };
}
