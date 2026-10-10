/**
 * `_build_settings.py` in Node — the host-config WIRING layer.
 *
 * This is the half of the emit that edits files the USER co-owns: the JSONC reader, the
 * `opencode.json` / `settings.json` merges, the managed-block machinery and the integrity
 * check — and it is the unit the RUNTIME drives as well as the emit. Every emit and every
 * lifecycle verb goes through this module: `js/build/emit-opencode.mjs` and
 * `js/build/emit-claude.mjs` wire the host config, `js/maintain/uninstall.mjs` drives the
 * unwire, `js/hosts/mcp.mjs` and `js/maintain/migrate.mjs` read through `loadJsonObject`, and
 * `js/web/api.mjs` borrows the same readers for the console. The hook SHIM the merged hooks
 * call lives in `./shim.mjs`, split out so the CLI's every-run dead-shim check need not load
 * this module.
 *
 * THE STDOUT RULE BINDS HARDEST HERE. The hooks this module writes signal their verdict as
 * a JSON object on stdout and return 0 on EVERY path (`|| exit 0`, or `; exit 0` in the
 * PowerShell form, is not what it looks like — see the shim comment below), so a stray byte
 * printed on a hook path does not make noise, it silently disables a gate. Everything printed here is a generator-time message;
 * the split between them is asserted absolutely by `tests/unit/settings_jsonc.test.mjs` and
 * `tests/unit/settings_integrity.test.mjs`. The asymmetry (`_warn_commented_jsonc` prints to
 * STDOUT, every other message to stderr) is inherited from `_build_settings.py` and kept
 * deliberately rather than tidied.
 *
 * HOOKS ARE APPEND-ONLY AND FAIL-CLOSED. Nothing here rewrites a hook group in place:
 * `mergeClaudeSettings` appends what is missing and removes only groups the manifest
 * recorded, and cleanup goes through `GENESEED_HOOK_SNIFF`, which has to keep recognising
 * BOTH the legacy interpreter+checkout form and the shim form. Dropping either spelling
 * strands live hooks in every config emitted before the change.
 *
 * ONE KNOWN DIVERGENCE, recorded rather than reproduced. JS objects order integer-like
 * keys first, so a settings.json carrying a `"1"` or `"2"` at any level comes back from
 * `JSON.parse` reordered and this module writes it back reordered — Python preserves the
 * file's order. Measured (`{"b":1,"2":2,"a":3}` → `{"2":2,"b":1,"a":3}`); no key any
 * writer here produces is numeric, and no data is lost, but a user's own numeric key moves.
 * Fixing it means parsing into a Map and threading that through every accessor, which is a
 * much larger change than the defect.
 */
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { readText, writeText, isOsError } from '../lib/fs.mjs';
import {
  jsonDumps, jsonDumpsCompact, jsonDumpsIndent, parseJson, deepEquals, formatRepr,
  indexOfDeepEqual, get, has, isDict,
} from '../lib/json.mjs';
import { SHIM_MARK, claudeHookShell, hookPrefix } from './shim.mjs';
import { stripWhitespace, stripWhitespaceEnd } from '../lib/text.mjs';

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';

/**
 * Is the `process` doctrine pack active for the install being emitted?
 *
 * ⚠ FAIL CLOSED, and the shape of the test is the whole point. Anything that is not an
 * explicit array — `null`, `undefined`, a caller that never learned about packs — means
 * "unknown", and unknown keeps the consent gate wired. `doctrinesOfDir` returns exactly that
 * `null` for a pre-migration install, and `d?.includes('process')` would read it as "off" and
 * silently unwire the gate from every carrier on disk. An empty array is NOT unknown: it is a
 * deliberate `--doctrines none`, and it turns the gate off.
 */
const processPackOn = (d) => !Array.isArray(d) || d.includes('process');

/**
 * The address of the rule the git gate IS. Not a pack any more — a rule.
 *
 * ⚠ THE GATE MOVED FROM THE PACK TO THE RULE, and the reason is that the pack stopped being
 * the unit a user toggles. With per-rule exclusion an install can keep every other `process`
 * rule and drop this one; keying the boundary on `d.includes('process')` would then leave the
 * hook wired for a rule the carrier no longer states — prompt and boundary disagreeing, which
 * is the single thing this design forbids in either direction.
 *
 * `excluded` defaults to `[]` for the same fail-closed reason `excludedRulesOfDir` does: a
 * caller that has not learned about the second axis excludes nothing, so the gate stays. Every
 * pre-existing call site keeps its exact behaviour without being touched.
 */
const CONSENT_RULE = 'process.5';
const consentRuleOn = (d, excluded = []) =>
  processPackOn(d) && !(Array.isArray(excluded) && excluded.includes(CONSENT_RULE));

/**
 * `_build_settings._default_permission`.
 *
 * WHAT THE PACK TOGGLE REACHES AND WHAT IT MUST NOT. `git commit*` and `git push*` are the
 * BOUNDARY HALF of doctrine process 5 (consent before recording or sharing); with the process
 * pack off, that rule is no longer binding — its text is not rendered into the carrier's
 * doctrine section — and a boundary that keeps asking for a rule the install did not adopt is
 * the one disagreement the tiering is not allowed to produce. (It does NOT follow that the
 * string is gone from the bundle; see `claudeHookGroups` for what D5 ships anyway and why.)
 * `rm -rf *`, the force pushes and the history-discarding git verbs (`reset --hard`,
 * `clean -f`, `branch -D`, `checkout --`) stay in EVERY build: they are Law IV's territory —
 * an always-on invariant — not the process pack's. They mirror `DESTRUCTIVE_GIT_RE` in
 * js/hosts/hooks.mjs, so Claude's git-gate and OpenCode's permission ask about the same acts;
 * before, OpenCode only logged the last four. A glob is not a regex, so the mirror is the
 * closest glob for each act rather than an exact copy: the `* ` forms catch a flag that comes
 * after other words (`push origin -f`, `reset -q --hard`, `clean -d -f`) and `git push *+*`
 * a `+refspec` force push. The regex stays the stricter reader — it also sees a flag cluster
 * with `f` not first (`clean -d -xf`), which a glob cannot say without matching `--exclude=f`.
 *
 * B5's (claude-code.md / claude-verdict.md) long/modern spellings, added here appended (never
 * reorder: OpenCode's permission engine evaluates key order with `findLast`, so moving an
 * existing key can change which VALUE wins on a file that already disagrees with one — adding
 * only is always safe, since every key here maps to the same `'ask'`). `clean --force`, the
 * long flag; `branch --delete --force`, the long form of `-D` (both orders, since a glob has
 * no "either order" — an un-forced `--delete` already refuses on an unmerged branch exactly
 * like `-d`, so it is deliberately NOT a key here; `-D --force`/`--delete -f`/`-d --force`/
 * `-df` are the same act again and are a known ceiling this does not chase); `checkout
 * -f`/`--force` and `switch -f`/`--force`/`--discard-changes` (git's own `switch -h` lists
 * `-f, --force` and `--discard-changes` as two separate options); `worktree remove -f`/`--force` (both
 * flag-then-path and path-then-flag order); `reflog expire`; `gc --prune` (matched bare, since
 * a `--prune` with no `=now` still eventually prunes); and `push *--delete*` / `push * :*` (a
 * literal space before the colon, so `push origin HEAD:main`, an ordinary refspec, does not
 * match).
 *
 * `git restore` is DELIBERATELY NOT HERE. Its rule is "ask unless `--staged` appears ALONE" —
 * `--staged --worktree` together still discards the working tree — and a glob has no negation,
 * so the closest glob (`git restore*`) would ask on the harmless `--staged`-alone case too. The
 * regex (`DESTRUCTIVE_GIT_RE`) gets that exactly right; `stash drop`/`clear` have the SAME
 * `restore` anchoring concern in the regex (a bare word / ordinary English, matched there only
 * in verb position) but no false-positive risk as a glob, since OpenCode matches a glob against
 * the FULL sub-command text (`opencode-verdict.md` CR-6) — `git stash drop*` cannot match a
 * DIFFERENT sub-command like `git stash push -m "clear old state"`, so they ARE glob keys here.
 * Guard-only acts (currently just `restore`) still warn via the OpenCode guard plugin's
 * `SHELL_WARN_RE` — see `adapters/opencode/plugins/geneseed-guard.js`.
 */
const LAW_IV_BASH = ['git push --force*', 'git push -f*', 'git push *--force*', 'git push * -f*',
  'git push *+*', 'git reset --hard*', 'git reset * --hard*', 'git clean -f*', 'git clean * -f*',
  'git branch -D*', 'git checkout -- *',
  'git clean --force*', 'git clean * --force*',
  'git branch *--delete*--force*', 'git branch *--force*--delete*',
  'git checkout -f*', 'git checkout * -f*', 'git checkout --force*', 'git checkout * --force*',
  'git switch -f*', 'git switch * -f*', 'git switch --force*', 'git switch * --force*',
  'git switch --discard-changes*', 'git switch * --discard-changes*',
  'git worktree remove -f*', 'git worktree remove --force*',
  'git worktree remove * -f*', 'git worktree remove * --force*',
  'git reflog expire*', 'git gc --prune*', 'git gc * --prune*',
  'git stash drop*', 'git stash clear*',
  'git push *--delete*', 'git push * :*'];

/**
 * User decision (2026-10-10): a loop runs on its own `loop/*` branch, never `main`/`master`, so
 * pushing it is fine — only the COMMIT still asks. OpenCode has no dynamic equivalent of
 * `js/hosts/hooks.mjs`'s `loopExempt` (Task 6: its `permission.ask` plugin hook is declared but
 * never called), so this is a STATIC allow for the exact refspec shapes the loop engine itself
 * pushes — `pushSegmentOk`'s `[-u|--set-upstream] <remote> HEAD:<branch>` and
 * `HEAD:refs/heads/<branch>` forms, with `<branch>` fixed to `loop/*` here since a static glob
 * cannot read the checked-out branch the way the Node hook does. `git push * HEAD:loop/*` eats
 * `-u origin`/`--set-upstream origin`/any remote through its leading `*`; the second key covers
 * the `refs/heads/` spelling the same way.
 *
 * ORDER IS LOAD-BEARING. `defaultPermission` appends these AFTER `git push*`'s ask (so a loop
 * push is not swallowed by the blanket consent ask) and BEFORE `LAW_IV_BASH` (so `findLast`
 * — OpenCode's own `permission.bash` evaluator — lets a force push, a `+refspec`, or a
 * `--delete`/bare-`:` push still ask even when the target is `loop/*`; those LAW_IV_BASH keys
 * match the same command and come later, so they win). Never move this block to before
 * `git push*` or after `LAW_IV_BASH` — either moves the `findLast` boundary the ordering above
 * depends on.
 */
const LOOP_PUSH_ALLOW = ['git push * HEAD:loop/*', 'git push * HEAD:refs/heads/loop/*'];

function defaultPermission(doctrines = null, excluded = []) {
  const bash = { 'rm -rf *': 'ask' };
  if (consentRuleOn(doctrines, excluded)) {
    bash['git commit*'] = 'ask';
    bash['git push*'] = 'ask';
  }
  for (const k of LOOP_PUSH_ALLOW) bash[k] = 'allow';
  for (const k of LAW_IV_BASH) bash[k] = 'ask';
  return { bash };
}

/**
 * Every `permission.bash` key Geneseed has ever written — the OWNED set, which is not the same
 * as the set `defaultPermission` returns for a given selection. The two process-pack keys are
 * in it whether or not this build wants them, because reconciling an EXISTING opencode.json
 * has to be able to recognise a key that is Geneseed's business at all — to add it back when
 * the pack returns, and to name it when this build no longer wants it but will not remove it.
 */
const OWNED_BASH = ['rm -rf *', 'git commit*', 'git push*', ...LOOP_PUSH_ALLOW, ...LAW_IV_BASH];

/**
 * Bring an ALREADY-WRITTEN `permission` block back into line with the pack selection, and
 * touch nothing else. Returns `[changed, stranded]` — whether anything moved, and the owned
 * keys this build does NOT want but refuses to take away.
 *
 * ⚠ THIS IS THE FIX FOR A BOUNDARY FROZEN AT FIRST WRITE. `mergeOpencodeJson` used to add the
 * whole block only when the key was absent, so on a file that already had one the git gate was
 * whatever the FIRST emit happened to write, forever — and the direction that matters is
 * turning the process pack back ON, which left the gate ABSENT while AGENT.md stated the rule.
 * That direction is pure ADDITION and it is fixed here. Claude's side never had the hole;
 * `mergeClaudeSettings` prunes and re-adds its managed groups on every emit, because that file
 * has a MANAGED BLOCK and this one does not.
 *
 * ⚠ REMOVAL IS GUARDED BY OWNERSHIP, NOT BY VALUE — and this is the second thing the first cut
 * got wrong. `opencode.json` is USER CO-OWNED: the WIRE stage reconciles it, it does not own
 * it. Geneseed may take back an entry it wrote; it may never take back one the user wrote.
 * Dropping every unwanted key that still read `'ask'` treated the VALUE as the ownership
 * record, so a user who had typed their own `"git commit*": "ask"` — a perfectly ordinary
 * thing to want, and the value Geneseed writes precisely because it is the obvious one — had
 * it DELETED by a pack-off build.
 *
 * NOTHING ON DISK RECORDS PROVENANCE, and none of the candidates survived contact: the value
 * is what a user would write too; the carrier's `Active packs:` marker is rewritten by this
 * same emit BEFORE `mergeOpencodeJson` runs (`emitOpencodeGlobalRender` writes AGENT.md at the
 * top and wires the config at the bottom), so it answers with the NEW selection and would
 * licence every removal; and a per-install ownership record would be a new marker file joining
 * the owned set, the reversal markers and the deletion corpus — a much larger change than the
 * defect. So removal is CONSERVATIVE: an unwanted owned key that is already on disk stays, and
 * is reported to the caller as `stranded` so the user is told rather than left to discover it.
 *
 * That leaves a gate wired for a rule this build does not make binding, which is the
 * FAIL-CLOSED direction — the boundary asks for a confirmation the constitution no longer
 * compels, exactly as the commit skill's own consent step does with the pack off. The unsafe
 * direction, a rule with no gate behind it, cannot occur here. A FRESH file is unaffected:
 * `mergeOpencodeJson` writes `defaultPermission(doctrines, excluded)` whole, so a new pack-off install
 * has no git gate at all.
 *
 * ⚠ KEY ORDER IS NOT RECONCILED, DELIBERATELY. `defaultPermission` emits its keys in a fixed
 * order, so a FRESH write is tidy; an off→on reconcile appends the two process keys after the
 * force-push pair and the block reads out of order from then on. Restoring the order means
 * rewriting a map whose other entries belong to the user — sorting THEIR keys to tidy OURS is
 * the value-over-ownership mistake in a second suit, and JSON object order carries no meaning
 * to OpenCode. So the order is left as found and only membership is reconciled.
 *
 * Returns a third element, `opaque`: the shape reason wiring was impossible, or `null`. The
 * caller warns on it. This is the one branch where the boundary can end up with NO Geneseed
 * gate at all while the constitution states the rule — the unsafe direction — so it must not
 * also be the silent one.
 * @returns {[boolean, string[], string | null]}
 */
function reconcileOpencodePermission(perm, want) {
  // A `permission` that is not an object, or whose `bash` is not one — OpenCode also accepts a
  // bare `"bash": "allow"` — is a shape this function has no owned keys inside of. Leaving it
  // exactly as found is the whole point; rewriting it into a map would DELETE a blanket policy
  // the user wrote, which is a bigger change than the one being reconciled.
  if (!isDict(perm)) return [false, [], 'is not an object'];
  if (has(perm, 'bash') && !isDict(get(perm, 'bash'))) {
    return [false, [], 'has a "bash" that is not an object'];
  }
  const fresh = !has(perm, 'bash');
  const bash = fresh ? {} : get(perm, 'bash');
  let changed = false;
  const stranded = [];
  for (const k of OWNED_BASH) {
    if (has(want.bash, k)) {
      if (!has(bash, k)) { bash[k] = want.bash[k]; changed = true; }
    } else if (has(bash, k)) stranded.push(k);
  }
  if (changed && fresh) perm.bash = bash;
  return [changed, stranded, null];
}

/** `_build_settings._opencode_target`. Only caller of a `.json` -> `.jsonc` suffix swap. */
export function opencodeTarget(jsonPath) {
  const ext = path.extname(jsonPath);
  const jsonc = (ext ? jsonPath.slice(0, jsonPath.length - ext.length) : jsonPath) + '.jsonc';
  return existsSync(jsonc) ? jsonc : jsonPath;
}

/**
 * `_build_settings._read_jsonc` — an EXPORTED PRIMITIVE, deliberately.
 *
 * Four runtime call sites use it as a plain JSONC parser rather than as wiring, all four
 * in `rituals/_harness_mcp.py` (P1b counted the call sites and named them callers; they
 * are one module). Folding it inside a wire entry point would leave those four with
 * nothing to call.
 *
 * Returns `[data, hadComments]`, with `data === null` for UNPARSEABLE input — distinct
 * from a legitimately empty `{}`, because writers must refuse to rewrite a file they could
 * not parse.
 */
export function readJsonc(text) {
  const out = [];
  let hadComments = false;
  let i = 0;
  let inStr = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inStr) {
      out.push(ch);
      if (ch === '\\' && i + 1 < n) {
        out.push(text[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '"') inStr = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out.push(ch);
      i += 1;
      continue;
    }
    if (ch === '/' && i + 1 < n && text[i + 1] === '/') {
      hadComments = true;
      i += 2;
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i += 1;
      continue;
    }
    if (ch === '/' && i + 1 < n && text[i + 1] === '*') {
      hadComments = true;
      i += 2;
      while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '}' || ch === ']') {
      while (out.length && ' \t\r\n'.includes(out[out.length - 1])) out.pop();
      if (out.length && out[out.length - 1] === ',') out.pop();
      out.push(ch);
      i += 1;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  const stripped = out.join('');
  try {
    // `parseJson`, not `JSON.parse`: this file gets written back out, and a user's
    // `"temperature": 1.0` would come back as `1` from a bare parse. The int/float
    // distinction has to survive a round trip through somebody's real settings.json.
    return [parseJson(stripped), hadComments];
  } catch {
    return [null, hadComments];
  }
}

/**
 * A config file read as a JSON OBJECT, classified rather than decided:
 * `{ state, data, hadComments }`, `state` one of
 * - `'absent'`     — no file at `p`
 * - `'unreadable'` — it exists and the read threw (`error` carries why)
 * - `'invalid'`    — it does not parse (`data` null)
 * - `'notObject'`  — it parses, to something that is not an object (`[]`, `3`)
 * - `'ok'`         — `data` is the object.
 *
 * ONE READER, MANY POLICIES. Ten call sites had each restated read → `readJsonc` → `isDict`, and
 * their refusal rules had drifted: some warned, some returned `false`, some swallowed a
 * non-OS throw. The reading is the same everywhere and lives here; what a state MEANS stays at
 * the caller, because it really does differ — a merge must refuse to rewrite a file it could
 * not read, an unwire just declines, an integrity check reports. `hadComments` is reported in
 * every state that got as far as the text, since `mcpCommented` asks it of files that do not
 * parse.
 *
 * `strict` reads plain JSON (`parseJson`) — comments and trailing commas are then `'invalid'`.
 * The Claude-style MCP configs are strict by contract (see `mcpLoad`).
 */
export function loadJsonObject(p, { strict = false } = {}) {
  if (!existsSync(p)) return { state: 'absent', data: null, hadComments: false };
  let text;
  try {
    text = readText(p);
  } catch (e) {
    if (!isOsError(e)) throw e;
    return { state: 'unreadable', data: null, hadComments: false, error: e };
  }
  let data;
  let hadComments = false;
  if (strict) {
    try { data = parseJson(text); } catch { data = null; }
  } else {
    [data, hadComments] = readJsonc(text);
  }
  if (data === null) return { state: 'invalid', data, hadComments };
  return { state: isDict(data) ? 'ok' : 'notObject', data, hadComments };
}

/**
 * `_build_settings._warn_commented_jsonc`. Prints to STDOUT — the Python's own choice.
 *
 * `permission` is THREE-STATE, not a boolean: `'add'` for a file with no `permission` key,
 * `'reconcile'` for one that has a block this build would have wired gates into, and falsy for
 * neither. A commented `.jsonc` is never rewritten — that is what "your edits are kept" buys —
 * so the only thing this branch can do about a stale block is SAY SO, and telling a file that
 * already has a `permission` key to add one is not saying so. Any other truthy value is read as
 * `'add'`, which is what the boolean callers this replaced meant.
 */
function warnCommentedJsonc(target, agentPath, permission,
  includeLsp = false, prefix = 'geneseed', doctrines = null, excluded = []) {
  process.stdout.write(`[${prefix}] ${path.basename(target)} has comments — not rewriting `
    + 'it (your edits are kept). Add this to its "instructions" array by hand:\n');
  process.stdout.write(`[${prefix}]     ${jsonDumps(agentPath)}\n`);
  if (permission) {
    process.stdout.write(permission === 'reconcile'
      ? `[${prefix}] and its "permission".bash is missing gates this build wires — `
        + 'reconcile it by hand against:\n'
      : `[${prefix}] and, for Geneseed's default ask-gates, a "permission" key:\n`);
    for (const line of jsonDumpsIndent(defaultPermission(doctrines, excluded)).split('\n')) {
      process.stdout.write(`[${prefix}]     ${line}\n`);
    }
  }
  if (includeLsp) {
    process.stdout.write(`[${prefix}] and, to enable code intelligence, a top-level `
      + '"lsp": true\n');
  }
}

/**
 * `_build_settings._atomic_write_json` — the ONE atomic JSON writer: pretty JSON through a
 * sibling temp file and a rename, creating the parent directory first. Throws on failure, as
 * the Python does, and never leaves the temp file behind.
 *
 * Every config this codebase rewrites goes through it — settings, `opencode.json`, MCP
 * configs, the install manifest — because a plain write that dies half-way through leaves a
 * truncated file where the user's config was.
 */
export function atomicWriteJson(p, config) {
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.geneseed-tmp`;
  writeText(tmp, `${jsonDumpsIndent(config)}\n`);
  try {
    renameSync(tmp, p);
  } catch (e) {
    if (!isOsError(e)) throw e;
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** `_build_settings._merge_opencode_json`. Returns the resolved target path.
 *
 * Zero runtime callers — re-measured this phase and still true. `rituals/_harness_mcp.py`
 * re-implements the inverse itself rather than inherit this one's permission/lsp side
 * effects, so the only crossings are the two emit-tree ones (`_build_emit.emit_opencode`,
 * `_build_global.emit_opencode_global`). */
export function mergeOpencodeJson(p, agentPath, doctrines = null, excluded = []) {
  const target = opencodeTarget(p);
  let config = { $schema: OPENCODE_SCHEMA, instructions: [] };
  const { state, data, hadComments, error } = loadJsonObject(target);
  if (state === 'unreadable') {
    process.stderr.write(`[geneseed] WARN: could not read ${target} (${error.message}) `
      + `— NOT touching it. Add ${jsonDumps(agentPath)} to its "instructions" array by `
      + "hand once it's readable again.\n");
    return target;
  }
  if (state === 'invalid' || state === 'notObject') {
    process.stderr.write(`[geneseed] ${path.basename(target)} is not a JSON object — NOT `
      + `rewriting it (fix the file, then re-run). Add ${jsonDumps(agentPath)} to its `
      + '"instructions" once repaired.\n');
    return target;
  }
  if (state === 'ok') config = data;
  if (!has(config, '$schema')) config.$schema = OPENCODE_SCHEMA;
  let instr = get(config, 'instructions');
  if (!Array.isArray(instr)) instr = [];
  const addInstr = indexOfDeepEqual(instr, agentPath) < 0;
  if (addInstr) instr.push(agentPath);
  config.instructions = instr;
  // Absent ⇒ write the whole block; present ⇒ reconcile Geneseed's own git keys. Adding is
  // unconditional; removal is not this stage's to make (see `reconcileOpencodePermission`), so
  // the second return value is what it declined to take away. `addPerm` stays a separate flag
  // from "something changed" because the two produce DIFFERENT advice on a commented file.
  const addPerm = !has(config, 'permission');
  let permChanged = addPerm;
  let stranded = [];
  let opaque = null;
  if (addPerm) config.permission = defaultPermission(doctrines, excluded);
  else {
    [permChanged, stranded, opaque] = reconcileOpencodePermission(get(config, 'permission'),
      defaultPermission(doctrines, excluded));
  }
  // The shape said no. This is the direction the residue warning above is NOT — a rule stated
  // in AGENT.md with nothing behind it — and it used to pass in silence, because a blanket
  // `"permission": {"bash": "allow"}` makes every reconcile a no-op and the whole merge then
  // short-circuits before any of the three WARNs below. Reported, never rewritten: the blanket
  // policy is the user's answer and it wins (`generate.test.mjs` pins that it survives).
  if (opaque) {
    process.stderr.write(`[geneseed] WARN: "permission" in ${path.basename(target)} `
      + `${opaque}, so Geneseed cannot wire its own gates into it — including `
      + `${OWNED_BASH.filter((k) => has(defaultPermission(doctrines, excluded).bash, k))
        .map((k) => jsonDumps(k)).join(', ')}. Your policy is left exactly as written; the `
      + 'harness states those rules but nothing enforces them at this boundary.\n');
  }
  // Told, not silently left: these are gates for a rule this build does not make binding, kept
  // because Geneseed cannot prove it was the one that wrote them. stderr, like the other two
  // WARNs here — the emit's stdout is byte-compared by the golden corpus.
  if (stranded.length) {
    process.stderr.write(`[geneseed] WARN: ${path.basename(target)} keeps `
      + `${stranded.map((k) => jsonDumps(k)).join(', ')} under "permission".bash — the `
      + 'doctrine pack behind those gates is off in this build, but Geneseed cannot tell its '
      + 'own entry from one you wrote, so it removes neither. Delete them by hand if you want '
      + 'them gone.\n');
  }
  const addLsp = !has(config, 'lsp');
  if (addLsp) config.lsp = true;
  if (!addInstr && !permChanged && !addLsp) return target;
  if (path.extname(target) === '.jsonc' && hadComments) {
    // ⚠ THE TWO CASES GIVE OPPOSITE ADVICE, and telling a file that HAS a `permission` key to
    // add one is how the first cut of this got it wrong. `add` = there is no block, here is the
    // whole one; `reconcile` = there is a block and it is missing gates this build wires, and
    // this branch cannot write them because rewriting would drop the user's comments.
    //
    // DECIDED, NOT DEFERRED: a commented `.jsonc` is never rewritten and never will be. A
    // comment-preserving JSONC writer is a parser, an AST and a printer — a dependency-free
    // one, since this package ships zero — to keep formatting nobody asked us to touch, in a
    // file Geneseed co-owns rather than owns. The advice above is the whole remedy: the exact
    // block to paste, split by which of the two situations the reader is actually in. It is
    // stdout, not stderr, because on this path the paste-in IS the output.
    warnCommentedJsonc(target, agentPath, addPerm ? 'add' : (permChanged && 'reconcile'),
      addLsp, 'geneseed', doctrines, excluded);
    return target;
  }
  try {
    atomicWriteJson(target, config);
  } catch (e) {
    if (!isOsError(e)) throw e;
    process.stderr.write(`[geneseed] WARN: could not write ${target} (${e.message}) — `
      + `the harness will NOT auto-load until this is fixed. Add ${jsonDumps(agentPath)} `
      + 'to its "instructions" array by hand.\n');
  }
  return target;
}

// `except OSError as e: f"({e})"` is inlined as `e.message` at each call site above and below.
// Python renders `[Errno 13] Permission denied: 'C:\\x\\y'`; Node's message is
// `EACCES: permission denied, open 'C:\x\y'`. The two cannot be made to agree, so the parity
// gate does not drive a cell through a real fs failure — it exercises the branch with an
// injectable failure instead and compares everything except the OS's own wording.

/**
 * `_build_settings._claude_hook_groups` — Geneseed's Claude hooks, keyed by event.
 *
 * ⚠ `doctrines` IS WHERE PROMPT AND BOUNDARY ARE KEPT IN AGREEMENT. The `git-gate` group
 * carries TWO rules: Law IV (destructive git — universal, every build) and doctrine process 5
 * (consent before commit/push). With the process pack off, or process 5 excluded, that second
 * rule is no longer BINDING — so a gate that stopped every commit to ask for consent to a rule
 * the install did not adopt is the disagreement the three-tier split forbids. The group stays
 * and gains `--no-consent`, which skips only the process-5 branch. It once DROPPED the whole
 * group instead, and Law IV went with it — on Claude only, since Bob carries it
 * through `tool-gate`. The command changing is also what re-wires an existing install:
 * `mergeClaudeSettings` prunes every previously-managed group that is not in this return
 * value.
 *
 * ⚠ WHAT THIS DOES **NOT** CLAIM, because it was written here once and it was false: that the
 * string `process 5` is absent from a pack-off bundle. It is not — 18 emitted files still cite
 * it (`grep -rl 'process 5' <off-bundle>`), and by owner decision D5 that is deliberate: the
 * whole pack CATALOGUE ships in every build (`<bundle>/doctrines/process.md` is byte-identical
 * on and off), so body-prose citations from craft, from the agents and from the skills stay
 * RESOLVABLE rather than dangling. A citation is not an obligation.
 *
 * The one place that distinction is thin is `skills/commit.md`, which carries the operative
 * procedure ("get explicit consent before committing") and not merely a pointer. It is left
 * unconditional ON PURPOSE: a skill that asks before committing when nothing compelled it is
 * never unsafe, whereas conditionalising it would put a second copy of the pack switch in the
 * prose layer for no gain in safety. Asymmetric risk, asymmetric answer — the BOUNDARY follows
 * the pack, the ASKING does not have to.
 *
 * The `rule-gate` group stays in every build. Its subject is which durable store a write
 * belongs in — the user's call — not how work is run, so it is not the process pack's to
 * remove. `default` here means unknown, and unknown keeps the gate (see `processPackOn`).
 */
export function claudeHookGroups(cfg, hookOpts, doctrines = null, excluded = [], host = 'claude') {
  const run = hookPrefix(hookOpts);
  const mem = `--memory "${path.join(cfg, 'memory')}"`;
  // --root carries the install's own dir so a GLOBAL hook can stand down when a live, wired
  // project install of the same host sits in the session's project dir (no walk up —
  // `globalHookStandingDown`, project-bypasses-global): `context` and
  // `git-gate` read it, `learn` reads `--memory`'s parent. `rule-gate` and Bob's `tool-gate`
  // do not stand down: both still run once per install (host-compat B4 fixed only the three).
  if (host === 'bob') {
    // BOB'S OWN HOOK CONTRACT, per its hooks doc and 2.0.2 changelog (docs/reviews/
    // bob-global-injection-2026-09.md): FIVE events — SessionStart, UserPromptSubmit,
    // PreToolUse, PostToolUse, Stop — Claude's names, but NOT Claude's protocol. stdout is
    // read as context on SessionStart only; on PreToolUse it is ignored and the one way to
    // refuse a call is EXIT CODE 2. The groups this emit wrote before were Claude's whole
    // set: `SubagentStop`/`PreCompact` are not Bob events, and the gates answered with a
    // stdout JSON Bob never reads — permissive on every call. `--host bob` makes the gates
    // speak exit codes (js/hosts/hooks.mjs). No matcher on PreToolUse: Bob's tool names
    // are undocumented (its IDE and Shell differ), so `tool-gate` reads the payload's shape
    // instead. Which tool payload fields Bob sends is equally undocumented; the gates read
    // Claude's (`command`, `file_path`/`path`, `content`/`new_string`) and defer on anything
    // else. Unverified live: no Bob install on the authoring machine.
    const b = ' --host bob';
    return {
      SessionStart: [{ hooks: [{ type: 'command', command: `${run} context --root "${cfg}"${b} || exit 0` }] }],
      // One group, both gates: process 5's consent is a stderr line here (Bob has no ask
      // tier), so the pack toggle that drops Claude's git-gate group has nothing to drop —
      // `tool-gate` only ever EXITS 2 for Laws I and IV, which every build carries, and for a
      // write under a project's own `.geneseed/protected-checks.txt` — the project opted in.
      PreToolUse: [{ hooks: [{ type: 'command', command: `${run} tool-gate --root "${cfg}"${b}` }] }],
      // Bob's Stop payload never carries `transcript_path` (I2) — `learn` reads `--host bob`
      // and returns immediately rather than wasting a model call on the bare envelope. KEPT
      // rather than DROPPED: the stand-down costs nothing (no transcript read, no spawn), and
      // if Bob ever starts sending one, learning on Bob starts working with no emit change —
      // dropping the group would need a second one re-added later for the same reason.
      Stop: [{ hooks: [{ type: 'command', command: `${run} learn ${mem}${b} || exit 0` }] }],
    };
  }
  // OpenClaude takes Claude's whole group set and verdicts unchanged. `context` needs the host
  // to know which root file OpenClaude already loads by itself; `git-gate` and `learn` need it
  // to stand down under a relocated `$OPENCLAUDE_CONFIG_DIR` (the marker is keyed on `--host`,
  // not the folder name — `globalHookStandingDown`). Claude's commands carry none: no `--host`
  // means Claude, so they stay byte-identical. An OLDER shim (last-writer-wins) accepts
  // `--host` on `git-gate` but not on `learn`, which then exits 1 under `|| exit 0` and skips.
  const h = host === 'openclaude' ? ' --host openclaude' : '';
  const context = `${run} context --root "${cfg}"${h} || exit 0`;
  const gate = `${run} git-gate --root "${cfg}"${h}${consentRuleOn(doctrines, excluded) ? '' : ' --no-consent'}`;
  const ruleGate = `${run} rule-gate --root "${cfg}"`;
  const learn = `${run} learn ${mem}${h} || exit 0`;
  const groups = {
    PreToolUse: [
      // `Bash|PowerShell`, not `Bash` alone (Claude verdict I1): docs `hooks.md` says a hook
      // that matches only `Bash` never fires on the PowerShell tool, which is Windows' default
      // shell whenever Git Bash is absent — and on Windows without Git Bash, Bash is not even
      // registered. `tool_input.command` is the same field on both tools, so `GIT_GATE_RE`
      // needs no change.
      { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: gate }] },
      {
        // No `MultiEdit`: it is not in Claude Code's tool table (tools-reference.md) — a dead
        // matcher entry (Claude verdict R2).
        matcher: 'Write|Edit|NotebookEdit',
        hooks: [{ type: 'command', command: ruleGate }],
      },
    ],
    // One matcher-less group, not a `startup|clear` / `resume|compact` split (Claude verdict
    // I4): every SessionStart source — `startup`, `resume`, `clear`, `compact` and `fork` —
    // runs the identical `context` command, so splitting them only risked missing one. The
    // split DID: a `--fork-session` run sets `source: "fork"`, which neither half matched, so
    // a forked session got no session files or project context. The static AGENT.md is NOT
    // re-printed here either way.
    SessionStart: [{ hooks: [{ type: 'command', command: context }] }],
    // `|| exit 0` (not `|| true`): the hook shell is `sh -c` on POSIX and Git Bash on Windows
    // (OpenClaude requires it), or PowerShell on Windows when Git Bash isn't installed
    // (hooks.md, "Shell form") — never cmd.exe for Claude. Bob runs `cmd /c`, where `true` is
    // not a command (a 9009 error), so `exit 0` is the spelling every shell-form host shares.
    // Under PowerShell `||` is a parse error in 5.1: `powershellForm` below swaps the tail.
    Stop: [{ hooks: [{ type: 'command', command: learn }] }],
    // Same command as Stop: `learn` reads the payload's hook_event_name and routes a
    // SubagentStop to the per-agent lesson path.
    SubagentStop: [{ hooks: [{ type: 'command', command: learn }] }],
    // And once more BEFORE compaction. `learn` distils the tail of the transcript (the newest
    // MAX_NOTES_CHARS), so per-turn Stop is a sliding window over the session — and
    // compaction is the one moment that window is about to be summarised away for good.
    // The payload carries `transcript_path` like Stop's; the matcher-less SessionStart group
    // (its `compact` source) re-seeds context AFTER, this captures memory BEFORE. Same
    // `|| exit 0`: never block.
    PreCompact: [{ hooks: [{ type: 'command', command: learn }] }],
  };
  // Claude Code only: OpenClaude always runs Git Bash on Windows (its `findGitBashPath` exits
  // without one), and Bob takes the early return above.
  if (host !== 'claude' || claudeHookShell(process.env, hookOpts?.platform) !== 'powershell') {
    return groups;
  }
  return powershellForm(groups);
}

/**
 * The PowerShell spelling of a hook group set, for a Claude install on Windows without Git Bash
 * (`claudeHookShell`). Without it the bash form is a parse error there and every hook fails
 * OPEN. Each handler gets an explicit `shell: "powershell"` (hooks.md: it wins over the
 * default) and a leading `&` — PowerShell refuses a quoted command head followed by arguments —
 * and the never-block tail `|| exit 0` becomes `; exit 0`, valid in pwsh 7 and Windows
 * PowerShell 5.1 alike (both measured byte-identical to the bash form's output). The gates stay
 * bare: no verb exits 2, so a launch failure is non-blocking in either shell.
 *
 * The paths stay double-quoted, where PowerShell expands `$name` and reads a backtick as an
 * escape — a Windows path may legally hold either, and a mangled `--root` silently changes
 * which install a gate answers for. So both are backtick-escaped first; nothing else in the
 * command (verbs, flags) can contain them.
 */
function powershellForm(groups) {
  const ps = (h) => {
    const escaped = h.command.replace(/[`$]/g, '`$&');
    const command = `& ${escaped.replace(/ \|\| exit 0$/, '; exit 0')}`;
    return { ...h, command, shell: 'powershell' };
  };
  return Object.fromEntries(Object.entries(groups)
    .map(([event, gs]) => [event, gs.map((g) => ({ ...g, hooks: g.hooks.map(ps) }))]));
}

/**
 * An existing settings file read for a read-modify-write: `[config, hadComments]`, or `null`
 * after saying on stderr why the file must NOT be rewritten.
 *
 * Every refusal is the same refusal `mergeOpencodeJson` makes, for the same reason: the merge
 * starts from `{}` when it has nothing to start from, and `atomicWriteJson` would then
 * replace the user's file with Geneseed's keys alone. A syntax error, valid JSON that is not
 * an object (`[]`), and a file that exists but cannot be read are all "nothing to start
 * from", and none of them is the user's consent to be overwritten. An ABSENT file is the one
 * real empty start: `[{}, false]`.
 */
function readSettingsForMerge(p, consequence) {
  const { state, data, hadComments, error } = loadJsonObject(p);
  if (state === 'absent') return [{}, false];
  if (state === 'unreadable') {
    process.stderr.write(`[geneseed] WARN: could not read ${p} (${error.message}) — NOT `
      + `touching it. ${consequence}\n`);
    return null;
  }
  if (state === 'invalid') {
    process.stderr.write(`[geneseed] ${path.basename(p)} is not valid JSON — NOT `
      + `rewriting it (fix the syntax, then re-run). ${consequence}\n`);
    return null;
  }
  if (state === 'notObject') {
    process.stderr.write(`[geneseed] ${path.basename(p)} is not a JSON object — NOT `
      + `rewriting it (fix the file, then re-run). ${consequence}\n`);
    return null;
  }
  return [data, hadComments];
}

/**
 * `_build_settings._merge_claude_settings` — returns `[target, managed]`.
 *
 * Surgical: every other key and the user's own hook entries survive. `priorHooks` is the
 * manifest's previously-recorded managed groups; any still in the file but no longer
 * canonical (a moved checkout, the pre-`|| exit 0` hook form) is PRUNED, because without
 * that a re-emit stacks the new group beside the stale one and `learn` runs twice per Stop.
 * `managed` is the complete current claim set, so unwire removes exactly those.
 *
 * `cfgDir` is the install's own dir — what the hooks carry as `--root` and under which
 * `memory/` lives. It is NOT always `dirname(p)`: Bob's global settings file is nested
 * (`~/.bob/settings/settings.json`), and deriving the root from it pointed every global Bob
 * hook at `~/.bob/settings` — memory learned where nothing reads it, excludes missed, and a
 * global that never stood down for a project install.
 */
export function mergeClaudeSettings(p, priorHooks = null, hookOpts = {},
  doctrines = null, excluded = [], host = 'claude', cfgDir = path.dirname(p)) {
  const prior = (priorHooks || []).filter(isDict);
  const loaded = readSettingsForMerge(p, 'Hooks were not wired.');
  if (!loaded) return [p, prior];
  const [config, hadComments] = loaded;
  let hooks = get(config, 'hooks');
  if (!isDict(hooks)) hooks = {};
  const canonical = claudeHookGroups(cfgDir, hookOpts, doctrines, excluded, host);
  const canonFlat = [];
  for (const [event, groups] of Object.entries(canonical)) {
    for (const g of groups) canonFlat.push({ event, group: g });
  }
  let pruned = false;
  for (const rec of prior) {
    if (indexOfDeepEqual(canonFlat, rec) >= 0) continue;
    const event = get(rec, 'event');
    const group = get(rec, 'group');
    const arr = get(hooks, event);
    if (Array.isArray(arr)) {
      const at = indexOfDeepEqual(arr, group);
      if (at >= 0) {
        arr.splice(at, 1);
        pruned = true;
        if (!arr.length) delete hooks[event];
      }
    }
  }
  const added = [];
  for (const [event, newGroups] of Object.entries(canonical)) {
    let arr = get(hooks, event);
    if (!Array.isArray(arr)) arr = [];
    for (const g of newGroups) {
      if (indexOfDeepEqual(arr, g) >= 0) continue;
      arr.push(g);
      added.push({ event, group: g });
    }
    hooks[event] = arr;
  }
  const survivors = prior.filter((r) => indexOfDeepEqual(canonFlat, r) >= 0);
  const managedNow = survivors.concat(added.filter((a) => indexOfDeepEqual(survivors, a) < 0));
  if (!added.length && !pruned) return [p, managedNow];
  if (hadComments) {
    process.stderr.write(`[geneseed] ${path.basename(p)} has comments — not rewriting it `
      + "(your edits are kept). Add Geneseed's hooks by hand from "
      + 'adapters/claude-code/settings.json.\n');
    return [p, prior];
  }
  // Never empty here: `canonical` always carries at least three events, and every one of them
  // was just written into `hooks`.
  config.hooks = hooks;
  atomicWriteJson(p, config);
  return [p, managedNow];
}

/**
 * `_build_settings._unwire_claude_settings` — remove exactly the recorded groups.
 *
 * Returns true when the file was actually rewritten, false when it bailed, so uninstall
 * can report reality instead of assuming success.
 */
export function unwireClaudeSettings(p, added) {
  if (!added || !added.length) return false;
  // Every state but a comment-free object declines: an unwire never rewrites what it could not
  // read whole, and a commented file would lose its comments.
  const { state, data: loaded, hadComments } = loadJsonObject(p);
  if (state !== 'ok' || hadComments) return false;
  const hooks = get(loaded, 'hooks');
  if (!isDict(hooks)) return false;
  for (const rec of added) {
    const event = get(rec, 'event');
    const group = get(rec, 'group');
    let arr = get(hooks, event);
    if (Array.isArray(arr)) {
      const at = indexOfDeepEqual(arr, group);
      if (at >= 0) arr.splice(at, 1);
    }
    arr = get(hooks, event);
    if (Array.isArray(arr) && !arr.length) delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete loaded.hooks;
  try {
    atomicWriteJson(p, loaded);
  } catch (e) {
    if (!isOsError(e)) throw e;
    return false;
  }
  return true;
}

/**
 * `_build_settings._wire_claude_excludes` — append-if-absent into `claudeMdExcludes`.
 * Returns the entries actually written.
 */
export function wireClaudeExcludes(p, excludes) {
  const want = (excludes || []).filter(Boolean);
  if (!want.length) return [];
  const loaded = readSettingsForMerge(p, 'Excludes were not wired.');
  if (!loaded) return [];
  const [config, hadComments] = loaded;
  let cur = get(config, 'claudeMdExcludes');
  if (!Array.isArray(cur)) cur = [];
  const added = want.filter((e) => indexOfDeepEqual(cur, e) < 0);
  if (!added.length) return [];
  if (hadComments) {
    process.stderr.write(`[geneseed] ${path.basename(p)} has comments — not rewriting it `
      + '(your edits are kept). Add to its "claudeMdExcludes" array by hand: '
      + `${jsonDumpsCompact(added)}\n`);
    return [];
  }
  cur.push(...added);
  config.claudeMdExcludes = cur;
  try {
    atomicWriteJson(p, config);
  } catch (e) {
    if (!isOsError(e)) throw e;
    process.stderr.write(`[geneseed] WARN: could not write ${p} (${e.message}) — `
      + 'claudeMdExcludes were not wired. Add to its "claudeMdExcludes" array by hand: '
      + `${jsonDumpsCompact(added)}\n`);
    return [];
  }
  return added;
}

/** `_build_settings._unwire_claude_excludes`. */
export function unwireClaudeExcludes(p, excludes) {
  if (!excludes || !excludes.length) return;
  const { state, data: loaded, hadComments } = loadJsonObject(p);
  if (state !== 'ok' || hadComments) return;
  const cur = get(loaded, 'claudeMdExcludes');
  if (!Array.isArray(cur)) return;
  for (const e of excludes) {
    const at = indexOfDeepEqual(cur, e);
    if (at >= 0) cur.splice(at, 1);
  }
  if (cur.length) loaded.claudeMdExcludes = cur;
  else delete loaded.claudeMdExcludes;
  try {
    atomicWriteJson(p, loaded);
  } catch (e) {
    if (!isOsError(e)) throw e;
  }
}

// ---- Settings integrity check -----------------------------------------------------
// Substrings that mark a hook command as Geneseed's. An ARRAY, not one string, because two
// shapes are in the wild and both must stay recognisable: the legacy direct form
// (interpreter + checkout harness.py) written by every install emitted before the shim, and
// the shim form. Dropping the legacy entry makes every not-yet-migrated install invisible
// to the orphan scan — the one place a stranded hook can still surface — so cleanup would
// silently leave live hooks behind in every config emitted before the shim landed.
export const GENESEED_HOOK_SNIFF = ['harness.py', SHIM_MARK];

/** `_build_settings._settings_hook_groups` — flatten `hooks` to [event, group] pairs. */
function settingsHookGroups(loaded) {
  const hooks = get(loaded, 'hooks');
  if (!isDict(hooks)) return [];
  const out = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (Array.isArray(groups)) {
      for (const g of groups) if (isDict(g)) out.push([event, g]);
    }
  }
  return out;
}

/**
 * `_build_settings._settings_integrity_check` — does the file match what the manifest
 * claims was wired (`expect='present'`) or unwired (`expect='absent'`)?
 *
 * Returns the problems and ALSO prints them; never raises. A COMMENTED file IS still
 * checked: emit and unwire both refuse to touch one, which is exactly how hooks linger
 * after an uninstall, so the one state they will not write is the one that must not escape
 * verification.
 */
export function settingsIntegrityCheck(p, managed, expect = 'present') {
  const problems = [];
  const flush = () => {
    for (const x of problems) process.stderr.write(`[geneseed] WARN: ${x}\n`);
    return problems;
  };
  const m = isDict(managed) ? managed : {};
  const { state, data: loaded, error } = loadJsonObject(p);
  if (state === 'absent') {
    if (expect === 'present') {
      problems.push(`${p}: file does not exist, but hooks/excludes were supposed to be `
        + 'wired into it');
    }
    return flush();
  }
  if (state === 'unreadable') {
    problems.push(`${p}: could not read the file (${error.message})`);
    return flush();
  }
  if (state !== 'ok') {
    problems.push(`${p}: not a JSON object — cannot verify hooks/excludes`);
    return flush();
  }

  const presentGroups = settingsHookGroups(loaded);
  const recordedHooks = (get(m, 'settings_hooks') || []).filter(isDict);
  // Plain deep equality here (not the sorted-dump key the orphan scan below uses) is
  // deliberate: both sides came out of a JSON parse, so it is already order-independent.
  // The orphan scan needs the dumped-string form because it builds a set for O(1)
  // membership, which a dict cannot join.
  for (const rec of recordedHooks) {
    const event = get(rec, 'event');
    const group = get(rec, 'group');
    const hit = presentGroups.some(([e, g]) => deepEquals(e, event) && deepEquals(g, group));
    if (expect === 'present' && !hit) {
      problems.push(`${p}: recorded hook group missing — event=${formatRepr(event ?? null)} `
        + `group=${jsonDumpsCompact(group ?? null)}`);
    } else if (expect === 'absent' && hit) {
      problems.push(`${p}: recorded hook group still present after unwire — `
        + `event=${formatRepr(event ?? null)} group=${jsonDumpsCompact(group ?? null)}`);
    }
  }

  let exclCur = get(loaded, 'claudeMdExcludes');
  exclCur = Array.isArray(exclCur) ? exclCur : [];
  for (const entry of (get(m, 'settings_excludes') || [])) {
    const hit = indexOfDeepEqual(exclCur, entry) >= 0;
    if (expect === 'present' && !hit) {
      problems.push(`${p}: recorded claudeMdExcludes entry missing: ${formatRepr(entry)}`);
    } else if (expect === 'absent' && hit) {
      problems.push(`${p}: recorded claudeMdExcludes entry still present after unwire: `
        + `${formatRepr(entry)}`);
    }
  }

  // Geneseed-PATTERN entries present but not in the recorded claim set — warn only, never
  // auto-delete (they may be user-authored, or a claim this run legitimately did not
  // inherit).
  const recordedSet = new Set(recordedHooks.map(
    (r) => `${formatRepr(get(r, 'event') ?? null)}\u0000`
      + `${jsonDumpsCompact(get(r, 'group') ?? null, { sortKeys: true })}`));
  for (const [event, group] of presentGroups) {
    const key = `${formatRepr(event)}\u0000${jsonDumpsCompact(group, { sortKeys: true })}`;
    if (recordedSet.has(key)) continue;
    const cmds = (get(group, 'hooks') || []).filter(isDict)
      .map((h) => (has(h, 'command') ? h.command : ''));
    if (cmds.some((c) => typeof c === 'string'
      && GENESEED_HOOK_SNIFF.some((mk) => c.includes(mk)))) {
      problems.push(`${p}: Geneseed-pattern hook present but NOT recorded in the manifest `
        + `(event=${formatRepr(event)}) — possibly user-authored; left alone`);
    }
  }

  return flush();
}

const delimiters = (blockId) => [`<!-- BEGIN ${blockId} -->`, `<!-- END ${blockId} -->`];

/**
 * `_build_settings._managed_block_write` — 'created' | 'updated' | 'merged'.
 * Idempotent: a re-emit replaces the block, never stacks them.
 */
export function managedBlockWrite(p, content, blockId = 'GENESEED') {
  const [begin, end] = delimiters(blockId);
  const block = `${begin}\n${stripWhitespaceEnd(content)}\n${end}\n`;
  if (!existsSync(p)) {
    mkdirSync(path.dirname(p), { recursive: true });
    writeText(p, block);
    return 'created';
  }
  const existing = readText(p);
  if (existing.includes(begin) && existing.includes(end)) {
    const pre = existing.split(begin)[0];
    const post = existing.slice(existing.indexOf(end) + end.length);
    writeText(p, pre + block + lstripNewlines(post));
    return 'updated';
  }
  const sep = existing.endsWith('\n') ? '' : '\n';
  writeText(p, `${existing + sep}\n${block}`);
  return 'merged';
}

/** `_build_settings._managed_block_remove`. */
export function managedBlockRemove(p, blockId = 'GENESEED', whole = false) {
  if (!existsSync(p)) return;
  if (whole) {
    unlinkSync(p);
    return;
  }
  const [begin, end] = delimiters(blockId);
  const existing = readText(p);
  if (!existing.includes(begin) || !existing.includes(end)) return;
  const pre = existing.split(begin)[0];
  const post = existing.slice(existing.indexOf(end) + end.length);
  const rest = stripWhitespace(`${stripTrailingNewlines(pre)}\n${lstripNewlines(post)}`);
  if (rest) writeText(p, `${rest}\n`);
  else unlinkSync(p);
}

/**
 * The global OpenCode `AGENTS.md` sentinel. OpenCode loads `<cfg>/AGENTS.md` and, only when it
 * is ABSENT, `~/.claude/CLAUDE.md` — where a Claude-global install keeps the whole harness in
 * Claude dialect — so without an AGENTS.md the harness loads twice. The switch upstream is an
 * env var (`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`) no config file can set, so the file has to exist.
 * The carrier stays `AGENT.md`: this block only has to exist, and it is one line because it
 * lands in every system prompt. A user's own AGENTS.md already suppresses the fallback and is
 * left byte-for-byte alone; only an absent file or one carrying our block is written.
 */
export const OPENCODE_SENTINEL = 'AGENTS.md';

export function opencodeSentinelWrite(cfgDir) {
  const p = path.join(cfgDir, OPENCODE_SENTINEL);
  if (existsSync(p) && managedBlockRead(p) === null) return;
  managedBlockWrite(p, 'Geneseed keeps this block so OpenCode does not also load '
    + '~/.claude/CLAUDE.md; the harness is AGENT.md. Put your own rules outside the block.');
}

/** `_build_settings._managed_block_read` — the block's inner content, or null. */
export function managedBlockRead(p, blockId = 'GENESEED') {
  if (!existsSync(p)) return null;
  const [begin, end] = delimiters(blockId);
  const text = readText(p);
  if (!text.includes(begin) || !text.includes(end)) return null;
  const inner = text.slice(text.indexOf(begin) + begin.length);
  return stripNewlines(inner.slice(0, inner.indexOf(end)));
}

function lstripNewlines(s) {
  return s.replace(/^\n+/, '');
}

function stripTrailingNewlines(s) {
  return s.replace(/\n+$/, '');
}

function stripNewlines(s) {
  return lstripNewlines(stripTrailingNewlines(s));
}
