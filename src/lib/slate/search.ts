/**
 * Query handling for Slate's text search (M5.1). No network, no extensions:
 * - search terms without filler words, with a few British/American spellings unified;
 * - a Postgres full-text query (English stemming, prefix matching) built from those terms;
 * - typo correction against the creator's own vocabulary, used only when the query as
 *   typed finds nothing.
 */

/** Filler words that only add noise to substring matching. Full-text search drops its own. */
const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have he her his how i if in into is it its me my of on or our she so than that the their them then there these they this ' +
    'to was we were what when where which who why will with you your about after again all also any because been before being both can could did do does done ' +
    'each few just more most much not now off only other out over own same should some such too under very while would ' +
    'video videos post posts one ones thing things stuff something made make making think remember find show'
  ).split(' ')
);

const SPELLING: Record<string, string> = {
  colour: 'color',
  colours: 'colors',
  coloured: 'colored',
  favourite: 'favorite',
  favourites: 'favorites',
  flavour: 'flavor',
  flavours: 'flavors',
  centre: 'center',
  theatre: 'theater',
  grey: 'gray',
  organise: 'organize',
  organising: 'organizing',
};

/** Search terms: lower-cased words (2+ chars), filler removed unless nothing else is left; at most 6. */
export function searchTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .map((w) => SPELLING[w] ?? w);
  const unique = [...new Set(words)];
  const content = unique.filter((w) => !STOPWORDS.has(w));
  return (content.length ? content : unique).slice(0, 6);
}

/** `term:* | term:*` for to_tsquery('english', …). Terms are letters and digits only. */
export function tsQueryText(terms: string[]): string {
  return terms
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((t) => `${t}:*`)
    .join(' | ');
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions). */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Likely intended words for terms that don't appear in the creator's vocabulary
 * (1 edit for 4–6 letters, 2 for longer). Terms under 4 letters are left alone.
 */
export function correctTypos(terms: string[], vocabulary: Iterable<string>): { terms: string[]; corrected: Record<string, string> } {
  const vocab = [...new Set(vocabulary)];
  const known = new Set(vocab);
  const corrected: Record<string, string> = {};
  const out = terms.map((t) => {
    if (t.length < 4 || known.has(t) || vocab.some((v) => v.startsWith(t) && v.length - t.length <= 3)) return t;
    const max = t.length <= 6 ? 1 : 2;
    let best: string | null = null;
    let bestD = max + 1;
    for (const v of vocab) {
      if (Math.abs(v.length - t.length) > max) continue;
      const dist = editDistance(t, v, max);
      if (dist < bestD || (dist === bestD && best !== null && v < best)) {
        best = v;
        bestD = dist;
      }
    }
    if (best && bestD <= max) {
      corrected[t] = best;
      return best;
    }
    return t;
  });
  return { terms: [...new Set(out)], corrected };
}
