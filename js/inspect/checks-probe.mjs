/**
 * `geneseed doctor --probe` — prove each installed gate still REFUSES, not just that it exists.
 *
 * A gate that is registered, launches and then allows everything looks exactly like a working
 * one: `onFailure: "block"` (ADR 0007) covers a gate that never starts, `shimProblems` covers the
 * shim's paths and `hookShellProblems` infers shell drift — none of them observes a verdict. So
 * this runs each live install's own gate command, AS ITS SETTINGS SPELL IT, through the shell
 * the host would use, on two canned payloads: one Law IV call that every build must refuse
 * (`git reflog expire --expire=now --all`, Law IV in Bob's `BLOCK_RULES`) and one that must pass (`git status`).
 * A gate wired `--no-deletion-gate` passes the Law IV call by design, so `badCommandFor` swaps in a
 * root-wide scan (ops 2) it must still refuse — a disarmed install is not a gate that stopped working.
 * Both directions are judged, because "allows everything" and "refuses everything" (the
 * PowerShell-fallback case `hookShellProblems` can only infer) are both broken gates.
 *
 * WHY THIS SPAWNS, and why it is opt-in. ADR 0002 allows a CLI spawn only as a declared row of
 * `ALLOWED_SPAWNS` (`tests/unit/hook_cli.test.mjs`); this is the row that runs INSTALLED code
 * rather than the checkout's, which is why it waits for `--probe` instead of riding every
 * `doctor`. It runs only a command that `liveRecordedHooks` returns — recorded in our own
 * manifest AND live in the settings — and that still carries `geneseed-hook`, a gate verb and
 * `--root`; anything else is reported and never run. Nothing the payloads name is executed:
 * the gate only reads them, from an empty temp dir.
 *
 * WHAT A PASS DOES NOT CLAIM. The probe runs under doctor's environment — this terminal's PATH
 * and HOME — not the host app's. A host launched with a different environment (an empty HOME, a
 * PATH without the shell's tools) can still break a gate that passes here.
 *
 * `GENESEED_GATE_PROBE=1` keeps the probe's asks out of the gate ledger (`ledger()` in
 * `js/hosts/hooks.mjs`), so `status` never counts a doctor run as a refusal.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { liveRecordedHooks } from '../hosts/hosts.mjs';
import { claudeCfg, installState, installTargets } from '../hosts/installs.mjs';
import { SHIM_MARK, claudeGitBashPath } from '../hosts/shim.mjs';
import { which } from '../lib/paths.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import { NOTE, withTempDir, withTempDirAsync } from './scan.mjs';
import { spawnSync } from 'node:child_process';

/**
 * The gate that refuses Law IV on each host (`claudeHookGroups`, `js/hosts/settings.mjs`). On
 * Claude and OpenClaude it is `git-gate`; `tool-gate` there only counts Skill/Agent calls. Bob
 * runs everything through `tool-gate --host bob`. OpenCode's guard is an in-process plugin with
 * no command: `guardProbe` below imports it instead.
 */
const PROBED_VERB = { claude: 'git-gate', openclaude: 'git-gate', bob: 'tool-gate' };

// A Law IV act that loses data in EVERY state: since the gate asks only on real loss
// (2026-10-17), a state-dependent act such as `reset --hard` would pass on a clean tree.
export const BAD_COMMAND = 'git reflog expire --expire=now --all';
// An install built `--no-deletion-gate` passes BAD_COMMAND by design, so its gate is probed on
// what it must still refuse: a recursive scan of a whole filesystem (ops 2, in Bob's
// `BLOCK_RULES` too).
export const DISARMED_BAD_COMMAND = 'find / -name geneseed-probe';
/** The must-refuse payload for one gate command, as its own flags say it is wired. */
export const badCommandFor = (command) => (/ --no-deletion-gate(?:\s|$)/.test(command)
  ? DISARMED_BAD_COMMAND : BAD_COMMAND);
export const GOOD_COMMAND = 'git status';

const PROBE_TIMEOUT_MS = 20_000;

/** A PreToolUse payload in Claude's shape — the shape every probed host's gate reads. */
function probePayload(command, cwd) {
  return JSON.stringify({
    session_id: 'geneseed-probe', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command }, cwd,
  });
}

/**
 * The shell a host runs this handler under, as `{ exe, argv, label, verbatim }` — or null when
 * that shell is not on this machine. Mirrors the emit's own rule: an explicit
 * `shell: "powershell"` wins; Bob runs `cmd /c` on Windows; Claude/OpenClaude run Git Bash
 * there (`claudeGitBashPath`, the rule `claudeHookShell` uses); `sh -c` everywhere else.
 */
function probeShell(host, handler, platform = process.platform, env = process.env) {
  const cmd = handler.command;
  if (handler.shell === 'powershell') {
    const ps = which('powershell') || which('pwsh');
    return ps ? { exe: ps, argv: ['-NoProfile', '-NonInteractive', '-Command', cmd], label: 'PowerShell' }
      : null;
  }
  if (platform !== 'win32') return { exe: which('sh') || '/bin/sh', argv: ['-c', cmd], label: 'sh' };
  if (host === 'bob') {
    // `/s /c "<cmd>"` with verbatim arguments: cmd strips the outer quotes and keeps the
    // command's own quoting. Node's default quoting would turn its `"` into `\"`, which cmd
    // does not unescape.
    const cmdExe = env.ComSpec || env.COMSPEC || which('cmd');
    return cmdExe ? { exe: cmdExe, argv: ['/d', '/s', '/c', `"${cmd}"`], label: 'cmd', verbatim: true }
      : null;
  }
  const bash = claudeGitBashPath(env);
  return bash ? { exe: bash, argv: ['-c', cmd], label: 'Git Bash' } : null;
}

const ASK_RE = /"permissionDecision":\s*"(?:ask|deny)"/;

/** Did the gate refuse? Exit 2 on Bob; on Claude-shaped hosts exit 2 or an ask/deny verdict. */
export function refused(host, r) {
  if (host === 'bob') return r.status === 2;
  return r.status === 2 || (r.status === 0 && ASK_RE.test(r.stdout || ''));
}

/**
 * The verdict for one gate, from its two runs — null when the gate is sound, or the problem.
 * Pure, so the whole verdict table is pinned without spawning.
 */
export function probeVerdict(host, bad, good, badCommand = BAD_COMMAND) {
  for (const r of [bad, good]) {
    if (r.status !== 0 && r.status !== 2) {
      const why = r.error ? r.error : `exit ${r.status}`;
      const tail = (r.stderr || '').trim().split(/\r?\n/).pop();
      return `does not run (${why}${tail ? `: ${tail}` : ''})${host === 'claude'
        ? ' — Claude blocks every matching call while this lasts (onFailure: block)'
        : ' — the host lets every call through while this lasts'}`;
    }
  }
  if (!refused(host, bad)) return `registered but not refusing — \`${badCommand}\` went through`;
  if (refused(host, good)) return `refuses everything — \`${GOOD_COMMAND}\` was refused too`;
  return null;
}

/** Is this recorded command one of ours for `verb`? A gate verb, `--root`, and our shim. */
export function isOurGate(command, verb) {
  return command.includes(` ${verb} --root`) && command.includes(SHIM_MARK);
}

/** One spawn of one handler on one payload. THE ONE SPAWN of this module. */
function runOnce(shell, payload, cwd, env) {
  const r = spawnSync(shell.exe, shell.argv, {
    input: payload, cwd, env, encoding: 'utf-8', timeout: PROBE_TIMEOUT_MS,
    windowsVerbatimArguments: Boolean(shell.verbatim), ...NO_WINDOW,
  });
  const e = /** @type {NodeJS.ErrnoException | undefined} */ (r.error);
  const error = e ? (e.code === 'ETIMEDOUT' ? 'timed out' : e.message) : null;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error };
}

/**
 * Probe every live Claude-shaped install. Returns `{ problems, probed }`: `problems` in
 * doctor's line format, `probed` the labels of the gates that ran and behaved.
 * `targets`, `platform` and `env` are parameters so a test hands it a sandboxed install.
 */
export function gateProbe(targets = installTargets(), { platform = process.platform, env = process.env } = {}) {
  const problems = [];
  const probed = [];
  for (const [host, scope, root] of targets) {
    const verb = PROBED_VERB[host];
    if (!verb || installState(root, host, scope) !== 'active') continue;
    const cfg = claudeCfg(root, scope, host);
    const gates = liveRecordedHooks(cfg)
      .filter(([event, h]) => event === 'PreToolUse' && h.command.includes(` ${verb} --root`));
    if (!gates.length) {
      problems.push(`[probe] ${cfg}: no live ${verb} hook in its settings — nothing refuses `
        + 'a destructive call at the boundary — run: geneseed rebuild-all');
      continue;
    }
    for (const [, handler] of gates) {
      const label = `[probe] ${cfg}: ${verb}`;
      if (!isOurGate(handler.command, verb)) {
        problems.push(`${label} not probed — its command does not run ${SHIM_MARK}, and doctor `
          + 'runs nothing else from a settings file');
        continue;
      }
      const shell = probeShell(host, handler, platform, env);
      if (!shell) {
        problems.push(`${label} does not run — the shell ${host} would use is not on this machine`);
        continue;
      }
      const verdict = withTempDir((tmp) => {
        const runEnv = { ...env, GENESEED_GATE_PROBE: '1', CLAUDE_PROJECT_DIR: tmp };
        const badCommand = badCommandFor(handler.command);
        const bad = runOnce(shell, probePayload(badCommand, tmp), tmp, runEnv);
        const good = runOnce(shell, probePayload(GOOD_COMMAND, tmp), tmp, runEnv);
        return probeVerdict(host, bad, good, badCommand);
      }, 'geneseed-probe-');
      if (verdict) problems.push(`${label} under ${shell.label} ${verdict}`);
      else probed.push(`${path.normalize(cfg)} (${verb}, ${shell.label})`);
    }
  }
  return { problems, probed };
}

// ---- OpenCode: the guard plugin, probed in-process ------------------------------------------

const GUARD_PLUGIN = 'geneseed-guard.js';
/** The guard blocks catastrophic shell (`catastrophic()`); destructive git is the permission
 * prompt's job there, and only WARNS in the guard — so its must-refuse payload is this one. */
const GUARD_BAD_COMMAND = 'rm -rf /';

/** The guard plugin of an OpenCode install: `<global>/plugins/` or `<repo>/.opencode/plugins/`
 * (`emitOpencodeInto` copies the plugins to `<dir>/plugins`). */
export function guardPluginPath(root, scope) {
  return path.join(scope === 'global' ? root : path.join(root, '.opencode'), 'plugins', GUARD_PLUGIN);
}

/** Run `fn` with stderr swallowed and `GENESEED_GATE_PROBE` set, both restored after. */
async function quietProbe(fn) {
  const write = process.stderr.write;
  const saved = process.env.GENESEED_GATE_PROBE;
  process.stderr.write = () => true;
  process.env.GENESEED_GATE_PROBE = '1';
  try { return await fn(); } finally {
    process.stderr.write = write;
    if (saved === undefined) delete process.env.GENESEED_GATE_PROBE;
    else process.env.GENESEED_GATE_PROBE = saved;
  }
}

/**
 * Both plugin APIs, each on both payloads: `{ v1: [badRefused, goodRefused], v2: [...] }`.
 * V1 (`server`) refuses by THROWING `[geneseed-guard] …`; V2 (`setup`) by RENAMING the call
 * (`setupV2`'s docblock). An unexpected throw is not a refusal — it is rethrown, and the caller
 * reports the guard as broken.
 */
async function runGuard(mod, cwd) {
  const v1 = async (command) => {
    const hooks = await mod.server({ worktree: cwd, directory: cwd });
    try {
      await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command } });
      return false;
    } catch (e) {
      if (String(e?.message || '').startsWith('[geneseed-guard]')) return true;
      throw e;
    }
  };
  const v2 = async (command) => {
    /** @type {((event: { tool: string }) => Promise<void>) | null} */
    let hook = null;
    await mod.setup({
      location: { project: { directory: cwd }, directory: cwd },
      tool: { hook: (name, fn) => { if (name === 'execute.before') hook = fn; } },
    });
    if (!hook) throw new Error('setup registered no execute.before hook');
    const event = { tool: 'bash', input: { command } };
    await hook(event);
    return event.tool !== 'bash';
  };
  return {
    v1: [await v1(GUARD_BAD_COMMAND), await v1(GOOD_COMMAND)],
    v2: [await v2(GUARD_BAD_COMMAND), await v2(GOOD_COMMAND)],
  };
}

/** The verdict for one API's pair — null when sound. */
function guardVerdict([badRefused, goodRefused]) {
  if (!badRefused) return `registered but not refusing — \`${GUARD_BAD_COMMAND}\` went through`;
  if (goodRefused) return `refuses everything — \`${GOOD_COMMAND}\` was refused too`;
  return null;
}

/**
 * Probe every live OpenCode install's guard plugin by importing it into this process and
 * calling its hooks — no spawn. Proves the installed FILE and its logic under Node, not under
 * OpenCode's runtime (the weekly host canary proves the plugin loads there). Returns
 * `{ problems, probed }` like `gateProbe`; a guard this environment switched off
 * (`GENESEED_GUARD=off|warn`) is a NOTE, not a failure — that switch is the user's.
 *
 * Only a file named `geneseed-guard.js` in an install `installState` recognises is imported,
 * and only one whose default export is `{ id: 'geneseed-guard', server, setup }`.
 */
export async function guardProbe(targets = installTargets(), env = process.env) {
  const problems = [];
  const probed = [];
  for (const [host, scope, root] of targets) {
    if (host !== 'opencode' || installState(root, host, scope) !== 'active') continue;
    const file = guardPluginPath(root, scope);
    const label = `[probe] ${file}`;
    if (!existsSync(file)) {
      problems.push(`${label}: no guard plugin — nothing refuses a catastrophic command at the `
        + 'boundary — run: geneseed rebuild-all');
      continue;
    }
    const mode = String(env.GENESEED_GUARD || 'on').toLowerCase();
    if (['off', '0', 'false', 'no', 'warn'].includes(mode)) {
      problems.push(`${NOTE}${label}: not probed — GENESEED_GUARD=${mode} in this environment `
        + 'switches the guard off');
      continue;
    }
    let verdicts;
    try {
      // ESM under OpenCode's typeless package.json: parses only with syntax detection (Node >=
      // 22.7, the floor). Its MODULE_TYPELESS_PACKAGE_JSON warning fires a tick later, inside
      // quietProbe's stderr swap, so the doctor never prints it.
      const mod = (await import(pathToFileURL(file).href)).default;
      if (mod?.id !== 'geneseed-guard' || typeof mod.server !== 'function' || typeof mod.setup !== 'function') {
        problems.push(`${label}: not probed — it does not export the Geneseed guard `
          + '({ id, server, setup }) — run: geneseed rebuild-all');
        continue;
      }
      verdicts = await withTempDirAsync(
        (tmp) => quietProbe(() => runGuard(mod, tmp)), 'geneseed-probe-');
    } catch (e) {
      problems.push(`${label}: does not run (${e?.message || e})`);
      continue;
    }
    const bad = [['V1', guardVerdict(verdicts.v1)], ['V2', guardVerdict(verdicts.v2)]]
      .filter(([, v]) => v);
    for (const [api, v] of bad) problems.push(`${label}: guard (OpenCode ${api} hook) ${v}`);
    if (!bad.length) probed.push(`${path.normalize(file)} (guard, in-process)`);
  }
  return { problems, probed };
}
