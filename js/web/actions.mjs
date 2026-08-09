/**
 * The web console's WRITES — `rituals/_web_actions.py`'s mutating endpoints plus the two
 * GETs that had to cross with them.
 *
 * WHAT THE PLAN'S TABLE GOT WRONG, measured by reading `js/` rather than by trusting it.
 * Three of its five "already ported" claims were false and one endpoint was out by an order
 * of magnitude:
 *
 *   * `_memory_drop_index` — "check whether P5's `learn` ported it". It did not; nothing in
 *     `js/` referenced it. It lands in `js/hooks.mjs`, beside the other memory-store
 *     primitives, because that is where its Python siblings' twins already live.
 *   * `_mcp_load` — "already in js/ (P6c)". What crossed in P6c is `readJsonc` and a
 *     five-line no-host reader inside `js/web/api.mjs` for `wiki.jsonc`. The host fork and
 *     the other twelve MCP functions are 168 lines of new `js/mcp.mjs`.
 *   * `settings.mjs`'s atomic write — a DIFFERENT Python function from `_mcp_save`, with a
 *     different temp suffix and no parent-directory creation. See `js/mcp.mjs`.
 *   * `api_install_toggle` — "~25 new; `_move_tree`, `_prune_empty_ancestors` and the stash
 *     ARE in `js/uninstall.mjs` (P5h)". `DISABLED_STASH`, `installKind` and `installState`
 *     are. `_move_tree`, `_prune_empty_ancestors`, `_install_move_list`, `_install_relive`,
 *     `_install_readd_entry`, `_install_deactivate`, `_install_reactivate`,
 *     `_claude_deactivate` and `_claude_reactivate` are not — 293 lines of unported
 *     move-and-roll-back engine, scored at zero. It is deferred; see below.
 *
 * ---------------------------------------------------------------------------------------
 * THE ARGV-IN-A-RESPONSE-BODY TRAP, SETTLED — AND ITS PREMISE IS FALSE.
 *
 * The plan says `api_install_cmd` and `api_deploy_cmd` "return `[sys.executable,
 * str(ROOT/"build.py"), …]` — a Python argv, as DATA, in a response body", and offers two
 * options: (a) the Node twin returns its own argv head and the harness normalises it, or
 * (b) the endpoint returns the ACTION and its arguments and the job runner resolves the
 * command — "the better design", at the cost of changing the reference and rebuilding the
 * tracked `web/dist`.
 *
 * MEASURED FIRST, as the phase's own rule says. Two measurements decide it:
 *
 *   1. `grep` over `web/src/` finds NO consumer of either response. The React client's only
 *      calls into that area are `pickFolder`; nothing reads a `cmd` field.
 *   2. `rituals/_web_server.py` explains why. `_post_routes` calls `api_install_cmd`, and
 *      the ONLY thing it does with the result is `if "error" in plan: send_json(plan, 409)`
 *      / `jm.start("install", plan["cmd"], …)`. The argv is handed to the job runner in the
 *      SAME PROCESS. `{"cmd": [...]}` never reaches the wire; the client sees a `job_id` at
 *      202 or an `error`.
 *
 * So there is no argv in a response body. `{"cmd": [...]}` is a function's return TYPE, not
 * an endpoint's response, and the byte gate was never going to see it. That collapses the
 * choice:
 *
 *   * Option (b) buys nothing. Its whole value was making two implementations return the
 *     same wire bytes; they already do, because neither returns these bytes at all. The
 *     resolver and the runner are already in one process, so "let the runner resolve it" is
 *     a rename. It would change the reference and force a `web/dist` rebuild for zero
 *     observable difference — the definition of work this port refuses.
 *   * Option (a) is what remains, minus the harness change: the Node twin returns
 *     `[process.execPath, bin/geneseed-cli.mjs, …]`, which is the honest command for the
 *     runtime it will run on, and naming `python build.py` there would put Python back into
 *     a "no Python needed" install for the one operation the console exists to run.
 *
 * `web/dist` therefore does NOT need rebuilding, and it was not rebuilt.
 *
 * WHAT GATES IT, since no cell can. The value never reaches a response, so
 * `tests/web_golden.py` is structurally blind to it — which is exactly the shape a corpus
 * answers and a cell cannot (the phase rule: a cell runs the PROGRAM, a corpus runs the
 * FUNCTION). The gate is a unit test that calls BOTH implementations and asserts three
 * things: the reference's argv head is its own interpreter and `build.py`, absolutely; the
 * twin's head is `process.execPath` and `bin/geneseed-cli.mjs`, absolutely; and the TAIL —
 * every argument after the head, which is where a real port bug would live — is identical.
 * That is the absolute-assertion-per-side discipline a tolerant comparison owes, applied to
 * a value the byte gate cannot reach.
 *
 * THE CODE IS P6g's, THE DECISION IS THIS PHASE's. `api_install_cmd`, `api_deploy_cmd` and
 * `api_restore` all sit behind `/api/actions/<x>`, which needs the `JobManager` to route at
 * all — so porting them here would produce three functions with no call site, no cell and
 * no route, which is the "declaration that is not a dispatch" this project keeps being
 * bitten by. P6g wires the prefix and brings them across with the gate described above.
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
 * `api_install_toggle` IS DEFERRED, with its measurement.
 *
 * The endpoint is 27 lines over three engine calls. One of the three (`_install_uninstall`)
 * crossed in P5h. The other two pull in 293 lines of all-or-nothing tree moves with
 * rollback, a stash layout, an `instructions`-entry unmerge, a re-emit-while-disabled guard
 * and a host fork into `_claude_deactivate`/`_claude_reactivate`. None of it is web code and
 * none of it has a `harness` VERB — which is why P5 never reached it — and its gate is a
 * file-move fixture of the kind `harness_golden` is built for, not a request script. Porting
 * it inside a web phase would put the largest unported engine block behind the weakest
 * available gate. `/api/install` stays in `NOT_PORTED_POST`.
 */
import { statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { excludeAdd, excludeRemove } from '../excludes.mjs';
import { frontmatter, memoryDropIndex } from '../hooks.mjs';
import { installState, installTargets, readMaybe } from '../installs.mjs';
import {
  MCP_PRESETS, isDict, mcpApply, mcpCommented, mcpInstallTargets, mcpKnownNames, mcpLoad,
  mcpMeta, mcpPresetBlock, mcpSave, mcpSetEnabled, mcpState,
} from '../mcp.mjs';
import {
  PY_SPACE, parseJson, pyLen, pyRepr, pyStr, pyStripSpace, pyTruthy, readText, writeText,
} from '../lib/pyfs.mjs';
import { pySplitLines } from '../lib/pydiff.mjs';
import { NotFound, fingerprint, viewCfg } from './api.mjs';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** `dict.get(key, default)` over a `json.loads` result. */
const bget = (body, key, dflt = null) => (isDict(body) && Object.hasOwn(body, key)
  ? body[key] : dflt);

/** `str(x or "")` — Python's truthiness, then Python's `str`. */
const strOr = (v) => (pyTruthy(v) ? pyStr(v) : '');

/** `str.split()` with no argument — runs of PYTHON whitespace, no empties. */
const pyWords = (s) => s.split(new RegExp(`[${PY_SPACE}]+`)).filter(Boolean);

/** `datetime.date.today().isoformat()` — LOCAL, as the reference's naive `date.today()` is. */
export function todayIso(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * `today` and `today + timedelta(days=n)` from ONE sample of the clock.
 *
 * The reference binds `today = datetime.date.today()` once and derives both dates from it.
 * Two `new Date()` calls would put the provenance line and the expiry on either side of a
 * midnight that fell between them — a one-run-in-86400 disagreement, which is the worst kind
 * to debug.
 */
function promoteDates(days) {
  const d = new Date();
  const today = todayIso(d);
  d.setDate(d.getDate() + days);
  return [today, todayIso(d)];
}

/**
 * `body.get(k, "") != <a str>` — Python's `!=`, where a non-string NEVER equals a string.
 *
 * `str(...)` would be wrong here and measurably so: the reference compares the RAW body
 * value, so a client sending `"fingerprint": 0` against an ABSENT file (whose fingerprint is
 * `""`) gets a conflict there, where a coerced comparison would find `"" == ""` and write.
 */
const fpMatches = (got, want) => typeof got === 'string' && got === want;

// ---- user rules (user-rules.md) ----------------------------------------------------------

/** `build.RULES_FILE`. */
export const RULES_FILE = 'user-rules.md';
const rulesPath = (state) => path.join(state.target, RULES_FILE);

/**
 * `_web_catalog.RULE_HEAD_RE` — `## R<n> — Title`, anchored at column 0 so a rule body's
 * fenced code and the stub's indented format example never parse as rules.
 *
 * The whitespace classes are `PY_SPACE`, not `\s`: P6d measured the two apart and this
 * pattern runs over a HAND-EDITED file, which is where a non-breaking space actually turns
 * up. `\S` is its complement for the same reason.
 *
 * `\d` IS LEFT ASCII, and that is a declared divergence rather than an oversight. Python's
 * `\d` on a `str` pattern is `\p{Nd}`, so `## R١ — …` parses there and not here. Matching it
 * would only move the problem one line down: the reference then calls `int()` on the captured
 * text, and `int()` accepts every Unicode decimal digit where `Number()` accepts none — so
 * closing the gap needs `int`'s digit table, for a heading no theme seeds, no build writes
 * and the web editor cannot produce (it writes `R<n>` itself from `max(ids) + 1`).
 */
export const RULE_HEAD_RE = new RegExp(
  `^##[${PY_SPACE}]+R(\\d+)[${PY_SPACE}]*[—–-]+[${PY_SPACE}]*`
  + `([^${PY_SPACE}].*?)[${PY_SPACE}]*$`,
);

/** `_web_catalog.RULES_BUDGET` — advisory; nothing blocks past it. */
export const RULES_BUDGET = { max_rules: 15, max_tokens: 1500 };

const META_RE = new RegExp(`^\\((.+)\\)[${PY_SPACE}]*$`);

/** `_web_catalog._parse_rule_meta` — `{}` when the line is body rather than metadata. */
function parseRuleMeta(line) {
  const m = META_RE.exec(pyStripSpace(line));
  if (!m) return {};
  const meta = {};
  for (const part of m[1].split('|')) {
    const at = part.indexOf(':');
    if (at < 0) continue;               // `partition` with no separator — not a pair
    const key = pyStripSpace(part.slice(0, at)).toLowerCase().replaceAll(' ', '_');
    if (['scope', 'source', 'trial_until'].includes(key)) {
      meta[key] = pyStripSpace(part.slice(at + 1));
    }
  }
  return meta;
}

/**
 * `_web_catalog.parse_rules` — user-rules.md to `[rules, warnings]`.
 *
 * Every rule carries its `start`/`end` LINE INDICES, which is what lets `apiRulesMutate`
 * splice exactly one block and leave every other byte of the user's file — prose,
 * formatting, hand-written sections — untouched.
 */
export function parseRules(text) {
  const lines = pySplitLines(text);
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
    while (k < end && !pyStripSpace(lines[k])) k += 1;
    const meta = k < end ? parseRuleMeta(lines[k]) : {};
    if (Object.keys(meta).length) k += 1;
    rules.push({
      id: rid,
      title: m[2],
      scope: Object.hasOwn(meta, 'scope') ? meta.scope : 'project',
      source: Object.hasOwn(meta, 'source') ? meta.source : '',
      trial_until: Object.hasOwn(meta, 'trial_until') ? meta.trial_until : '',
      body: pyStripSpace(lines.slice(k, end).join('\n')),
      start: idx,
      end,
    });
  }
  return [rules, warnings];
}

/** `_web_catalog.api_rules` — the Rules page payload. */
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
    // `len(text) // 4` — CODE POINTS. `String.length` counts UTF-16 units, so an emoji in a
    // rule body would put the two token estimates two apart.
    stats: { rules: rules.length, lines: pySplitLines(text).length,
      tokens: Math.floor(pyLen(text) / 4), ...RULES_BUDGET } };
}

/** `_web_actions._rules_read`. */
function rulesRead(state) {
  const p = rulesPath(state);
  return [p, isFile(p) ? (readMaybe(p) ?? '') : ''];
}

/** `_web_actions._rule_block`. */
function ruleBlock(rid, title, scope, source, trialUntil, body) {
  const meta = [`scope: ${scope}`];
  if (source) meta.push(`source: ${source}`);
  if (trialUntil) meta.push(`trial until: ${trialUntil}`);
  return `## R${rid} — ${title}\n(${meta.join(' | ')})\n${pyStripSpace(body)}\n`;
}

/**
 * `_web_actions._rule_fields` — validate and normalise a rule's writable fields.
 *
 * Throws (→ the shell's JSON 500 carrying the message) on an unusable rule. `\p{Nd}` here and
 * not `\d`, unlike `RULE_HEAD_RE`: this one is a pure predicate over a string that is stored
 * as a string, so matching Python's Unicode-aware `\d` exactly costs nothing and needs no
 * `int()`.
 */
function ruleFields(body) {
  const title = pyWords(strOr(bget(body, 'title'))).join(' ');
  const text = pyStripSpace(strOr(bget(body, 'body')));
  if (!title) throw new Error('a rule needs a title');
  if (!text) throw new Error('a rule needs body text');
  let scope = bget(body, 'scope');
  if (scope !== 'user' && scope !== 'project') scope = 'project';
  const source = pyWords(strOr(bget(body, 'source'))).join(' ');
  const trial = pyStripSpace(strOr(bget(body, 'trial_until')));
  if (trial && !/^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}$/u.test(trial)) {
    throw new Error('trial until must be YYYY-MM-DD');
  }
  return [title, text, scope, source, trial];
}

/**
 * `int(body.get("id"))`, with both of its failures folded into `NotFound("rule id")`.
 *
 * Python's `int()` takes an int, a bool (which IS an int there), a float (truncating) and a
 * decimal string with surrounding whitespace; everything else is a TypeError or ValueError,
 * and the reference catches both.
 */
function ruleId(v) {
  if (typeof v === 'string') {
    const s = pyStripSpace(v);
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
 * `_web_actions.api_rules_mutate` — add / update / delete on user-rules.md.
 *
 * EVERY MUTATION REQUIRES THE FINGERPRINT OF THE CONTENT THE CLIENT LAST READ. An agent
 * session may be editing the same file mid-flight, so a stale write returns `ok: false`
 * (which the shell maps to 409) and the client re-fetches — it never clobbers. The fresh
 * fingerprint comes back in the response so a client can chain edits without a re-fetch.
 */
export function apiRulesMutate(state, body) {
  const op = bget(body, 'op');
  if (op !== 'add' && op !== 'update' && op !== 'delete') {
    throw new NotFound(`rules op ${pyRepr(op)}`);
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
    const lines = pySplitLines(text);
    if (op === 'update') {
      const [title, rtext, scope, source, trial] = ruleFields(body);
      const block = ruleBlock(rid, title, scope, source, trial, rtext);
      lines.splice(target.start, target.end - target.start,
        ...pySplitLines(block.replace(/\n+$/, '')));
    } else {
      // delete — also swallow ONE preceding blank separator line, or repeated deletes leave
      // a growing run of blank lines in the user's file.
      let start = target.start;
      if (start > 0 && !pyStripSpace(lines[start - 1])) start -= 1;
      lines.splice(start, target.end - start);
    }
    next = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  }
  writeText(p, next);
  return { ok: true, op, id: rid, fingerprint: fingerprint(next) };
}

/**
 * `_web_actions.api_rules_promote` — one memory fact into a trial rule.
 *
 * The provenance line and the month of probation are the rule this endpoint owns, and both
 * are DATES read from the clock. `tests/web_golden.py` gates them from its own shared
 * per-cell clock rather than destamping them — a destamp would erase exactly the thing.
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
    title: pyTruthy(bget(body, 'title')) ? bget(body, 'title') : fmName,
    body: pyTruthy(bget(body, 'body')) ? bget(body, 'body')
      : (pyStripSpace(memBody) || fmDesc),
    scope: bget(body, 'scope'),
    source: `memory ${name}, promoted ${today}`,
    trial_until: trial,
  });
  if (pyTruthy(res.ok) && pyTruthy(bget(body, 'delete_memory'))) {
    apiMemoryDelete(state, name);
    res.deleted_memory = name;
  }
  return res;
}

// ---- PROFILE.md --------------------------------------------------------------------------

/** `_web_actions.api_profile_save` — the whole file, fingerprint-guarded like the rules. */
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

/** `_web_catalog._memory_dir` — always `<target>/memory`, never the CWD-scanning resolver. */
const memoryDir = (state) => path.join(state.target, 'memory');

/**
 * `_web_actions.api_memory_delete` — one fact file, and its line in the MEMORY.md index.
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
 * `_web_actions.api_excludes_mutate` — this endpoint owns no exclusion logic of its own; it
 * validates the body and hands off to the same engine `harness exclude add|remove` calls.
 *
 * A malformed body is rejected with `ok: false` (→ 409) rather than reaching `excludeAdd`,
 * which assumes a real path string. That arm is also where a body that never parsed lands:
 * `readJsonBody` hands the endpoint `{}`, and `{}` has no action.
 */
export function apiExcludesMutate(state, body) {
  const action = bget(body, 'action');
  const p = pyStripSpace(strOr(bget(body, 'path')));
  if ((action !== 'add' && action !== 'remove') || !p) {
    return { ok: false, path: p,
      messages: ['body must be {action: add|remove, path: <folder>}'] };
  }
  return action === 'add' ? excludeAdd(p) : excludeRemove(p);
}

// ---- MCP ----------------------------------------------------------------------------------

/** `_web_actions.api_mcp` — MCP servers per ACTIVE install, host-aware. */
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
 * `_web_actions.api_mcp_toggle` — enable / disable / first-add one server.
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
  const want = pyTruthy(bget(body, 'enabled'));
  const pathArg = strOr(bget(body, 'path'));
  const known = new Map();
  for (const [, cfgPath, host] of mcpInstallTargets()) {
    known.set(String(cfgPath), [cfgPath, host]);
  }
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
 * `_web_actions.api_select_view` — re-point the whole console at a detected install.
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
