/**
 * The web console's WRITES — the mutating endpoints, plus the two GETs that belong beside
 * them.
 *
 * `{cmd: [...]}`, returned by `apiInstallCmd` and `apiDeployCmd` below, IS A FUNCTION'S
 * RETURN TYPE, NOT A RESPONSE BODY: the dispatcher hands it straight to the job runner in
 * the same process, and the client only ever sees a `job_id` at 202 or an `error`. That is
 * why the argv head is `process.execPath` + `bin/build-driver.mjs` — the honest command for
 * the runtime this actually runs on.
 *
 * ---------------------------------------------------------------------------------------
 * `api_pick_folder` DOES NOT CROSS, and that is permanent.
 *
 * It opens an OS-NATIVE folder chooser on the daemon host: `osascript` on macOS, a one-shot
 * `tkinter` subprocess elsewhere. There is no Node twin that is not a new GUI dependency —
 * and the `child_process` ban would make it a sixth `_ALLOWED_SPAWNS` row for a modal
 * dialog. So it is DECLINED rather than deferred, and `js/web/server.mjs` declares it in
 * `DECLINED_POST` — a set separate from `NOT_PORTED_POST`, because the two mean different
 * things and a phase that empties the second must not silently empty the first. The UI
 * already falls back to its editable path field when this endpoint errors, which is the
 * behaviour a 501 produces.
 *
 * ---------------------------------------------------------------------------------------
 * `apiInstallToggle` is a thin endpoint over an engine that lives elsewhere on purpose.
 *
 * Two of its three actions pull in 293 lines of all-or-nothing tree moves with rollback, a
 * stash layout, an `instructions`-entry unmerge, a re-emit-while-disabled guard and a host
 * fork. None of that is web code, and putting the largest engine block behind a web request
 * script would give it the weakest available gate instead of a file-move fixture. So it
 * lives in `js/maintain/uninstall.mjs`: `installDeactivate` and `installReactivate` beside
 * `installUninstall`, the reversible siblings of the same owned-file walk.
 */
import {
  accessSync, constants, copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { emitGlobalInto } from '../../bin/build-driver.mjs';
import {
  ROOT, discoverNames, knownRuleIds, PACK_ORDER,
} from '../build/source.mjs';
import { withStdoutSwallowed } from '../inspect/diff.mjs';
import { excludeAdd, excludeRemove } from '../inspect/excludes.mjs';
import { setupBuildArgs } from '../build/generate.mjs';
import { frontmatter, memoryDropIndex } from '../hosts/hooks.mjs';
import {
  HOSTS, bobConfigDir, claudeConfigDir, copilotConfigDir, expanduser, opencodeConfigDir,
  resolvePath,
} from '../hosts/hosts.mjs';
import {
  EMIT_HOST_SCOPE, doctrinesForBuild, excludedRulesOfDir, footprintOfDir, installState,
  installTargets, modeOfDir, postureOfDir, readMaybe,
} from '../hosts/installs.mjs';
import {
  MCP_PRESETS, isDict, mcpApply, mcpCommented, mcpInstallTargets, mcpKnownNames, mcpLoad,
  mcpMeta, mcpPresetBlock, mcpSave, mcpSetEnabled, mcpState,
} from '../hosts/mcp.mjs';
import { readText, writeText, isFile, isDir } from '../lib/fs.mjs';
import { parseJson, formatRepr, formatValue, isTruthy } from '../lib/json.mjs';
import { WHITESPACE, codePointLength, stripWhitespace } from '../lib/text.mjs';
import { installDeactivate, installReactivate, installUninstall } from '../maintain/uninstall.mjs';
import { splitLines } from '../lib/udiff.mjs';
import {
  NotFound, deployed, emitChoices, fingerprint, themeChoices, viewCfg, within,
} from './api.mjs';

const bget = (body, key, dflt = null) => (isDict(body) && Object.hasOwn(body, key)
  ? body[key] : dflt);

const strOr = (v) => (isTruthy(v) ? formatValue(v) : '');

/**
 * A request body's `doctrines` -> a normalised pack list, or `null` for "said nothing usable".
 *
 * THE SAME TRUST BOUNDARY THE THEME CROSSES, and it needs more care than posture or mode do
 * because this value is a LIST: `discoverNames(...).includes(x)` closes a scalar in one call,
 * but a list has to be closed member by member or one bogus element rides in beside three good
 * ones and reaches an argv. Every name is checked against DISCOVERY — what this checkout
 * actually ships — and the result is re-ordered through `PACK_ORDER`, because the
 * `Active packs:` line the build writes is a marker that a later reader parses back out and a
 * marker whose contents depend on request-body order compares unequal to itself.
 *
 * `null` rather than a substituted default on every rejection, so the caller decides what
 * "unspecified" means for its own endpoint — a rebuild keeps the deployment's answer, a fresh
 * deploy takes the configured one. That mirrors the bogus-theme fallback right beside it.
 *
 * Accepts an array (what the console sends) or a comma string (what a curl by hand sends), and
 * `none`/`[]` both mean the deliberate empty selection — a real configuration, not a rejection.
 */
function bodyDoctrines(body) {
  const raw = bget(body, 'doctrines');
  if (Array.isArray(raw) && !raw.length) return [];
  const names = Array.isArray(raw) ? raw
    : (typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null);
  if (names === null || !names.length) return null;
  if (names.length === 1 && names[0] === 'none') return [];
  const known = discoverNames('doctrines', PACK_ORDER[0]);
  if (!names.every((n) => typeof n === 'string' && known.includes(n))) return null;
  return PACK_ORDER.filter((p) => names.includes(p));
}

/**
 * The SECOND doctrine axis across the same trust boundary — which individual rules to drop.
 *
 * Same shape and same reasons as `bodyDoctrines` above: a list closed member by member
 * against what this checkout actually ships (`knownRuleIds`, the one enumerator the CLI flag
 * uses too), re-ordered canonically because the `Excluded rules:` line it produces is a
 * marker a later reader parses back out, and `null` on any rejection so the caller decides
 * what "unspecified" means.
 *
 * Accepts `process 7` or `process.7` — the console sends the dotted address, and a curl by
 * hand naturally writes the spelling the marker shows. `none`/`[]` is the deliberate empty
 * selection: "exclude nothing", which is a real answer and NOT the same as not saying.
 */
function bodyExcludeRules(body) {
  const raw = bget(body, 'excludeRules');
  if (Array.isArray(raw) && !raw.length) return [];
  const names = Array.isArray(raw) ? raw
    : (typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null);
  if (names === null || !names.length) return null;
  if (names.length === 1 && names[0] === 'none') return [];
  const known = knownRuleIds();
  const ids = names.map((n) => (typeof n === 'string' ? n.trim().replace(/[ \t]+/, '.') : n));
  if (!ids.every((n) => typeof n === 'string' && known.includes(n))) return null;
  return known.filter((id) => ids.includes(id));
}

/** Splits on runs of `WHITESPACE` (not `\s`), dropping empty strings. */
const splitWords = (s) => s.split(new RegExp(`[${WHITESPACE}]+`)).filter(Boolean);

/** Today's date, LOCAL (not UTC) — this is a user-facing date, not a wire timestamp. */
export function todayIso(d = new Date()) {
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
export const RULE_HEAD_RE = new RegExp(
  `^##[${WHITESPACE}]+R(\\d+)[${WHITESPACE}]*[—–-]+[${WHITESPACE}]*`
  + `([^${WHITESPACE}].*?)[${WHITESPACE}]*$`,
);

/** Advisory only; nothing blocks past it. */
export const RULES_BUDGET = { max_rules: 15, max_tokens: 1500 };

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
  if (!name || name.includes('/') || name.includes('\\')
      || name === 'MEMORY' || name === 'README') {
    throw new NotFound(name);
  }
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

/** The whole file, fingerprint-guarded like the rules above. */
export function apiProfileSave(state, body) {
  const p = path.join(state.target, 'PROFILE.md');
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

// ---- memory ------------------------------------------------------------------------------

/** Always `<target>/memory` — never the CWD-scanning resolver. */
const memoryDir = (state) => path.join(state.target, 'memory');

/**
 * One fact file, and its line in the MEMORY.md index.
 *
 * `name` is a BARE SLUG: a path separator, or one of the two reserved names, is refused, so
 * this can only ever remove a fact inside the resolved memory dir. MEMORY.md is the index the
 * agent reads at session start and README.md documents the store — deleting either through
 * this endpoint would be silent damage, which is why the guard is a name check and not a
 * containment check.
 */
export function apiMemoryDelete(state, name) {
  const d = memoryDir(state);
  if (!isDir(d)) throw new NotFound('memory store');
  if (!name || name.includes('/') || name.includes('\\')
      || name === 'MEMORY' || name === 'README') {
    throw new NotFound(name);
  }
  const p = path.join(d, `${name}.md`);
  if (!isFile(p)) throw new NotFound(name);
  unlinkSync(p);
  memoryDropIndex(d, name);
  state.refresh();
  return { deleted: name };
}

// ---- sovereign-repo exclusions -------------------------------------------------------------

/**
 * This endpoint owns no exclusion logic of its own; it validates the body and hands off to
 * the same engine `harness exclude add|remove` calls.
 *
 * A malformed body is rejected with `ok: false` (→ 409) rather than reaching `excludeAdd`,
 * which assumes a real path string. That arm is also where a body that never parsed lands:
 * `readJsonBody` hands the endpoint `{}`, and `{}` has no action.
 */
export function apiExcludesMutate(state, body) {
  const action = bget(body, 'action');
  const p = stripWhitespace(strOr(bget(body, 'path')));
  if ((action !== 'add' && action !== 'remove') || !p) {
    return { ok: false, path: p,
      messages: ['body must be {action: add|remove, path: <folder>}'] };
  }
  return action === 'add' ? excludeAdd(p) : excludeRemove(p);
}

// ---- MCP ----------------------------------------------------------------------------------

export function apiMcp() {
  const out = [];
  for (const [label, p, host, scope, root] of mcpInstallTargets()) {
    if (installState(root, host, scope) !== 'active') continue;
    const cfg = mcpLoad(p, host);
    const servers = [];
    for (const name of mcpKnownNames(cfg, host)) {
      const [lbl, desc] = mcpMeta(name);
      servers.push({ name, label: lbl, desc,
        preset: Object.hasOwn(MCP_PRESETS, name),
        state: mcpState(cfg, name, host) });
    }
    out.push({ label, path: p, host, root, exists: isFile(p),
      commented: mcpCommented(p), servers });
  }
  // `default` is kept for response-shape stability; the table nests MCP per install.
  return { targets: out, default: 0 };
}

/**
 * The MCP config paths a request body is allowed to name, as `path -> [path, host]`.
 *
 * LIFTED OUT OF `apiMcpToggle` BECAUSE IT NOW HAS A SECOND CALLER, not for tidiness. `/api/reveal`
 * hands a path to the desktop's file manager, and the allowlist is the whole security of that
 * endpoint exactly as it is of the toggle: an unlisted path must 404 before anything is opened.
 * Two copies of a security check drift, and the copy that drifts is the one nobody re-read.
 *
 * It is rebuilt per call rather than cached: installs come and go while the daemon runs, and a
 * stale allowlist is wrong in both directions — refusing a real target, or naming a dead one.
 */
export function mcpTargetPaths() {
  const known = new Map();
  for (const [, cfgPath, host] of mcpInstallTargets()) {
    known.set(String(cfgPath), [cfgPath, host]);
  }
  return known;
}

/**
 * Enable / disable / first-add one server.
 *
 * THE PATH COMES OUT OF THE REQUEST BODY, so the allowlist is the whole security of this
 * endpoint: `known` is built from the detected install targets and an unlisted path is a 404
 * before anything is read or written. Without it this is "write arbitrary JSON to an
 * arbitrary file", behind a CSRF token and nothing else.
 *
 * The Claude-shaped hosts are parsed ONCE, STRICTLY, and that exact object is what gets
 * rewritten — so the safety check and the value saved come from the same read, with no
 * time-of-check/time-of-use gap and no comment-stripper touching a string that contains
 * `,]`. A file that will not parse is refused rather than clobbered: it may be
 * `~/.claude.json`, which holds projects and history far beyond MCP wiring.
 */
export function apiMcpToggle(state, body) {
  const name = strOr(bget(body, 'name'));
  const want = isTruthy(bget(body, 'enabled'));
  const pathArg = strOr(bget(body, 'path'));
  const known = mcpTargetPaths();
  const hit = known.get(pathArg);
  if (hit === undefined || !name) {
    throw new NotFound(`mcp target ${pathArg || '(none)'}`);
  }
  const [p, host] = hit;
  if (mcpCommented(p)) {
    return { ok: false, error: 'config holds comments — edit it by hand to keep them' };
  }
  let cfg;
  if (['claude', 'bob', 'copilot'].includes(host)) {
    if (isFile(p)) {
      let parsed;
      try {
        parsed = parseJson(readText(p));
      } catch {
        parsed = null;
      }
      if (!isDict(parsed)) {
        return { ok: false,
          error: "couldn't parse this config — edit it by hand to avoid data loss" };
      }
      cfg = parsed;
    } else {
      cfg = {};
    }
  } else {
    cfg = mcpLoad(p);
  }
  if (mcpState(cfg, name, host) === 'absent') {
    if (!Object.hasOwn(MCP_PRESETS, name)) {
      return { ok: false, error: `unknown server '${name}'` };
    }
    if (!want) return { ok: false, error: `'${name}' is not configured` };
    cfg = mcpApply(cfg, name, mcpPresetBlock(name, host), host);
    cfg = mcpSetEnabled(cfg, name, true, host);
  } else {
    cfg = mcpSetEnabled(cfg, name, want, host);
  }
  mcpSave(p, cfg);
  return { ok: true, name, state: mcpState(cfg, name, host) };
}

// ---- the harness selector ------------------------------------------------------------------

/**
 * Re-point the whole console at a detected install.
 *
 * The (host, path) PAIR must be one of the detected targets, and the ROOT is threaded through
 * beside the data dir: markers and sigils live at the install root, not in the data dir, and
 * without it a claude/bob PROJECT view mis-detects as opencode/neutral.
 *
 * The pair is SERIALISED into the key rather than concatenated with a separator: the path
 * comes straight out of a request body, and any separator it could contain would let one
 * pair impersonate another in a lookup whose whole job is to be an allowlist.
 */
export function apiSelectView(state, body) {
  const known = new Map();
  for (const [host, scope, root] of installTargets()) {
    known.set(JSON.stringify([host, String(root)]), [host, scope, root]);
  }
  const hit = known.get(JSON.stringify(
    [strOr(bget(body, 'host')), strOr(bget(body, 'path'))],
  ));
  if (hit === undefined) throw new NotFound('unknown install (host, path)');
  const [host, scope, root] = hit;
  state.selectView(viewCfg(host, scope, root), root);
  return { ok: true, target: state.target, theme: state.theme, emit: state.emit };
}

// ---- restore, and the two build-command resolvers ---------------------------------------

/**
 * (theme, emit) for a Build POST.
 *
 * A valid override in the body wins; anything missing or unrecognised falls back to the
 * DETECTED install, so a bogus body value can never reach the build argv. That is the same
 * allowlist shape `apiInstallCmd` uses, and it is the reason neither endpoint needs to
 * sanitise a string: an unknown one is simply not used.
 */
export function buildOverride(state, body) {
  const themes = new Set(themeChoices().map((c) => c.name));
  const emits = new Set(emitChoices().map((c) => c.name));
  const t = bget(body, 'theme');
  const e = bget(body, 'emit');
  return [themes.has(t) ? t : state.theme, emits.has(e) ? e : state.emit];
}

/**
 * The global emit matching a deployed install's `.geneseed-emit`, so the EXPECTED render
 * uses the install's own host dialect.
 *
 * Returns the HOST rather than a function, because `emitGlobalInto(host, …)` is the shape
 * `js/inspect/diff.mjs` already calls it with. An unknown or missing marker falls back to
 * OpenCode.
 */
export function globalEmitHostFor(emit) {
  const host = (EMIT_HOST_SCOPE.get(emit || '') ?? ['opencode', 'global'])[0];
  return HOSTS.some((h) => h.host === host) ? host : 'opencode';
}

/**
 * Restore selected drifted files from the SOURCE render.
 *
 * Source wins and local edits are discarded (the inverse, keeping them, is Export
 * improvements). Renders the expected copy exactly as `diffCollect` does, then per rel:
 * expected present -> overwrite/create the deployed copy; expected absent but deployed present
 * (an 'added' file) -> delete it; neither -> an error and nothing touched.
 *
 * SYNCHRONOUS, AND NOT A JOB. One render, the same cost as a diff GET, and it returns a
 * structured result rather than a job id — which is why the dispatcher answers it before it
 * ever consults the action table.
 *
 * THE EMIT AND THE FOOTPRINT ARE READ OFF THE DEPLOYMENT: a silently-OpenCode `expected`
 * would overwrite a Claude install's agents with the wrong frontmatter, and a full-footprint
 * `expected` on a lean install rewrites AGENT.md with the inlined laws and DELETES
 * `laws/universal.md`, which only the lean emit writes.
 *
 * THE POSTURE AND THE MODE cost the most of the four, because this verb WRITES. Rendering
 * `expected` at `peer`/`direct` made restoring AGENT.md silently revert the user's chosen
 * register — and `diffCollect`'s matching hole is what put the file in the restore list in the
 * first place, so the panel offered the revert and then performed it. Both sides read the
 * deployment now; `state` already carries the two values (`installs.mjs` detects them from
 * the rendered `## Posture` / `## Mode` lead).
 */
export function apiRestore(state, files) {
  if (!deployed(state)) {
    return { restored: [], deleted: [], errors: ['no deployed harness'] };
  }
  const restored = [];
  const deleted = [];
  const errors = [];
  const target = resolvePath(state.target);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'geneseed-restore-'));
  try {
    const expected = resolvePath(path.join(tmp, 'expected'));
    withStdoutSwallowed(() => emitGlobalInto(globalEmitHostFor(state.emit), {
      theme: state.theme,
      out: path.join(tmp, 'bundle'),
      cfgDir: expected,
      footprint: state.footprint,
      posture: state.posture,
      mode: state.mode,
      // THE PACK SELECTION IS THE FIFTH, and it is the one that makes this verb a BOUNDARY
      // question rather than a cosmetic one. `expected` rendered at all four packs, and this
      // verb COPIES OUT OF IT: restoring AGENT.md onto an install built `--doctrines craft`
      // wrote a carrier stating doctrine process 5 while `claudeHookGroups` had wired no gate
      // behind it — prompt and boundary disagreeing by a WRITE, the write-side twin of the
      // read-side hole `diffCollect` had (and the reason the panel offered the file at all).
      doctrines: doctrinesForBuild(target),
    }));
    for (const raw of (isTruthy(files) ? files : [])) {
      const rel = stripWhitespace(formatValue(raw).replace(/\\/g, '/')).replace(/^\/+/, '');
      const dst = resolvePath(path.join(target, rel));
      const src = resolvePath(path.join(expected, rel));
      if (!rel || !within(dst, target) || !within(src, expected)) {
        errors.push(`${rel}: outside the deployed tree`);
      } else if (isFile(src)) {
        mkdirSync(path.dirname(dst), { recursive: true });
        // A BYTE copy, so the restored file keeps the render's own line endings rather than
        // the platform's (the `writeText`/`copy2` rule, one file over).
        copyFileSync(src, dst);
        restored.push(rel);
      } else if (isFile(dst)) {
        unlinkSync(dst);
        deleted.push(rel);
      } else {
        errors.push(`${rel}: not in the source render nor deployed`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  state.refresh();
  return { restored, deleted, errors };
}

/** (host, scope) -> the emit name that installs it. */
const EMIT_FOR = new Map([
  ['opencode global', 'opencode-global'], ['opencode project', 'opencode'],
  ['claude global', 'claude-global'], ['claude project', 'claude'],
  ['bob global', 'bob-global'], ['bob project', 'bob'],
  ['copilot global', 'copilot-global'], ['copilot project', 'copilot'],
]);

/**
 * The build command that installs Geneseed into a DETECTED location, or re-themes an
 * already-active one (an in-place re-emit, the same command either way).
 *
 * The (host, path) pair MUST be one of the detected targets — the same allowlist
 * `apiSelectView` uses, and the reason the target is never built from raw body input — and
 * it must not be `disabled` (reactivate first). Every other field follows the same rule: a
 * VALID picked value wins, else the install's own, so a re-theme never silently flips the
 * footprint, the register or the mode, and a bogus body value cannot reach the argv.
 *
 * `{cmd: [...]}` IS A RETURN TYPE, NOT A RESPONSE — see this file's header for why that
 * matters and what the argv head is.
 */
export function apiInstallCmd(state, body) {
  const known = new Map();
  for (const [host, scope, root] of installTargets()) {
    known.set(JSON.stringify([host, String(root)]), [host, scope, root]);
  }
  const hit = known.get(JSON.stringify(
    [strOr(bget(body, 'host')), strOr(bget(body, 'path'))],
  ));
  if (hit === undefined) throw new NotFound('unknown install (host, path)');
  const [host, scope, root] = hit;
  if (installState(root, host, scope) === 'disabled') {
    return { error: 'install is disabled — reactivate it before (re)building' };
  }
  const emit = EMIT_FOR.get(`${host} ${scope}`);
  if (emit === undefined) return { error: `no install mode for ${host}:${scope}` };
  const themes = new Set(themeChoices().map((c) => c.name));
  const bt = bget(body, 'theme');
  const theme = themes.has(bt) ? bt : state.theme;
  const bfp = bget(body, 'footprint');
  const fp = (bfp === 'lean' || bfp === 'full') ? bfp : footprintOfDir(root);
  const bpos = bget(body, 'posture');
  const pos = discoverNames('postures', 'peer').includes(bpos)
    ? bpos : (postureOfDir(root) || 'peer');
  const bmode = bget(body, 'mode');
  const mode = discoverNames('modes', 'direct').includes(bmode)
    ? bmode : (modeOfDir(root) || 'direct');
  // Unspecified means "keep what this install already has", exactly as theme, footprint,
  // posture and mode above do — a rebuild through the console is not a place to silently
  // re-decide the constitution. ⚠ AND A CARRIER WITH NO `Active packs:` MARKER (a pre-2.3
  // install) MUST NOT LAND ON `harness.config.json`: `doctrinesOfDir` answers `null` there,
  // `null` elided the flag, and the generator's config fallback then narrowed the install and
  // took its consent gate with it. `doctrinesForBuild` resolves unknown to ALL packs.
  const doctrines = bodyDoctrines(body) ?? doctrinesForBuild(root);
  // The per-rule axis needs NO `doctrinesForBuild`-style rescue: the marker it reads is only
  // written when something is excluded, so its absence is a statement ("nothing") rather than
  // the silence a pre-2.3 carrier gives on packs. Unspecified therefore keeps the install's
  // own answer, and a pre-marker install answers the empty list — which is what it has.
  const excludeRules = bodyExcludeRules(body) ?? excludedRulesOfDir(root);
  const out = scope === 'global' ? null : String(root);
  const argv = setupBuildArgs(theme || 'neutral', emit, out, out, fp, pos, mode, doctrines,
    PACK_ORDER, excludeRules);
  return { cmd: [process.execPath, path.join(ROOT, 'bin', 'build-driver.mjs'), ...argv] };
}

/**
 * Deactivate, reactivate, or REMOVE one install.
 *
 * KEYED ON THE (host, path) PAIR, and the pair must be one of the DETECTED installs. A cwd can
 * carry both an OpenCode and a Claude install at the same path, so a path alone is ambiguous;
 * and this endpoint moves and deletes whole trees, so the root is never built from raw body
 * input. An unknown pair is a `NotFound`, which the shell answers 404.
 *
 * THE ENGINE IS `js/maintain/uninstall.mjs`'s: `installDeactivate` / `installReactivate` are
 * the reversible siblings of `installUninstall` — the same owned-file walk and ancestor prune
 * with `move` where the reversal has `unlink` — which is why they live beside it rather than
 * in the web tree.
 */
export function apiInstallToggle(state, body) {
  const known = new Map();
  for (const [host, scope, root] of installTargets()) {
    known.set(JSON.stringify([host, String(root)]), [host, scope, root]);
  }
  const hit = known.get(JSON.stringify(
    [strOr(bget(body, 'host')), strOr(bget(body, 'path'))],
  ));
  if (hit === undefined) throw new NotFound('unknown install (host, path)');
  const [host, scope, root] = hit;
  const action = bget(body, 'action');
  let res;
  if (action === 'deactivate') {
    res = installDeactivate(root, host, scope);
  } else if (action === 'activate') {
    res = installReactivate(root, host, scope);
  } else if (action === 'remove') {
    // Destructive. `memory` ∈ {keep, archive, delete} governs the memory/notebook stores and
    // is validated IN THE ENGINE — an unknown value falls back to `keep`, never a surprise
    // delete, which is why a bogus body value is passed through rather than rejected here.
    const mem = bget(body, 'memory');
    res = installUninstall(root, host, scope, isTruthy(mem) ? mem : 'keep');
  } else {
    // `formatRepr`, not `JSON.stringify` — SINGLE-quoted, consistent with every other error
    // message in this file that echoes an unrecognised value.
    res = { ok: false, error: `unknown action ${formatRepr(action)}` };
  }
  state.refresh();
  return res;
}

/**
 * The build command that deploys a FRESH per-repo harness into an arbitrary folder the user
 * chose.
 *
 * The open-ended sibling of `apiInstallCmd`, which only rebuilds a pre-detected target from
 * a tight allowlist. Scope is always `project`: a global lands in the host's config dir,
 * never a chosen folder. THIS ENDPOINT TAKES A RAW PATH, so it is the trust boundary — the
 * path is validated here as an existing, writable directory that is not a host's own global
 * config dir (deploying a `project` emit there would mislabel as the global row and collide
 * on dedup).
 */
export function apiDeployCmd(state, body) {
  const host = stripWhitespace(strOr(bget(body, 'host')));
  if (!HOSTS.some((h) => h.host === host)) {
    return { error: `unknown host: ${host || '(none)'}` };
  }
  const raw = stripWhitespace(strOr(bget(body, 'path')));
  if (!raw) return { error: 'no folder given' };
  let root;
  try {
    root = resolvePath(expanduser(raw));
  } catch {
    return { error: `bad path: ${raw}` };
  }
  if (!isDir(root)) return { error: `not a folder: ${root}` };
  try {
    accessSync(root, constants.W_OK);
  } catch {
    return { error: `folder not writable: ${root}` };
  }
  const cfgdirs = new Set();
  for (const fn of [opencodeConfigDir, claudeConfigDir, bobConfigDir, copilotConfigDir]) {
    try {
      cfgdirs.add(resolvePath(fn()));
    } catch { /* not every host has a resolvable config dir; skip it */ }
  }
  if (cfgdirs.has(root)) {
    return { error: "that's a host global config dir — use its existing row to build a global install" };
  }
  const themes = new Set(themeChoices().map((c) => c.name));
  const bt = bget(body, 'theme');
  const theme = themes.has(bt) ? bt : state.theme;
  const bfp = bget(body, 'footprint');
  const fp = (bfp === 'lean' || bfp === 'full') ? bfp : 'full';   // a fresh deploy is full
  const bpos = bget(body, 'posture');
  const pos = discoverNames('postures', 'peer').includes(bpos) ? bpos : 'peer';
  const bmode = bget(body, 'mode');
  const mode = discoverNames('modes', 'direct').includes(bmode) ? bmode : 'direct';
  // Same resolution as `apiInstallCmd` above, and for the same reason: the console's Deploy
  // form sends host/path/theme/footprint/posture/mode and NO pack selection, and nothing stops
  // it landing on a directory that already holds an install. Taking `bodyDoctrines` alone left
  // the flag off, the generator fell back to `harness.config.json`, and deploying onto an
  // existing all-four Claude install dropped it to one pack — measured: 6 hook groups became 5
  // and `PreToolUse::Bash` went with them. `doctrinesForBuild` resolves unknown to ALL packs.
  const doctrines = bodyDoctrines(body) ?? doctrinesForBuild(root);
  const excludeRules = bodyExcludeRules(body) ?? excludedRulesOfDir(root);
  // project-scope emit name == host name (opencode / claude / bob / copilot)
  const argv = setupBuildArgs(theme || 'neutral', host, root, root, fp, pos, mode, doctrines,
    PACK_ORDER, excludeRules);
  return { cmd: [process.execPath, path.join(ROOT, 'bin', 'build-driver.mjs'), ...argv] };
}
