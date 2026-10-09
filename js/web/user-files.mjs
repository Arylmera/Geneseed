/**
 * The two hand-written files the console EDITS — `user-rules.md` and `PROFILE.md` — read and
 * written under one rule: every write carries the fingerprint of the content the client last
 * read, and a stale one is refused (`ok: false`, which `routes.mjs` answers 409) rather than
 * clobbering whatever an agent session wrote in between.
 *
 * Split out of `actions.mjs`/`api.mjs` because the fingerprint protocol is one thing with a
 * reader half and a writer half, and the two halves had ended up in different files.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

import { PROFILE_STUB } from '../build/stubs.mjs';
import { readMaybe } from '../hosts/installs.mjs';
import { frontmatter } from '../hosts/memory-files.mjs';
import { writeText, isFile, isDir } from '../lib/fs.mjs';
import { formatRepr, isTruthy } from '../lib/json.mjs';
import { WHITESPACE, codePointLength, stripWhitespace } from '../lib/text.mjs';
import { splitLines } from '../lib/udiff.mjs';
import { isFactName } from '../maintain/memory.mjs';
import { apiMemoryDelete, bget, strOr } from './actions.mjs';
import { NotFound, memoryDir } from './catalog.mjs';

/** Splits on runs of `WHITESPACE` (not `\s`), dropping empty strings. */
const splitWords = (s) => s.split(new RegExp(`[${WHITESPACE}]+`)).filter(Boolean);

/** Today's date, LOCAL (not UTC) — this is a user-facing date, not a wire timestamp. */
function todayIso(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * `today` and `today + n days`, from ONE sample of the clock.
 *
 * Two separate `new Date()` calls would let the provenance line and the expiry land on
 * either side of a midnight that fell between them — a one-run-in-86400 disagreement, which
 * is the worst kind to debug.
 */
function promoteDates(days) {
  const d = new Date();
  const today = todayIso(d);
  d.setDate(d.getDate() + days);
  return [today, todayIso(d)];
}

/** SHA-256 hex, first 16 chars — `""` for an empty file. */
export function fingerprint(text) {
  return text ? createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16) : '';
}

/**
 * Strict equality on the RAW body value, not run through `strOr` first. `strOr(0)` folds to
 * `''` (0 is falsy), which would wrongly equal an absent file's `''` fingerprint and let a
 * client send `"fingerprint": 0` and overwrite regardless of what is actually on disk.
 */
const fpMatches = (got, want) => typeof got === 'string' && got === want;

// ---- user rules (user-rules.md) ----------------------------------------------------------

export const RULES_FILE = 'user-rules.md';
const rulesPath = (state) => path.join(state.target, RULES_FILE);

/**
 * `## R<n> — Title`, anchored at column 0 so a rule body's fenced code and the stub's
 * indented format example never parse as rules.
 *
 * The whitespace classes are `WHITESPACE`, not `\s`: this pattern runs over a HAND-EDITED
 * file, which is where a non-breaking space actually turns up. `\S` is its complement for
 * the same reason.
 *
 * `\d` IS LEFT ASCII, and that is a declared divergence rather than an oversight, unlike
 * `ruleFields` below which uses `\p{Nd}`. No theme seeds a non-ASCII rule id, no build
 * writes one, and the web editor cannot produce one either — it writes `R<n>` itself from
 * `max(ids) + 1`. Widening this to match would only move the gap one line down, to whatever
 * parses the captured digits back into a number.
 */
const RULE_HEAD_RE = new RegExp(
  `^##[${WHITESPACE}]+R(\\d+)[${WHITESPACE}]*[—–-]+[${WHITESPACE}]*`
  + `([^${WHITESPACE}].*?)[${WHITESPACE}]*$`,
);

/** Advisory only; nothing blocks past it. */
const RULES_BUDGET = { max_rules: 15, max_tokens: 1500 };

const META_RE = new RegExp(`^\\((.+)\\)[${WHITESPACE}]*$`);

/** `{}` when the line is body rather than metadata. */
function parseRuleMeta(line) {
  const m = META_RE.exec(stripWhitespace(line));
  if (!m) return {};
  const meta = {};
  for (const part of m[1].split('|')) {
    const at = part.indexOf(':');
    if (at < 0) continue;               // `partition` with no separator — not a pair
    const key = stripWhitespace(part.slice(0, at)).toLowerCase().replaceAll(' ', '_');
    if (['scope', 'source', 'trial_until'].includes(key)) {
      meta[key] = stripWhitespace(part.slice(at + 1));
    }
  }
  return meta;
}

/**
 * `user-rules.md` parsed to `[rules, warnings]`.
 *
 * Every rule carries its `start`/`end` LINE INDICES, which is what lets `apiRulesMutate`
 * splice exactly one block and leave every other byte of the user's file — prose,
 * formatting, hand-written sections — untouched.
 * @returns {[Array<{id: number, start: number, end: number} & Record<string, any>>, string[]]}
 */
export function parseRules(text) {
  const lines = splitLines(text);
  const rules = [];
  const warnings = [];
  const seen = new Set();
  for (let idx = 0; idx < lines.length; idx += 1) {
    const m = RULE_HEAD_RE.exec(lines[idx]);
    if (!m) continue;
    let end = lines.length;
    for (let j = idx + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith('## ')) { end = j; break; }
    }
    const rid = Number(m[1]);
    if (seen.has(rid)) warnings.push(`duplicate rule id R${rid}`);
    seen.add(rid);
    let k = idx + 1;
    while (k < end && !stripWhitespace(lines[k])) k += 1;
    const meta = k < end ? parseRuleMeta(lines[k]) : {};
    if (Object.keys(meta).length) k += 1;
    rules.push({
      id: rid,
      title: m[2],
      scope: Object.hasOwn(meta, 'scope') ? meta.scope : 'project',
      source: Object.hasOwn(meta, 'source') ? meta.source : '',
      trial_until: Object.hasOwn(meta, 'trial_until') ? meta.trial_until : '',
      body: stripWhitespace(lines.slice(k, end).join('\n')),
      start: idx,
      end,
    });
  }
  return [rules, warnings];
}

export function apiRules(state) {
  const p = rulesPath(state);
  if (!isFile(p)) {
    return { exists: false, path: p, rules: [], warnings: [], fingerprint: '',
      stats: { rules: 0, lines: 0, tokens: 0, ...RULES_BUDGET } };
  }
  const text = readMaybe(p) ?? '';
  const [rules, warnings] = parseRules(text);
  const today = todayIso();
  const out = rules.map((r) => ({
    id: r.id, title: r.title, scope: r.scope, source: r.source,
    trial_until: r.trial_until,
    status: r.trial_until ? 'trial' : 'active',
    overdue: Boolean(r.trial_until) && r.trial_until < today,
    body: r.body,
  }));
  return { exists: true, path: p, rules: out, warnings, fingerprint: fingerprint(text),
    // CODE POINTS, not `String.length` (UTF-16 units) — an emoji in a rule body would
    // otherwise put the token estimate off.
    stats: { rules: rules.length, lines: splitLines(text).length,
      tokens: Math.floor(codePointLength(text) / 4), ...RULES_BUDGET } };
}

function rulesRead(state) {
  const p = rulesPath(state);
  return [p, isFile(p) ? (readMaybe(p) ?? '') : ''];
}

function ruleBlock(rid, title, scope, source, trialUntil, body) {
  const meta = [`scope: ${scope}`];
  if (source) meta.push(`source: ${source}`);
  if (trialUntil) meta.push(`trial until: ${trialUntil}`);
  return `## R${rid} — ${title}\n(${meta.join(' | ')})\n${stripWhitespace(body)}\n`;
}

/**
 * Validate and normalise a rule's writable fields. Throws (→ the shell's JSON 500 carrying
 * the message) on an unusable rule.
 *
 * `\p{Nd}` here and not `\d`, unlike `RULE_HEAD_RE` above: this is a pure predicate over a
 * string that stays a string, so accepting any Unicode decimal digit costs nothing and
 * needs no numeric parse afterward.
 */
function ruleFields(body) {
  const title = splitWords(strOr(bget(body, 'title'))).join(' ');
  const text = stripWhitespace(strOr(bget(body, 'body')));
  if (!title) throw new Error('a rule needs a title');
  if (!text) throw new Error('a rule needs body text');
  let scope = bget(body, 'scope');
  if (scope !== 'user' && scope !== 'project') scope = 'project';
  const source = splitWords(strOr(bget(body, 'source'))).join(' ');
  const trial = stripWhitespace(strOr(bget(body, 'trial_until')));
  if (trial && !/^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}$/u.test(trial)) {
    throw new Error('trial until must be YYYY-MM-DD');
  }
  return [title, text, scope, source, trial];
}

/**
 * Coerces whatever `id` came out of the parsed body into an integer, or throws
 * `NotFound('rule id')`. Handles a decimal string (surrounding whitespace stripped), a
 * boolean, a bare number (truncated), and a `JsonNumber`-shaped value via its `valueOf()` —
 * whatever `parseJson` could have produced for this field.
 */
function ruleId(v) {
  if (typeof v === 'string') {
    const s = stripWhitespace(v);
    if (!/^[+-]?\d+$/.test(s)) throw new NotFound('rule id');
    return Number(s);
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Math.trunc(v);
  if (v !== null && v !== undefined && typeof v.valueOf === 'function'
      && typeof v.valueOf() === 'number') {
    return Math.trunc(v.valueOf());
  }
  throw new NotFound('rule id');
}

/**
 * Add / update / delete on user-rules.md.
 *
 * EVERY MUTATION REQUIRES THE FINGERPRINT OF THE CONTENT THE CLIENT LAST READ. An agent
 * session may be editing the same file mid-flight, so a stale write returns `ok: false`
 * (which the shell maps to 409) and the client re-fetches — it never clobbers. The fresh
 * fingerprint comes back in the response so a client can chain edits without a re-fetch.
 */
export function apiRulesMutate(state, body) {
  const op = bget(body, 'op');
  if (op !== 'add' && op !== 'update' && op !== 'delete') {
    throw new NotFound(`rules op ${formatRepr(op)}`);
  }
  const [p, original] = rulesRead(state);
  let text = original;
  if (!fpMatches(bget(body, 'fingerprint', ''), fingerprint(text))) {
    return { ok: false, error: 'conflict',
      detail: 'user-rules.md changed since you loaded it — reloading' };
  }
  const [rules] = parseRules(text);
  let rid;
  let next;
  if (op === 'add') {
    const [title, rtext, scope, source, trial] = ruleFields(body);
    rid = rules.reduce((mx, r) => (r.id > mx ? r.id : mx), 0) + 1;
    if (!text) text = '# User rules\n';
    next = `${text.replace(/\n+$/, '')}\n\n${ruleBlock(rid, title, scope, source, trial, rtext)}`;
  } else {
    rid = ruleId(bget(body, 'id'));
    const target = rules.find((r) => r.id === rid);
    if (target === undefined) throw new NotFound(`rule R${rid}`);
    const lines = splitLines(text);
    if (op === 'update') {
      const [title, rtext, scope, source, trial] = ruleFields(body);
      const block = ruleBlock(rid, title, scope, source, trial, rtext);
      lines.splice(target.start, target.end - target.start,
        ...splitLines(block.replace(/\n+$/, '')));
    } else {
      // delete — also swallow ONE preceding blank separator line, or repeated deletes leave
      // a growing run of blank lines in the user's file.
      let start = target.start;
      if (start > 0 && !stripWhitespace(lines[start - 1])) start -= 1;
      lines.splice(start, target.end - start);
    }
    next = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  }
  writeText(p, next);
  return { ok: true, op, id: rid, fingerprint: fingerprint(next) };
}

/**
 * One memory fact promoted into a trial rule. The provenance line and the month of
 * probation are the rule this endpoint owns, and both are DATES read from the real clock —
 * not destamped, since destamping would erase exactly the thing being recorded.
 */
export function apiRulesPromote(state, body) {
  const name = strOr(bget(body, 'name'));
  const d = memoryDir(state);
  if (!isDir(d)) throw new NotFound('memory store');
  // `isFactName`, the `geneseed memory` verb's rule: CASE-FOLDED, because on Windows and macOS
  // `memory` opens MEMORY.md — and `delete_memory` below would then delete the index.
  if (!isFactName(name)) throw new NotFound(name);
  const src = path.join(d, `${name}.md`);
  if (!isFile(src)) throw new NotFound(name);
  const [fm, memBody] = frontmatter(readMaybe(src) ?? '');
  const fmName = fm.has('name') ? fm.get('name') : name;
  const fmDesc = fm.has('description') ? fm.get('description') : '';
  const [today, trial] = promoteDates(30);
  const res = apiRulesMutate(state, {
    op: 'add',
    fingerprint: bget(body, 'fingerprint', ''),
    title: isTruthy(bget(body, 'title')) ? bget(body, 'title') : fmName,
    body: isTruthy(bget(body, 'body')) ? bget(body, 'body')
      : (stripWhitespace(memBody) || fmDesc),
    scope: bget(body, 'scope'),
    source: `memory ${name}, promoted ${today}`,
    trial_until: trial,
  });
  if (isTruthy(res.ok) && isTruthy(bget(body, 'delete_memory'))) {
    apiMemoryDelete(state, name);
    res.deleted_memory = name;
  }
  return res;
}

// ---- PROFILE.md --------------------------------------------------------------------------

/** Beside the deployed AGENT.md. */
export const PROFILE_FILE = 'PROFILE.md';
const profilePath = (state) => path.join(state.target, PROFILE_FILE);

export function apiProfile(state) {
  const p = profilePath(state);
  if (!isFile(p)) return { exists: false, path: p, text: '', fingerprint: '' };
  const text = readMaybe(p) ?? '';
  // `seeded`: the file is still the template the build wrote once and never touched since.
  // `readMaybe` normalises line endings, so a CRLF copy (the emit writes the platform's, and
  // an editor may re-save either way) still compares equal to the LF literal.
  const seeded = text === PROFILE_STUB;
  return { exists: true, path: p, text, fingerprint: fingerprint(text), seeded };
}

/** The whole file, fingerprint-guarded like the rules above. */
export function apiProfileSave(state, body) {
  const p = profilePath(state);
  const cur = isFile(p) ? (readMaybe(p) ?? '') : '';
  if (!fpMatches(bget(body, 'fingerprint', ''), fingerprint(cur))) {
    return { ok: false, error: 'conflict',
      detail: 'PROFILE.md changed since you loaded it — reloading' };
  }
  let next = strOr(bget(body, 'text'));
  if (next && !next.endsWith('\n')) next += '\n';
  writeText(p, next);
  // The fingerprint of what is ON DISK, which is not the fingerprint of what was SENT once
  // the newline has been appended — and the client chains its next save off this value.
  return { ok: true, path: p, fingerprint: fingerprint(next) };
}
