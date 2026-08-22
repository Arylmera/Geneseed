/**
 * `_build_settings.py` in Node — the host-config WIRING layer.
 *
 * This is the half of the emit that edits files the USER co-owns: the JSONC reader, the
 * `opencode.json` / `settings.json` merges, the hook shim, the managed-block machinery and
 * the integrity check. It is the last unit of the generator to cross, and the reason it is
 * last is that it is also the unit the RUNTIME drives: eleven of its names have a consumer
 * outside the emit tree, ten of them in `rituals/_harness_mcp.py` (remerge, deactivate,
 * reactivate, uninstall), two in `rituals/_harness_exclude.py`, one in
 * `rituals/_harness_build.py`. Nothing imports this module yet — P3a proves the unit,
 * P3b flips the call sites.
 *
 * THE STDOUT RULE BINDS HARDEST HERE. The hooks this module writes signal their verdict as
 * a JSON object on stdout and return 0 on EVERY path (`|| exit 0` is not what it looks
 * like — see the shim comment below), so a stray byte printed on a hook path does not make
 * noise, it silently disables a gate. Everything printed here is a generator-time message;
 * the streams are compared byte for byte by `tests/test_settings_parity.py`, and the
 * asymmetry between the two (`_warn_commented_jsonc` prints to STDOUT, every other message
 * to stderr) is the Python's own and is reproduced, not tidied.
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
import {
  chmodSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { printErr, readText, writeText } from '../lib/fs.mjs';
import {
  jsonDumps, jsonDumpsCompact, jsonDumpsIndent, parseJson, deepEquals, formatRepr,
  indexOfDeepEqual,
} from '../lib/json.mjs';

export const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';

/** `dict.get(key)` with Python's semantics — OWN properties only.
 *
 * `loaded[event]` where `event` came out of a manifest hands back `Object.prototype`'s
 * member for `constructor`, `toString` or `valueOf`, where Python's `.get` returns None.
 * The same hazard `js/native.mjs` hit with `overrides[stem]`, on a dict the USER edits. */
function get(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** `except OSError` — an fs failure carries a `code`; anything else is a bug, so rethrow. */
function isOsError(e) {
  return Boolean(e) && typeof e.code === 'string';
}

function isDict(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

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
 * `rm -rf *`, `git push --force*` and `git push -f*` stay in EVERY build: they are
 * Law IV's territory — an always-on invariant — not the process pack's, and the guard
 * plugin's own force-push arm is unconditional for the same reason.
 */
export function defaultPermission(doctrines = null, excluded = []) {
  const bash = { 'rm -rf *': 'ask' };
  if (consentRuleOn(doctrines, excluded)) {
    bash['git commit*'] = 'ask';
    bash['git push*'] = 'ask';
  }
  bash['git push --force*'] = 'ask';
  bash['git push -f*'] = 'ask';
  return { bash };
}

/**
 * Every `permission.bash` key Geneseed has ever written — the OWNED set, which is not the same
 * as the set `defaultPermission` returns for a given selection. The two process-pack keys are
 * in it whether or not this build wants them, because reconciling an EXISTING opencode.json
 * has to be able to recognise a key that is Geneseed's business at all — to add it back when
 * the pack returns, and to name it when this build no longer wants it but will not remove it.
 */
const OWNED_BASH = ['rm -rf *', 'git commit*', 'git push*', 'git push --force*', 'git push -f*'];

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

/**
 * `Path.with_suffix(suffix)` for the one shape this module needs.
 *
 * `PurePath.suffix` and `path.extname` disagree on leading-dot and trailing-dot names
 * (`.bashrc`, `x.`); the only caller passes `…/opencode.json`, and the emit's own callers
 * pass a literal. Spelled off `path.extname` with the empty-extension case handled so a
 * future caller with a suffix-less path appends rather than truncates.
 */
function withSuffix(p, suffix) {
  const ext = path.extname(p);
  return (ext ? p.slice(0, p.length - ext.length) : p) + suffix;
}

/** `_build_settings._opencode_target`. */
export function opencodeTarget(jsonPath) {
  const jsonc = withSuffix(jsonPath, '.jsonc');
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
 * `_build_settings._warn_commented_jsonc`. Prints to STDOUT — the Python's own choice.
 *
 * `permission` is THREE-STATE, not a boolean: `'add'` for a file with no `permission` key,
 * `'reconcile'` for one that has a block this build would have wired gates into, and falsy for
 * neither. A commented `.jsonc` is never rewritten — that is what "your edits are kept" buys —
 * so the only thing this branch can do about a stale block is SAY SO, and telling a file that
 * already has a `permission` key to add one is not saying so. Any other truthy value is read as
 * `'add'`, which is what the boolean callers this replaced meant.
 */
export function warnCommentedJsonc(target, agentPath, permission,
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

/** `_build_settings._atomic_write_json`. Throws on failure, as the Python does. */
export function atomicWriteJson(p, config) {
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
  let hadComments = false;
  if (existsSync(target)) {
    let raw;
    try {
      raw = readText(target);
    } catch (e) {
      if (!isOsError(e)) throw e;
      process.stderr.write(`[geneseed] WARN: could not read ${target} (${asOsError(e)}) `
        + `— NOT touching it. Add ${jsonDumps(agentPath)} to its "instructions" array by `
        + "hand once it's readable again.\n");
      return target;
    }
    const [loaded, hc] = readJsonc(raw);
    hadComments = hc;
    if (loaded === null || !isDict(loaded)) {
      process.stderr.write(`[geneseed] ${path.basename(target)} is not a JSON object — NOT `
        + `rewriting it (fix the file, then re-run). Add ${jsonDumps(agentPath)} to its `
        + '"instructions" once repaired.\n');
      return target;
    }
    config = loaded;
  }
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
    process.stderr.write(`[geneseed] WARN: could not write ${target} (${asOsError(e)}) — `
      + `the harness will NOT auto-load until this is fixed. Add ${jsonDumps(agentPath)} `
      + 'to its "instructions" array by hand.\n');
  }
  return target;
}

/**
 * `str(OSError)` — what Python interpolates for `except OSError as e: f"({e})"`.
 *
 * Python renders `[Errno 13] Permission denied: 'C:\\x\\y'`; Node's message is
 * `EACCES: permission denied, open 'C:\x\y'`. The two cannot be made to agree, so the
 * parity gate does not drive a cell through a real fs failure — it exercises the branch
 * with an injectable failure instead and compares everything except the OS's own wording.
 * Named here so the gap is a decision rather than a surprise at GA.
 */
function asOsError(e) {
  return e.message;
}

// ---- the hook shim ----------------------------------------------------------------
// `|| exit 0` on the emitted commands does NOT mean "ignore failures": git-gate and
// rule-gate return 0 on EVERY path and signal their verdict as a JSON object on stdout.
// The `|| exit 0` is there because a hook that fails to LAUNCH (a moved checkout, a dead
// interpreter) must not block the tool call. A stray byte on stdout — a cmd.exe command
// echo, a "created ~/.geneseed" notice — corrupts that JSON and the gate stops gating
// while still reporting success. Hence `@echo off`, and a shim that prints nothing.
//
// The marker lives in the FILENAME, not the directory: GENESEED_HOME relocates the dir,
// and a relocated install's hooks must stay recognisable to `GENESEED_HOOK_SNIFF`.
export const SHIM_MARK = 'geneseed-hook';

/**
 * `_build_settings._SHIM_ARGV` — the tokens in a shim body that are NOT paths.
 *
 * `shimProblems` reads every quoted token back out of the body and requires each to name an
 * existing file. On Windows that is exactly the two baked paths (`%*` is bare); on POSIX the
 * body forwards argv as `"$@"`, quoted, so both implementations' `doctor` reported a healthy
 * shim as dead on every Linux and macOS host. A defect the port faithfully inherited, and
 * one no Windows cell could see.
 */
export const SHIM_ARGV = new Set(['$@', '%*']);

/**
 * Every quoted token in a shim body that names a path which is not there — empty is healthy.
 *
 * ONE OWNER, because the rule has two consumers now and a second copy is a second place for the
 * `"$@"` defect above to come back: `js/doctor.mjs` turns this into the `[shim] … does not
 * exist` report, and `hookPrefix` reads it to decide whether the shim already on disk is worth
 * protecting from a checkout that will not outlive the emit.
 */
export function shimDeadPaths(body) {
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    .filter((q) => !SHIM_ARGV.has(q) && !existsSync(q));
}

/** `_SHIM_REL`, with the platform as an argument.
 *
 * Python computes it at IMPORT time from `sys.platform`, which is what makes the other
 * platform's branch unreachable on any one machine. Taking it as a parameter is what lets
 * the parity gate compare both branches in one run (Python's side is reachable because
 * `_hook_shim_body` reads `sys.platform` at CALL time). */
export function shimRel(platform = process.platform) {
  return ['bin', SHIM_MARK + (platform === 'win32' ? '.cmd' : '')];
}

/** `_build_settings._shim_home`. */
export function shimHome() {
  const env = process.env.GENESEED_HOME;
  return env ? expanduser(env) : path.join(os.homedir(), '.geneseed');
}

/**
 * `Path(x).expanduser()` — private twin of `js/hosts.mjs`'s `expanduser`, same guard.
 *
 * `GENESEED_HOME` is user-set, same as any config-dir env var there, so a `~user` value here
 * has the identical failure mode (a hook shim written under a literal `~user` directory) and
 * gets the identical fix — refuse rather than pass through. See that file's docblock for why
 * the refusal lives IN the primitive rather than at `shimHome`'s caller.
 */
function expanduser(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  if (p.startsWith('~')) {
    const msg = `refusing '${p}': a '~user' path is not expanded by this port; pass an `
      + 'absolute path, or "~" / "~/…" for your own home directory';
    printErr(`${msg}\n`);
    const e = new Error(msg);
    e.exitCode = 1;
    throw e;
  }
  return p;
}

/** `_build_settings._hook_shim_path`. */
export function hookShimPath(platform = process.platform) {
  return path.join(shimHome(), ...shimRel(platform));
}

/**
 * `_build_settings._hook_shim_body`, with the two volatile values INJECTED.
 *
 * This is the one function in the unit whose Python output is legitimately
 * runtime-dependent: it bakes `sys.executable` and `<checkout>/rituals/harness.py`, and a
 * Node twin at GA bakes `process.execPath` and a different entry point. Golden already
 * refuses to compare the emitted shim for that reason (`_SHIM_GLOB`) and asserts
 * `_shim_health` instead.
 *
 * So the parity gate's answer here is NOT "skip it". Taking `runner` and `entry` as
 * arguments makes the BODY a pure function of three inputs, and the gate feeds Node the
 * same two values Python computed — which makes every byte of it comparable: the `@echo
 * off`, the CRLF, `exit /b` vs `exec`, the quoting that keeps `--root "<cfg>"` intact. What
 * the gate does not prove is WHICH values a Node driver will pass, and that is a one-line
 * decision at P3b's call site rather than anything in this body.
 */
export function hookShimBody(runner, entry, platform = process.platform) {
  if (platform === 'win32') {
    // Bare `exit /b` propagates the LIVE errorlevel; `%ERRORLEVEL%` would expand at parse
    // time and return a stale one. Never plain `exit` — that kills the parent cmd.exe, so
    // the emitted `|| exit 0` would never get to evaluate.
    return '@echo off\r\n'
      + 'rem Generated by Geneseed - do not edit. Rewritten on every emit.\r\n'
      + 'setlocal\r\n'
      + `"${runner}" "${entry}" %*\r\n`
      + 'exit /b\r\n';
  }
  return '#!/bin/sh\n'
    + '# Generated by Geneseed - do not edit. Rewritten on every emit.\n'
    + `exec "${runner}" "${entry}" "$@"\n`;
}

/**
 * `_build_settings._write_hook_shim` — create or refresh the shim, or null on failure.
 *
 * The path and body are arguments for the same reason `hookShimBody`'s two values are: the
 * routine itself has no runtime dependency at all once they are supplied, so all of it is
 * comparable — the unchanged-content fast path (a Windows shim a hook is executing right
 * now cannot be replaced), the newline-folded comparison that makes that fast path
 * reachable, the pid-suffixed temp name that keeps concurrent emits from unlinking each
 * other's file, and the chmod.
 */
export function writeHookShim(p, body, platform = process.platform) {
  try {
    // Newline-normalised: the body carries explicit CRLF on Windows but `read_text()`
    // translates back to `\n`, so a raw `===` would never match and the "unchanged" fast
    // path — the whole point of this branch — would never be taken.
    if (existsSync(p) && statSync(p).isFile()
        && readText(p).replaceAll('\r\n', '\n') === body.replaceAll('\r\n', '\n')) {
      return p;
    }
    mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    // `newline=''` on the Python side: raw, so the CRLF in the body survives verbatim.
    writeFileSync(tmp, body, 'utf8');
    if (platform !== 'win32') chmodSync(tmp, 0o755);
    renameSync(tmp, p);
    return p;
  } catch (e) {
    if (!isOsError(e)) throw e;
    return null;
  }
}

/** The OS temp root, resolved once. `.native` because a Windows `TEMP` can be an 8.3 alias —
 * the same trap `tests/helpers/sandbox.mjs` documents, reached from the other side. */
const TMP_REAL = (() => {
  try { return realpathSync.native(os.tmpdir()); } catch { return os.tmpdir(); }
})();

/** Is `child` inside `parent`? `path.relative` compares case-insensitively on win32. */
function isUnder(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Will the checkout holding `entry` outlive the emit that is baking it into the shim?
 *
 * TWO SHAPES, and both are in `docs/extending.md` §5.3 because both have really happened on this
 * repo: a copied checkout under the OS temp root — the `copyCheckout` fixture, which builds its
 * copy from `git ls-files` and therefore carries no `.git` at all, so only the temp root
 * identifies it — and a git WORKTREE, whose `.git` is a FILE pointing at the main checkout
 * rather than a directory. A plain checkout and an npm install are neither, and keep the
 * ownership they have always had.
 *
 * `tmpRoot` IS A PARAMETER for the reason `shimRel`'s `platform` is: with the real temp root
 * baked in, the second rule is unreachable in a test — anything a test can build under `mkdtemp`
 * has already answered true on the first — so the worktree arm could only ever be exercised by
 * whichever kind of checkout the run happened to sit in.
 */
export function ephemeralCheckout(entry, tmpRoot = TMP_REAL) {
  let real = entry;
  try { real = realpathSync.native(entry); } catch { /* not there yet — test the literal */ }
  if (isUnder(real, tmpRoot)) return true;
  // `<checkout>/bin/geneseed-hook.mjs` — the one shape `hookRunnerEntry` produces.
  try { return statSync(path.join(path.dirname(path.dirname(real)), '.git')).isFile(); } catch {
    return false;
  }
}

/** Does the shim already on disk still name paths that all exist? */
function shimIsLive(p) {
  try { return statSync(p).isFile() && shimDeadPaths(readText(p)).length === 0; } catch {
    return false;
  }
}

/**
 * `_build_settings._hook_prefix` — the `<runner> <entrypoint>` every emitted hook starts
 * with, falling back to the pre-shim direct form when the shim cannot be written.
 *
 * The fallback is strictly no worse than the old behaviour and far better than emitting
 * commands naming a shim that does not exist — those fail on every hook (9009 under
 * cmd.exe, 127 under sh) and take both gates down with them.
 */
export function hookPrefix({ runner, entry, platform = process.platform } = {}) {
  // NOT a default. `runner`/`entry` have no computable fallback on this side — the child's
  // own `process.execPath` is node and the hooks it wires are Python — and the failure mode
  // of letting them through undefined is the worst kind this unit has: `hookShimBody` bakes
  // `"undefined" "undefined" %*`, the shim is rewritten with it, every hook in the install
  // dies, and because the hooks signal through stdout and return 0 on every path, nothing
  // reports it. The shim is also excluded from golden's byte comparison by name, so no
  // acceptance gate would catch it either. Throw where it is cheap to see.
  if (!runner || !entry) {
    throw new Error('hookPrefix: runner and entry are required — the emitted hook shim '
      + 'bakes them, and there is no correct value to guess from inside Node');
  }
  const p = hookShimPath(platform);
  // ⚠ A DISPOSABLE CHECKOUT DOES NOT GET TO CLAIM THE MACHINE-WIDE SHIM. The shim has no
  // per-install component, so the last checkout to emit owns EVERY install's hooks — and when
  // that checkout is a test sandbox or a git worktree, deleting it kills hooks machine-wide with
  // nothing to report it: hooks signal through stdout and return 0 on every path, and this file
  // is excluded from the byte corpora by name. Measured twice in one session, from
  // `tests/unit/harness.test.mjs`'s copied-checkout fixture; `docs/extending.md` §5.3 carries
  // the worktree half.
  //
  // KEEP, NOT REFUSE, and that distinction is what makes this safe to add here rather than at
  // each call site. Returning the existing shim path leaves the emitted hook command
  // byte-identical to what a normal emit writes; taking the fallback below instead would move a
  // hook command in every recorded bundle. The install being emitted then runs the DURABLE
  // checkout's entry — which is exactly what last-writer-wins already handed every other install
  // on the machine, so nothing is lost by it.
  //
  // ONLY A SHIM THAT STILL RESOLVES IS PROTECTED. An absent or already-dead one is no worse for
  // being rewritten from here, and a sandboxed `GENESEED_HOME` (every emit test, every cell) has
  // none — so the suite's own emits are unaffected and this cannot go green by silently
  // skipping the write.
  if (ephemeralCheckout(entry) && shimIsLive(p)) return `"${p}"`;
  const shim = writeHookShim(p, hookShimBody(runner, entry, platform), platform);
  if (shim !== null) return `"${shim}"`;
  process.stderr.write(`[geneseed] WARN: could not write the hook shim at ${p} — emitting `
    + 'hooks that call the interpreter directly. They will break if this checkout moves; '
    + 're-run the build to repair them.\n');
  return `"${runner}" "${entry}"`;
}

/**
 * `_build_settings._claude_hook_groups` — Geneseed's Claude hooks, keyed by event.
 *
 * ⚠ `doctrines` IS WHERE PROMPT AND BOUNDARY ARE KEPT IN AGREEMENT. The `git-gate` group is
 * the tool-boundary half of doctrine process 5. With the process pack off, that rule is no
 * longer BINDING — `src/doctrines/process.md` is not rendered into the carrier's doctrine
 * section and nothing in the constitution obliges the agent to it — so a gate that stopped
 * every Bash call to ask for consent to a rule the install did not adopt is the disagreement
 * the three-tier split forbids. Omitting the group here is also what UNWIRES it from an
 * install that had it: `mergeClaudeSettings` prunes every previously-managed group that is not
 * in this return value, so flipping the pack off and rebuilding takes the hook out of
 * settings.json rather than leaving it orphaned.
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
export function claudeHookGroups(cfg, hookOpts, doctrines = null, excluded = []) {
  const run = hookPrefix(hookOpts);
  const mem = `--memory "${path.join(cfg, 'memory')}"`;
  // --root carries the install's own dir so a GLOBAL hook can stand down when a project
  // install of the same host sits at/above cwd (project-bypasses-global).
  const context = `${run} context --root "${cfg}" || exit 0`;
  const gate = `${run} git-gate --root "${cfg}"`;
  const ruleGate = `${run} rule-gate --root "${cfg}"`;
  const learn = `${run} learn ${mem} || exit 0`;
  return {
    PreToolUse: [
      ...(consentRuleOn(doctrines, excluded)
        ? [{ matcher: 'Bash', hooks: [{ type: 'command', command: gate }] }] : []),
      {
        matcher: 'Write|Edit|MultiEdit|NotebookEdit',
        hooks: [{ type: 'command', command: ruleGate }],
      },
    ],
    SessionStart: [
      { matcher: 'startup|clear', hooks: [{ type: 'command', command: context }] },
      { matcher: 'resume', hooks: [{ type: 'command', command: context }] },
    ],
    // `|| exit 0` (not `|| true`): hooks run under cmd.exe on native Windows, where `true`
    // is not a command and the swallow-failures intent would invert into a 9009 error.
    Stop: [{ hooks: [{ type: 'command', command: learn }] }],
    // Same command as Stop: `learn` reads the payload's hook_event_name and routes a
    // SubagentStop to the per-agent lesson path.
    SubagentStop: [{ hooks: [{ type: 'command', command: learn }] }],
  };
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
 * `scope` is accepted and unused, exactly as in the Python.
 */
export function mergeClaudeSettings(p, scope = 'global', priorHooks = null, hookOpts = {},
  doctrines = null, excluded = []) {
  const prior = (priorHooks || []).filter(isDict);
  let config = {};
  let hadComments = false;
  if (existsSync(p)) {
    try {
      const [loaded, hc] = readJsonc(readText(p));
      hadComments = hc;
      if (loaded === null) {
        process.stderr.write(`[geneseed] ${path.basename(p)} is not valid JSON — NOT `
          + 'rewriting it (fix the syntax, then re-run). Hooks were not wired.\n');
        return [p, prior];
      }
      if (isDict(loaded)) config = loaded;
    } catch (e) {
      if (!isOsError(e)) throw e;
    }
  }
  let hooks = get(config, 'hooks');
  if (!isDict(hooks)) hooks = {};
  const canonical = claudeHookGroups(path.dirname(p), hookOpts, doctrines, excluded);
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
  // The `else` is DEAD on both sides and reproduced rather than dropped: `canonical` always
  // carries four events, so by the time control reaches here `hooks` is never empty. A
  // mutation keeping the empty block instead of deleting it is the one of thirty-three that
  // stays green, and it stays green because there is nothing to detect — recorded the way
  // `themed_rel` and `lstripNewlines` are, so "the gate cannot see it" and "there is
  // nothing to see" keep their distance.
  if (Object.keys(hooks).length) config.hooks = hooks;
  else delete config.hooks;
  mkdirSync(path.dirname(p), { recursive: true });
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
  if (!existsSync(p) || !added || !added.length) return false;
  let loaded;
  let hadComments;
  try {
    [loaded, hadComments] = readJsonc(readText(p));
  } catch (e) {
    if (!isOsError(e)) throw e;
    return false;
  }
  if (hadComments || !isDict(loaded)) return false;
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
  let config = {};
  let hadComments = false;
  if (existsSync(p)) {
    try {
      const [loaded, hc] = readJsonc(readText(p));
      hadComments = hc;
      if (loaded === null) {
        process.stderr.write(`[geneseed] ${path.basename(p)} is not valid JSON — NOT `
          + 'rewriting it (fix the syntax, then re-run). Excludes were not wired.\n');
        return [];
      }
      if (isDict(loaded)) config = loaded;
    } catch (e) {
      if (!isOsError(e)) throw e;
    }
  }
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
  mkdirSync(path.dirname(p), { recursive: true });
  try {
    atomicWriteJson(p, config);
  } catch (e) {
    if (!isOsError(e)) throw e;
    process.stderr.write(`[geneseed] WARN: could not write ${p} (${asOsError(e)}) — `
      + 'claudeMdExcludes were not wired. Add to its "claudeMdExcludes" array by hand: '
      + `${jsonDumpsCompact(added)}\n`);
    return [];
  }
  return added;
}

/** `_build_settings._unwire_claude_excludes`. */
export function unwireClaudeExcludes(p, excludes) {
  if (!existsSync(p) || !excludes || !excludes.length) return;
  let loaded;
  let hadComments;
  try {
    [loaded, hadComments] = readJsonc(readText(p));
  } catch (e) {
    if (!isOsError(e)) throw e;
    return;
  }
  if (hadComments || !isDict(loaded)) return;
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

// P10d. `GENESEED_HOOK_SNIFF` answers "is this hook Geneseed's?". A MIGRATION needs the other
// question — "is this Geneseed's OLD one?" — and the two are not the same sniff.
//
// THREE SHAPES ARE IN THE WILD, AND TWO OF THEM ARE IDENTICAL IN THE SETTINGS FILE:
//   1. legacy-direct  the command itself names `harness.py` (pre-shim, P0 and earlier)
//   2. shim-python    the command names the shim; the shim BODY runs python + harness.py
//   3. shim-node      the command names the shim; the shim BODY runs node + the .mjs entry
//
// 2 and 3 differ ONLY inside the shim body. A classifier reading the host config alone would
// call a fully-unmigrated machine "already migrated" — silently — and `migrate` would no-op on
// exactly the installs it exists for. The shim body is a REQUIRED input, not a refinement.
export const SHIM_ENTRY_MARK = 'geneseed-hook.mjs';

/**
 * `_build_settings._migrate_shape` — 'legacy' | 'current' | 'none'.
 *
 * PURE, so `tests/test_settings_parity.py` runs it over a corpus of real config text no cell
 * can seed. 'none' is not a fault: a Copilot install wires no hooks, and a user's own
 * settings.json may carry three hand-written hooks and no Geneseed entry. Both must read as
 * "nothing to migrate" rather than "unrecognised", or `migrate` refuses on the commonest
 * config on any machine.
 */
export function migrateShape(commands, shimBody) {
  if (commands.some((c) => c.includes('harness.py'))) return 'legacy';
  if (commands.some((c) => c.includes(SHIM_MARK))) {
    return shimBody.includes(SHIM_ENTRY_MARK) ? 'current' : 'legacy';
  }
  return 'none';
}

/**
 * `_build_settings._autostart_paths` — where a hand-written web-daemon autostart entry lives.
 *
 * NOTHING IN THIS REPOSITORY HAS EVER WRITTEN ONE — `SETUP.md` tells the user to create them
 * by hand, and no .py/.mjs/.sh/.cmd in the tree contains `vbs`, `LaunchAgents` or `plist`. So
 * `migrate` REPORTS a stale one and never rewrites it, on the rule `settingsIntegrityCheck`
 * already states: an entry the manifest does not claim is "possibly user-authored; left alone".
 *
 * Both platforms' paths on both platforms, deliberately — the scan is a read that misses
 * harmlessly, and returning only the host platform's would make the macOS arm unreachable
 * from the Windows machine this port is developed on: an ungated branch dressed as a fork.
 */
export function autostartPaths() {
  const home = os.homedir();
  return [
    path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu',
      'Programs', 'Startup', 'geneseed-web.vbs'),
    path.join(home, 'Library', 'LaunchAgents', 'dev.geneseed.web.plist'),
  ];
}

/**
 * `_build_settings._autostart_stale` — the entry names a Geneseed launcher somewhere else.
 *
 * Weak in one direction and strict in the other on purpose: it fires only when the file
 * mentions geneseed at all (an unrelated Startup entry is never named), and clears only when
 * the CURRENT root appears verbatim. A false positive costs one printed line; a false negative
 * leaves a login task pointing at a checkout npm is about to make stale.
 */
export function autostartStale(text, root) {
  if (!text.toLowerCase().includes('geneseed')) return false;
  return !text.includes(root) && !text.includes(root.replaceAll('\\', '/'));
}

/** `_build_settings._settings_hook_groups` — flatten `hooks` to [event, group] pairs. */
export function settingsHookGroups(loaded) {
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
  if (!existsSync(p)) {
    if (expect === 'present') {
      problems.push(`${p}: file does not exist, but hooks/excludes were supposed to be `
        + 'wired into it');
    }
    return flush();
  }
  let loaded;
  try {
    [loaded] = readJsonc(readText(p));
  } catch (e) {
    if (!isOsError(e)) throw e;
    problems.push(`${p}: could not read the file (${asOsError(e)})`);
    return flush();
  }
  if (!isDict(loaded)) {
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

const BLOCK_BEGIN = '<!-- BEGIN {id} -->';
const BLOCK_END = '<!-- END {id} -->';

function delimiters(blockId) {
  return [BLOCK_BEGIN.replace('{id}', blockId), BLOCK_END.replace('{id}', blockId)];
}

/**
 * `_build_settings._managed_block_write` — 'created' | 'updated' | 'merged'.
 * Idempotent: a re-emit replaces the block, never stacks them.
 */
export function managedBlockWrite(p, content, blockId = 'GENESEED') {
  const [begin, end] = delimiters(blockId);
  const block = `${begin}\n${stripEnd(content)}\n${end}\n`;
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
  const rest = stripEnds(`${stripTrailingNewlines(pre)}\n${lstripNewlines(post)}`);
  if (rest) writeText(p, `${rest}\n`);
  else unlinkSync(p);
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

// `str.strip()` and friends. JS's `trim()` is NOT `strip()`, and the difference runs both
// ways: `trim()` eats U+FEFF, which Python does not strip, and Python strips U+0085 and
// U+001C–U+001F, which `trim()` leaves. A managed block is user-editable prose in a file
// Geneseed shares with the user, so the set is spelled out rather than approximated — and
// spelled with escapes, never literals: a raw U+2028 in a JS source file ends the line.
const WHITESPACE = '[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a'
  + '\u2028\u2029\u202f\u205f\u3000]';

const RSTRIP_RE = new RegExp(`${WHITESPACE}+$`);
const LSTRIP_RE = new RegExp(`^${WHITESPACE}+`);

function stripEnd(s) {
  return s.replace(RSTRIP_RE, '');
}

function stripEnds(s) {
  return s.replace(LSTRIP_RE, '').replace(RSTRIP_RE, '');
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
