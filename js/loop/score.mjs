/**
 * The loop's risk arithmetic — pure, and imported by the build driver (the `--trust` choices),
 * so it must stay free of every import but node builtins: the driver's closure bans
 * child_process outright.
 *
 * WHY MAX AND NOT A SUM. A block that renames ten things and changes one public contract is a
 * contract change; adding the renames up would let ten trivial edits outvote one critical one
 * in the wrong direction — or, with a sum, let a pile of trivia trip a blocking stop that no
 * single edit deserves. One critical action makes the block critical, nothing else does.
 *
 * WHY THE DIFF CAN ONLY RAISE THE SCORE. The declared score is the identify brick's account of
 * what it is about to do; the diff is what it did. The account may be optimistic, never the
 * other way round, so the actual score is max(declared, escalations) — an iteration never earns
 * a lower tier by under-delivering.
 */
import { Buffer } from 'node:buffer';

export const WEIGHTS = Object.freeze({
  format: 0.1, imports: 0.1, rename: 0.2, logic: 0.4, 'new-file': 0.4,
  api: 0.8, delete: 0.8, architecture: 0.9,
});

/** [silent ceiling, soft ceiling] — above the second is blocking. */
export const PRESETS = Object.freeze({
  prudent: Object.freeze([0.1, 0.3]),
  balanced: Object.freeze([0.2, 0.6]),
  aggressive: Object.freeze([0.4, 0.8]),
});
export const DEFAULT_PRESET = 'balanced';

/** More deleted lines than this in one iteration counts as a code deletion. */
export const DELETION_LINES = 20;

const RANK = { silent: 0, soft: 1, blocking: 2 };

export function declaredRisk(actions, overrides = {}) {
  const w = { ...WEIGHTS, ...overrides };
  let score = 0;
  for (const a of actions) {
    if (!Object.hasOwn(w, a)) {
      throw new Error(`unknown action ${JSON.stringify(a)} — one of ${Object.keys(w).join(', ')}`);
    }
    score = Math.max(score, w[a]);
  }
  return score;
}

const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/**
 * Undo git's C-quoting (core.quotepath, on by default): `"caf\303\251.js"` is `café.js`, its
 * octal escapes being the UTF-8 bytes. Decoded here rather than by passing `-c core.quotepath=off`
 * in the skill's verify command, so every caller of `score --diff` is covered, not just the one
 * the skill types.
 */
function unquote(s) {
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const body = s.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') { bytes.push(...Buffer.from(body[i])); continue; }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) { bytes.push(Number.parseInt(octal[0], 8)); i += 3; continue; }
    i += 1;
    bytes.push(C_ESCAPES[body[i]] ?? body.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * A numstat path, as [new, old] for a rename or [path] otherwise. Git prints a rename as
 * `pre/{a => b}/post` (either side may be empty, leaving a `//` to collapse), or as `old => new`
 * — always that form, each side quoted, when either side needs quoting.
 */
function numstatPaths(raw) {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (brace) {
    const [, pre, a, b, post] = brace;
    const join = (mid) => `${pre}${mid}${post}`.replace(/\/{2,}/g, '/').replace(/^\//, '');
    return [join(b), join(a)];
  }
  const arrow = raw.indexOf(' => ');
  if (arrow >= 0) return [unquote(raw.slice(arrow + 4)), unquote(raw.slice(0, arrow))];
  return [unquote(raw)];
}

/**
 * `git diff --numstat` rows. A binary file reports `-` for both counts; it counts as 0. A rename
 * yields BOTH paths — the new one with the counts, the old one with 0/0 — so a rename out of or
 * into the write set is checked on each side without counting its lines twice.
 */
export function parseNumstat(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(\S+)\t(\S+)\t(.+)$/.exec(line);
    if (!m) continue;
    const n = (s) => (s === '-' ? 0 : Number.parseInt(s, 10) || 0);
    const [file, old] = numstatPaths(m[3]);
    rows.push({ file, added: n(m[1]), deleted: n(m[2]) });
    if (old !== undefined) rows.push({ file: old, added: 0, deleted: 0 });
  }
  return rows;
}

const slash = (p) => p.replaceAll('\\', '/');

export function actualRisk(declared, files, { writeSet = [], contracts = [], overrides = {} } = {}) {
  const w = { ...WEIGHTS, ...overrides };
  let score = declared;
  const reasons = [];
  const inSet = new Set(writeSet.map(slash));
  const outside = files.filter((f) => !inSet.has(slash(f.file)));
  if (outside.length) {
    score = Math.max(score, 0.8);
    reasons.push(`outside the write set: ${outside.map((f) => slash(f.file)).join(', ')}`);
  }
  const deleted = files.reduce((n, f) => n + f.deleted, 0);
  if (deleted > DELETION_LINES) {
    score = Math.max(score, w.delete);
    reasons.push(`${deleted} lines deleted`);
  }
  const contractSet = new Set(contracts.map(slash));
  const hit = files.filter((f) => contractSet.has(slash(f.file)));
  if (hit.length) {
    score = Math.max(score, w.api);
    reasons.push(`contract files: ${hit.map((f) => slash(f.file)).join(', ')}`);
  }
  return { score, reasons };
}

export function decide(score, preset) {
  if (!Object.hasOwn(PRESETS, preset)) {
    throw new Error(`unknown preset ${JSON.stringify(preset)} — one of ${Object.keys(PRESETS).join(', ')}`);
  }
  const t = PRESETS[preset];
  if (score <= t[0]) return 'silent';
  if (score <= t[1]) return 'soft';
  return 'blocking';
}

export function worst(a, b) {
  if (a === undefined || a === null) return b;
  if (b === undefined || b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}
