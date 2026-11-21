/**
 * BM25 over the stored memory facts: what `learn` shows the model as ALREADY STORED, and what its
 * near-duplicate guard compares a new fact against.
 *
 * WHY THIS EXISTS. The prompt used to list the stored facts alphabetically and cut the list at
 * MAX_STORED_CHARS: with 1 200 facts the model saw 94 of them, and never the fact the previous
 * distil had written a minute earlier, so it re-created that fact under a new slug (F12). A list
 * chosen by what the NOTES are about, plus the newest facts, shows the model the stored fact it is
 * most likely to repeat, wherever it sorts. The guard is the backstop for a model that repeats it
 * anyway: a reply is never trusted to have looked.
 *
 * PURE AND DEPENDENCY-FREE, no `import`, no fs: the OpenCode plugin carries this block as a copy
 * (`tests/twins.mjs`, the `memory-search` row), because a plugin cannot import `js/`. Edit it here,
 * then `node tests/twins.mjs --write`. A copy carries this file's house style (semicolons).
 *
 * A fact is a `{ desc, topic, body, mtime }` value, as `readFacts` returns it; a fact with no body or
 * no mtime is still a fact (a test's, or a store file that could not be read whole).
 */
// ---- memory-search twin: BEGIN
/** How many of the newest facts are always listed, whatever the notes say. */
export const RECENT_FACTS = 10;
/**
 * A new fact is SKIPPED as a near-duplicate of a stored one at or above this similarity (0..1, see
 * `nearestFact`). Conservative on purpose: a false skip loses a fact for good, a false create costs one
 * duplicate that `consolidate` or the next distil can merge. Measured on tests/unit/memory_search.test.mjs:
 * a reworded copy of the same claim scores above 0.8, two different facts of one topic below 0.35.
 */
export const DUPLICATE_SIMILARITY = 0.7;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Lower-case words: split on anything that is not a letter or a digit, one-letter words dropped, no stemming. */
export function tokenize(text) {
  return String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
}

/** What a fact is searched by: its slug's words, description, topic and body. */
export function factText(slug, fact) {
  return `${slug.replace(/[-_]+/g, ' ')} ${fact?.desc ?? ''} ${fact?.topic ?? ''} ${fact?.body ?? ''}`;
}

function termFrequencies(text) {
  const tf = new Map();
  let len = 0;
  for (const t of tokenize(text)) { tf.set(t, (tf.get(t) ?? 0) + 1); len += 1; }
  return { tf, len };
}

/** The corpus statistics BM25 needs, over `facts` (slug -> fact). */
function searchIndex(facts) {
  const slugs = [];
  const docs = [];
  const df = new Map();
  let total = 0;
  for (const [slug, fact] of facts) {
    const doc = termFrequencies(factText(slug, fact));
    for (const t of doc.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    slugs.push(slug);
    docs.push(doc);
    total += doc.len;
  }
  return { slugs, docs, df, avg: total / (docs.length || 1) || 1 };
}

// The `1 +` form keeps idf positive for a word in every document, so a small store never scores below zero.
const idf = (ix, term) => {
  const n = ix.df.get(term) ?? 0;
  return Math.log(1 + (ix.docs.length - n + 0.5) / (n + 0.5));
};

function bm25(ix, terms, doc) {
  let score = 0;
  for (const t of terms) {
    const f = doc.tf.get(t);
    if (f) score += (idf(ix, t) * f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * doc.len) / ix.avg));
  }
  return score;
}

/** Slugs whose text shares a word with `query`, best match first (ties in store order); no match, no entry. */
export function rankFacts(facts, query) {
  const ix = searchIndex(facts);
  const terms = [...new Set(tokenize(query))];
  const hits = [];
  ix.docs.forEach((doc, i) => {
    const score = bm25(ix, terms, doc);
    if (score > 0) hits.push({ slug: ix.slugs[i], score });
  });
  return hits.sort((a, b) => b.score - a.score);
}

/**
 * The stored fact closest to `candidate` (`{ slug, desc, topic, body }`), as `{ slug, similarity }`, or null
 * for an empty store. SIMILARITY is the BM25 score of the stored fact for the candidate's words, divided by
 * the score the candidate would get from a document identical to itself, so 1 is "says the same, in the same
 * words" and a word the store has never seen costs the candidate its share. Capped at 1.
 */
export function nearestFact(facts, candidate) {
  const ix = searchIndex(facts);
  if (!ix.docs.length) return null;
  const own = termFrequencies(factText(candidate.slug, candidate));
  const terms = [...own.tf.keys()];
  const ceiling = bm25(ix, terms, own);
  if (!ceiling) return null;
  let best = null;
  ix.docs.forEach((doc, i) => {
    const similarity = Math.min(1, bm25(ix, terms, doc) / ceiling);
    if (!best || similarity > best.similarity) best = { slug: ix.slugs[i], similarity };
  });
  return best;
}

/** One line of the ALREADY STORED list. */
export const storedLine = (slug, desc) => (desc ? `- ${slug} — ${desc}` : `- ${slug}`);

/**
 * The slugs the prompt lists as ALREADY STORED, in listing order: the `recent` newest by mtime, then the
 * best BM25 matches for `notes`, each once, while their lines fit in `maxChars`. The first line that
 * does not fit ends the list, so a better match is never traded for a worse, shorter one.
 */
export function pickStored(facts, notes, maxChars, recent = RECENT_FACTS) {
  const newest = [...facts.entries()].sort((a, b) => (b[1].mtime ?? 0) - (a[1].mtime ?? 0))
    .slice(0, recent).map(([slug]) => slug);
  const seen = new Set();
  const picked = [];
  let used = 0;
  for (const slug of [...newest, ...rankFacts(facts, notes).map((h) => h.slug)]) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const line = storedLine(slug, facts.get(slug).desc);
    if (used + line.length > maxChars) break;
    picked.push(slug);
    used += line.length + 1;
  }
  return picked;
}
// ---- memory-search twin: END
