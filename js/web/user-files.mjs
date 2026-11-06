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
import { frontmatter, isRuleEdge, parseRules } from '../hosts/memory-files.mjs';
import { writeText, isFile, isDir } from '../lib/fs.mjs';
import { formatRepr, isTruthy } from '../lib/json.mjs';
import { WHITESPACE, codePointLength, stripWhitespace } from '../lib/text.mjs';
import { splitLines } from '../lib/udiff.mjs';
import { isFactName } from '../maintain/memory.mjs';
import { apiMemoryDelete, bget, strOr } from './actions.mjs';
import { BadRequest, NotFound, memoryDir, tierOf } from './catalog.mjs';

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
/** The folder of the two hand-written files: the tier for a global install, else the bundle. */
const userDir = (state) => tierOf(state)?.root ?? state.target;
const rulesPath = (state) => path.join(userDir(state), RULES_FILE);

/**
 * The blocks the fold left in `<tier>/user-rules.draft.md`, as `{title, host, body}`, in file
 * order. The console only SHOWS them: the rule Rite is the only draft writer (C15), so no verb
 * here decides one. A `## Rule from <host>: <title>` block is a pointer line, then the rule. A
 * `## Choose: <file>` block is a question about two files, so it keeps its title alone. Every
 * other heading (`## Renumbered`, the file's record of past decisions) ends the block before it
 * and adds none. A block the ledger already holds as decided is left over from a stopped Rite
 * write, so it is not pending; a block with no row, or a ledger that does not parse, still shows.
 * Empty for a project install and for a missing draft.
 */
function ruleDrafts(state) {
  const tier = tierOf(state);
  const out = [];
  let open = null;
  for (const line of splitLines((tier && readMaybe(tier.draft)) ?? '')) {
    if (line.startsWith('## ')) {
      const rule = /^## Rule from ([^:]+): (.+)$/.exec(line);
      open = rule ? { title: rule[2], host: rule[1], lines: [] }
        : line.startsWith('## Choose: ') ? { title: line.slice(3), host: null, lines: [] } : null;
      if (open) out.push(open);
    } else open?.lines.push(line);
  }
  let ledger = {};
  try { ledger = JSON.parse((tier && readMaybe(tier.foldState)) ?? '{}').items ?? {}; } catch { /* shows all */ }
  const decided = ({ lines }) => {
    const row = ledger[/sha256: (\w+)/.exec(lines[0] ?? '')?.[1]];
    return row != null && row.state !== 'pending';
  };
  return out.filter((d) => !decided(d)).map(({ title, host, lines }) => (
    { title, host, body: host ? stripWhitespace(lines.slice(1).join('\n')) : '' }));
}

/**
 * The estimate of what a text costs in the context, each turn. CODE POINTS, not `String.length`
 * (UTF-16 units): an emoji in a rule body would otherwise put it off.
 */
const tokensOf = (text) => Math.floor(codePointLength(text) / 4);

export function apiRules(state) {
  const p = rulesPath(state);
  if (!isFile(p)) {
    return { exists: false, path: p, rules: [], warnings: [], fingerprint: '',
      shared: tierOf(state) !== null, drafts: ruleDrafts(state),
      stats: { rules: 0, lines: 0, tokens: 0 } };
  }
  const text = readMaybe(p) ?? '';
  const [rules, warnings] = parseRules(text);
  const today = todayIso();
  const lines = splitLines(text);
  const out = rules.map((r) => ({
    id: r.id, title: r.title, scope: r.scope, source: r.source,
    trial_until: r.trial_until,
    status: r.trial_until ? 'trial' : 'active',
    overdue: Boolean(r.trial_until) && r.trial_until < today,
    body: r.body,
    // The rule's whole block, heading and metadata too: that is what the agent reads.
    tokens: tokensOf(stripWhitespace(lines.slice(r.start, r.end).join('\n'))),
  }));
  return { exists: true, path: p, rules: out, warnings, fingerprint: fingerprint(text),
    shared: tierOf(state) !== null, drafts: ruleDrafts(state),
    // The whole file, so it holds its header too: more than the rules' own tokens added up.
    stats: { rules: rules.length, lines: lines.length, tokens: tokensOf(text) } };
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
 * Validate and normalise a rule's writable fields. Throws `BadRequest` (→ the shell's 400,
 * carrying the message) on an unusable rule.
 *
 * `\p{Nd}` here and not `\d`, unlike `RULE_HEAD_RE` above: this is a pure predicate over a
 * string that stays a string, so accepting any Unicode decimal digit costs nothing and
 * needs no numeric parse afterward.
 *
 * REFUSED, NEVER REWRITTEN: a body line that `isRuleEdge` reads would truncate this rule and
 * could forge another rule's id, and a `|` in the scope or source would forge a metadata field. An
 * unknown scope (one written by hand, such as `team`) is kept as written — coercing it to `project` made
 * every Edit or Graduate silently change the user's rule.
 */
function ruleFields(body) {
  const title = splitWords(strOr(bget(body, 'title'))).join(' ');
  const text = stripWhitespace(strOr(bget(body, 'body')));
  if (!title) throw new BadRequest('a rule needs a title');
  if (!text) throw new BadRequest('a rule needs body text');
  if (splitLines(text).some(isRuleEdge)) {
    throw new BadRequest('a rule body cannot have a line that starts with "## " (a rule heading)');
  }
  const scope = splitWords(strOr(bget(body, 'scope'))).join(' ') || 'project';
  if (scope.includes('|')) throw new BadRequest('a rule scope cannot contain "|"');
  const source = splitWords(strOr(bget(body, 'source'))).join(' ');
  if (source.includes('|')) throw new BadRequest('a rule source cannot contain "|" (write it as "/")');
  const trial = stripWhitespace(strOr(bget(body, 'trial_until')));
  if (trial && !/^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}$/u.test(trial)) {
    throw new BadRequest('trial until must be YYYY-MM-DD');
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
 * Where a retired rule goes: a SEPARATE file beside user-rules.md that nothing ever loads. It is
 * not a session file, so its text never reaches an agent's context and cannot be obeyed by
 * mistake; it exists so a retire never loses the text. Like user-rules.md it is the user's: no
 * install manifest claims it, so no uninstall deletes it.
 */
const RETIRED_RULES_FILE = 'user-rules-retired.md';
const RETIRED_HEADER = '# Retired rules — not in force, never loaded into any session.\n';
const isBlank = (line) => !stripWhitespace(line);

/**
 * Add / update / retire on user-rules.md. Retire is op `delete` on the wire (the client's
 * name for it), but it never loses the text: the block moves, verbatim, to the end of
 * `RETIRED_RULES_FILE`, which the first retire creates.
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
  const retiredPath = path.join(userDir(state), RETIRED_RULES_FILE);
  let rid;
  let next;
  if (op === 'add') {
    const [title, rtext, scope, source, trial] = ruleFields(body);
    // A retired id is never handed out again, so an id in the user's history names one rule.
    const [retired] = parseRules(readMaybe(retiredPath) ?? '');
    rid = [...rules, ...retired].reduce((mx, r) => (r.id > mx ? r.id : mx), 0) + 1;
    if (!text) text = '# User rules\n';
    next = `${text.replace(/\n+$/, '')}\n\n${ruleBlock(rid, title, scope, source, trial, rtext)}`;
  } else {
    rid = ruleId(bget(body, 'id'));
    const target = rules.find((r) => r.id === rid);
    if (target === undefined) throw new NotFound(`rule R${rid}`);
    const lines = splitLines(text);
    // The block's own lines, without the blank separator after it: that separator is the seam
    // with whatever follows, so it stays where it is.
    let end = target.end;
    while (end > target.start + 1 && isBlank(lines[end - 1])) end -= 1;
    if (op === 'update') {
      const [title, rtext, scope, source, trial] = ruleFields(body);
      const block = ruleBlock(rid, title, scope, source, trial, rtext);
      lines.splice(target.start, end - target.start, ...splitLines(block.replace(/\n+$/, '')));
    } else {
      const moved = lines.splice(target.start, end - target.start);
      // Two blanks now meet at the seam; drop one, or repeated retires grow a run of them.
      if (target.start > 0 && target.start < lines.length
          && isBlank(lines[target.start - 1]) && isBlank(lines[target.start])) {
        lines.splice(target.start, 1);
      }
      // THE RETIRED FILE FIRST: if the second write fails, the rule is in both files, never in
      // neither.
      const kept = (readMaybe(retiredPath) ?? RETIRED_HEADER).replace(/\n+$/, '');
      writeText(retiredPath, `${kept}\n\n${moved.join('\n')}\n`);
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

/** In `userDir`: the tier for a global install, else beside the deployed AGENT.md. */
export const PROFILE_FILE = 'PROFILE.md';
const profilePath = (state) => path.join(userDir(state), PROFILE_FILE);

export function apiProfile(state) {
  const p = profilePath(state);
  const shared = tierOf(state) !== null;
  if (!isFile(p)) return { exists: false, path: p, text: '', fingerprint: '', shared };
  const text = readMaybe(p) ?? '';
  // `seeded`: the file is still the template the build wrote once and never touched since.
  // `readMaybe` normalises line endings, so a CRLF copy (the emit writes the platform's, and
  // an editor may re-save either way) still compares equal to the LF literal.
  const seeded = text === PROFILE_STUB;
  return { exists: true, path: p, text, fingerprint: fingerprint(text), seeded, shared };
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
