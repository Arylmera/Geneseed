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
  chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  jsonDumps, jsonDumpsCompact, jsonDumpsIndent, parseJson, pyEq, pyRepr, indexOfEq,
  readText, writeText,
} from './lib/pyfs.mjs';

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

/** `_build_settings._default_permission`. */
export function defaultPermission() {
  return {
    bash: {
      'rm -rf *': 'ask',
      'git commit*': 'ask',
      'git push*': 'ask',
      'git push --force*': 'ask',
      'git push -f*': 'ask',
    },
  };
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

/** `_build_settings._warn_commented_jsonc`. Prints to STDOUT — the Python's own choice. */
export function warnCommentedJsonc(target, agentPath, includePermission,
  includeLsp = false, prefix = 'geneseed') {
  process.stdout.write(`[${prefix}] ${path.basename(target)} has comments — not rewriting `
    + 'it (your edits are kept). Add this to its "instructions" array by hand:\n');
  process.stdout.write(`[${prefix}]     ${jsonDumps(agentPath)}\n`);
  if (includePermission) {
    process.stdout.write(`[${prefix}] and, for Geneseed's default ask-gates, a `
      + '"permission" key:\n');
    for (const line of jsonDumpsIndent(defaultPermission()).split('\n')) {
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
export function mergeOpencodeJson(p, agentPath) {
  const target = opencodeTarget(p);
  let config = { $schema: OPENCODE_SCHEMA, instructions: [] };
  let hadComments = false;
  if (existsSync(target)) {
    let raw;
    try {
      raw = readText(target);
    } catch (e) {
      if (!isOsError(e)) throw e;
      process.stderr.write(`[geneseed] WARN: could not read ${target} (${pyOsError(e)}) `
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
  const addInstr = indexOfEq(instr, agentPath) < 0;
  if (addInstr) instr.push(agentPath);
  config.instructions = instr;
  const addPerm = !has(config, 'permission');
  if (addPerm) config.permission = defaultPermission();
  const addLsp = !has(config, 'lsp');
  if (addLsp) config.lsp = true;
  if (!addInstr && !addPerm && !addLsp) return target;
  if (path.extname(target) === '.jsonc' && hadComments) {
    warnCommentedJsonc(target, agentPath, addPerm, addLsp);
    return target;
  }
  try {
    atomicWriteJson(target, config);
  } catch (e) {
    if (!isOsError(e)) throw e;
    process.stderr.write(`[geneseed] WARN: could not write ${target} (${pyOsError(e)}) — `
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
function pyOsError(e) {
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

/** `Path(x).expanduser()` — only the `~` and `~/…` forms Python expands with no username. */
function expanduser(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
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
  const shim = writeHookShim(p, hookShimBody(runner, entry, platform), platform);
  if (shim !== null) return `"${shim}"`;
  process.stderr.write(`[geneseed] WARN: could not write the hook shim at ${p} — emitting `
    + 'hooks that call the interpreter directly. They will break if this checkout moves; '
    + 're-run the build to repair them.\n');
  return `"${runner}" "${entry}"`;
}

/** `_build_settings._claude_hook_groups` — Geneseed's Claude hooks, keyed by event. */
export function claudeHookGroups(cfg, hookOpts) {
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
      { matcher: 'Bash', hooks: [{ type: 'command', command: gate }] },
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
export function mergeClaudeSettings(p, scope = 'global', priorHooks = null, hookOpts = {}) {
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
  const canonical = claudeHookGroups(path.dirname(p), hookOpts);
  const canonFlat = [];
  for (const [event, groups] of Object.entries(canonical)) {
    for (const g of groups) canonFlat.push({ event, group: g });
  }
  let pruned = false;
  for (const rec of prior) {
    if (indexOfEq(canonFlat, rec) >= 0) continue;
    const event = get(rec, 'event');
    const group = get(rec, 'group');
    const arr = get(hooks, event);
    if (Array.isArray(arr)) {
      const at = indexOfEq(arr, group);
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
      if (indexOfEq(arr, g) >= 0) continue;
      arr.push(g);
      added.push({ event, group: g });
    }
    hooks[event] = arr;
  }
  const survivors = prior.filter((r) => indexOfEq(canonFlat, r) >= 0);
  const managedNow = survivors.concat(added.filter((a) => indexOfEq(survivors, a) < 0));
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
      const at = indexOfEq(arr, group);
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
  const added = want.filter((e) => indexOfEq(cur, e) < 0);
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
    process.stderr.write(`[geneseed] WARN: could not write ${p} (${pyOsError(e)}) — `
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
    const at = indexOfEq(cur, e);
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
    problems.push(`${p}: could not read the file (${pyOsError(e)})`);
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
    const hit = presentGroups.some(([e, g]) => pyEq(e, event) && pyEq(g, group));
    if (expect === 'present' && !hit) {
      problems.push(`${p}: recorded hook group missing — event=${pyRepr(event ?? null)} `
        + `group=${jsonDumpsCompact(group ?? null)}`);
    } else if (expect === 'absent' && hit) {
      problems.push(`${p}: recorded hook group still present after unwire — `
        + `event=${pyRepr(event ?? null)} group=${jsonDumpsCompact(group ?? null)}`);
    }
  }

  let exclCur = get(loaded, 'claudeMdExcludes');
  exclCur = Array.isArray(exclCur) ? exclCur : [];
  for (const entry of (get(m, 'settings_excludes') || [])) {
    const hit = indexOfEq(exclCur, entry) >= 0;
    if (expect === 'present' && !hit) {
      problems.push(`${p}: recorded claudeMdExcludes entry missing: ${pyRepr(entry)}`);
    } else if (expect === 'absent' && hit) {
      problems.push(`${p}: recorded claudeMdExcludes entry still present after unwire: `
        + `${pyRepr(entry)}`);
    }
  }

  // Geneseed-PATTERN entries present but not in the recorded claim set — warn only, never
  // auto-delete (they may be user-authored, or a claim this run legitimately did not
  // inherit).
  const recordedSet = new Set(recordedHooks.map(
    (r) => `${pyRepr(get(r, 'event') ?? null)}\u0000`
      + `${jsonDumpsCompact(get(r, 'group') ?? null, { sortKeys: true })}`));
  for (const [event, group] of presentGroups) {
    const key = `${pyRepr(event)}\u0000${jsonDumpsCompact(group, { sortKeys: true })}`;
    if (recordedSet.has(key)) continue;
    const cmds = (get(group, 'hooks') || []).filter(isDict)
      .map((h) => (has(h, 'command') ? h.command : ''));
    if (cmds.some((c) => typeof c === 'string'
      && GENESEED_HOOK_SNIFF.some((mk) => c.includes(mk)))) {
      problems.push(`${p}: Geneseed-pattern hook present but NOT recorded in the manifest `
        + `(event=${pyRepr(event)}) — possibly user-authored; left alone`);
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
  const block = `${begin}\n${pyRstrip(content)}\n${end}\n`;
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
  const rest = pyStrip(`${pyRstripNewlines(pre)}\n${lstripNewlines(post)}`);
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
const PY_SPACE = '[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a'
  + '\u2028\u2029\u202f\u205f\u3000]';

const RSTRIP_RE = new RegExp(`${PY_SPACE}+$`);
const LSTRIP_RE = new RegExp(`^${PY_SPACE}+`);

function pyRstrip(s) {
  return s.replace(RSTRIP_RE, '');
}

function pyStrip(s) {
  return s.replace(LSTRIP_RE, '').replace(RSTRIP_RE, '');
}

function lstripNewlines(s) {
  return s.replace(/^\n+/, '');
}

function pyRstripNewlines(s) {
  return s.replace(/\n+$/, '');
}

function stripNewlines(s) {
  return lstripNewlines(pyRstripNewlines(s));
}
