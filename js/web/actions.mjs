/**
 * The web console's WRITES — the mutating endpoints, plus the one GET that belongs beside them
 * (`apiMcp`). The fingerprint-guarded rules and profile editors are `user-files.mjs`.
 *
 * `{cmd: [...]}`, returned by `apiInstallCmd` and `apiDeployCmd` below, IS A FUNCTION'S
 * RETURN TYPE, NOT A RESPONSE BODY: the dispatcher hands it straight to the job runner in
 * the same process, and the client only ever sees a `job_id` at 202 or an `error`. That is
 * why the argv head is `process.execPath` + `bin/build-driver.mjs` — the honest command for
 * the runtime this actually runs on.
 *
 * ---------------------------------------------------------------------------------------
 * `apiPickFolder` CROSSED 2026-08-27 — a user override of the permanent decline this section
 * used to record (why a folder dialog looked permanently un-portable lives in git history,
 * under `DECLINED_POST` in `js/web/routes.mjs`). See `apiPickFolder`'s own docblock, below,
 * for the argv, the async-spawn reasoning, and why it dispatches inline from
 * `js/web/handler.mjs` rather than through `POST_ROUTES`.
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
import { spawn } from 'node:child_process';
import {
  accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync,
  renameSync, rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { emitGlobalInto } from '../build/driver.mjs';
import {
  ROOT, discoverNames, knownRuleIds, loadKits, PACK_ORDER,
} from '../build/source.mjs';
import { diffCollect, drifted, withStdoutSwallowed } from '../inspect/diff.mjs';
import { SESSION_FILES } from '../hosts/hooks-context.mjs';
import { excludeAdd, excludeRemove } from '../inspect/excludes.mjs';
import { installProfile, setupBuildArgs } from '../build/generate.mjs';
import { DEFAULT_PRESET, PRESETS } from '../loop/score.mjs';
import { activeLoops, setLoopPreset } from '../loop/registry.mjs';
import {
  HOSTS, bobConfigDir, claudeConfigDir, expanduser, openclaudeConfigDir,
  opencodeConfigDir, resolvePath,
} from '../hosts/hosts.mjs';
import {
  EMIT_HOST_SCOPE, doctrinesForBuild, excludedRulesOfDir, excludedSkillsOfDir, kitsOfDir,
  footprintOfDir, gatesOfDir,
  installState, installTargets, legacyProcessCarrierOfDir, modeOfDir, postureOfDir, themeOfDir,
  trustOfDir,
} from '../hosts/installs.mjs';
import {
  isDict, mcpCommented, mcpInstallTargets, mcpLoad, mcpServerNames, mcpState,
} from '../hosts/mcp.mjs';
import { isFile, isDir } from '../lib/fs.mjs';
import { formatRepr, formatValue, isTruthy } from '../lib/json.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import { normcase, which, within } from '../lib/paths.mjs';
import { stripWhitespace } from '../lib/text.mjs';
import { memoryDelete } from '../maintain/memory.mjs';
import { installDeactivate, installReactivate, installUninstall } from '../maintain/uninstall.mjs';
import { emitChoices, themeChoices, viewCfg } from './api.mjs';
import { actionCommands } from './jobs.mjs';
import { NotFound, deployed, memoryDir } from './catalog.mjs';

/** One body field, `dflt` when the body is not an object or does not carry the key. */
export const bget = (body, key, dflt = null) => (isDict(body) && Object.hasOwn(body, key)
  ? body[key] : dflt);

export const strOr = (v) => (isTruthy(v) ? formatValue(v) : '');

/**
 * A request body's LIST field closed against `known()` member by member, re-ordered through
 * `order()`, or `null` for "said nothing usable" — the shared shape of the two doctrine axes
 * below. `norm` rewrites a member before the check (the rule axis accepts `process 7`).
 *
 * `known`/`order` are thunks so a body that names nothing never pays for discovery.
 */
function bodyList(body, key, known, order = known, norm = (n) => n) {
  const raw = bget(body, key);
  if (Array.isArray(raw) && !raw.length) return [];
  const names = Array.isArray(raw) ? raw
    : (typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null);
  if (names === null || !names.length) return null;
  if (names.length === 1 && names[0] === 'none') return [];
  const ids = names.map((n) => (typeof n === 'string' ? norm(n) : n));
  const ok = known();
  if (!ids.every((n) => typeof n === 'string' && ok.includes(n))) return null;
  return order().filter((id) => ids.includes(id));
}

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
  return bodyList(body, 'doctrines', () => discoverNames('doctrines', PACK_ORDER[0]),
    () => PACK_ORDER);
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
  return bodyList(body, 'excludeRules', knownRuleIds, knownRuleIds,
    (n) => n.trim().replace(/[ \t]+/, '.'));
}

/**
 * A request body's `kits` — REPLACES the install's kits (the Kits tab sends the whole set it
 * wants): `[]`/`'none'` give `[]`, an omitted key gives `null` (keep the install's own), and an
 * unknown name gives `null` too, which `apiInstallCmd` refuses for a body that HAS the key.
 */
function bodyKits(body) {
  return bodyList(body, 'kits', () => [...loadKits().keys()]);
}

/**
 * The gate switches across the trust boundary (`deletionGate`, `secretsGate`, `doneGate`), each
 * on its own: only a real JSON boolean counts. Anything else — a string `"false"`, a number,
 * absence — falls back to the install's own answer for THAT gate, so a malformed or partial body
 * can never disarm (or re-arm) a gate it did not name.
 */
function bodyGates(body, root, host) {
  const own = gatesOfDir(root, host);
  return Object.fromEntries(Object.entries(own).map(([k, v]) => {
    const said = bget(body, k);
    return [k, typeof said === 'boolean' ? said : v];
  }));
}

/**
 * The five scalar axes of a build request — theme, footprint, posture, mode, trust — each
 * taken from the body only when it names a value this checkout ships, else from `dflt`. The
 * SAME allowlist for `apiInstallCmd` and `apiDeployCmd`; they differ only in their defaults (the
 * install's own markers, versus a fresh deploy's). A bogus body value never reaches the argv.
 */
function bodyAxes(body, dflt) {
  const pick = (key, ok) => { const v = bget(body, key); return ok(v) ? v : dflt[key]; };
  return {
    theme: pick('theme', (v) => themeChoices().some((c) => c.name === v)),
    footprint: pick('footprint', (v) => v === 'lean' || v === 'full'),
    posture: pick('posture', (v) => discoverNames('postures', 'peer').includes(v)),
    mode: pick('mode', (v) => discoverNames('modes', 'direct').includes(v)),
    trust: pick('trust', (v) => Object.keys(PRESETS).includes(v)),
  };
}

/**
 * The DETECTED install a body's (host, path) pair names — `[host, scope, root]` — or a
 * `NotFound`. THE ALLOWLIST three endpoints share (view select, rebuild, deactivate/remove), and
 * one copy of it: two copies of a security check drift, and the copy that drifts is the one
 * nobody re-read.
 *
 * The pair is SERIALISED into the key rather than concatenated with a separator: the path comes
 * straight out of a request body, and any separator it could contain would let one pair
 * impersonate another. `findLast` keeps the old Map's last-write-wins on a duplicate pair.
 */
function detectedInstall(body) {
  const want = JSON.stringify([strOr(bget(body, 'host')), strOr(bget(body, 'path'))]);
  const hit = installTargets()
    .findLast(([host, , root]) => JSON.stringify([host, String(root)]) === want);
  if (hit === undefined) throw new NotFound('unknown install (host, path)');
  return hit;
}

// ---- OS-native folder picker ---------------------------------------------------------------

/**
 * ms before an open dialog is abandoned. The Python original's 300 s, kept as a named
 * constant rather than a literal in the spawn call. `GENESEED_PICK_TIMEOUT_MS` is a TEST HOOK
 * ONLY — it overrides the constant so the timeout path can be proven in seconds instead of
 * five minutes (nobody is at the dialog to cancel it in an automated run); the 300 s default
 * ships untouched for a real daemon.
 */
// `Number.isFinite`, not `||`: the latter would ignore an explicit `GENESEED_PICK_TIMEOUT_MS=0`
// (falsy) and fall back to the 300 s default, which defeats a test that wants a timeout of 0.
const pickTimeoutOverride = Number(process.env.GENESEED_PICK_TIMEOUT_MS);
const PICK_TIMEOUT_MS = Number.isFinite(pickTimeoutOverride) ? pickTimeoutOverride : 300_000;

// A SINGLE STABLE LITERAL, never built from a request: `apiPickFolder` takes no client input
// at all (the endpoint's whole POST body is ignored), so there is nothing to interpolate into
// this command line in the first place — and `tests/unit/hook_cli.test.mjs`'s spawn allow-list
// asserts this exact string, which only holds while that stays true. `-STA`: a WinForms dialog
// needs the single-threaded apartment; `-NoProfile`: skip the user's `$PROFILE` script, which
// this one-shot invocation has no business running.
const PICK_SCRIPT_WIN = 'Add-Type -AssemblyName System.Windows.Forms; '
  + '$d = New-Object System.Windows.Forms.FolderBrowserDialog; '
  + 'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) '
  + '{ Write-Output $d.SelectedPath }';

// Ported VERBATIM from the deleted Python (`git show 8860c72:rituals/_web_actions.py`,
// `api_pick_folder`) — same prompt text, same AppleScript shape. `choose folder` is a
// StandardAdditions command that runs in-process inside `osascript`, so it needs no
// automation-consent prompt the way scripting another app would.
const PICK_SCRIPT_MAC = 'set f to POSIX path of (choose folder with prompt '
  + '"Choose a folder to deploy the harness into")\nreturn f';

/**
 * Spawns `cmd args`, collects stdout/stderr, and calls `resultOf(exitCode, stdout, stderr)` to
 * build the response once the child exits (or is killed on timeout, or never starts at all).
 * `done` fires EXACTLY ONCE regardless of which of those three ends it — timeout, `error`
 * (spawn itself failed, e.g. the binary is not on PATH), or `close` (the normal exit) all race
 * for the same `settled` guard.
 */
function runPicker(cmd, args, done, resultOf) {
  let child;
  try {
    // `...NO_WINDOW`: this call captures stdout/stderr below rather than inheriting them, and
    // `tests/unit/spawn_hygiene.test.mjs` gates every such call site in `js/`/`bin/` on it.
    // Hiding the PowerShell/osascript CONSOLE window is exactly what is wanted here — the GUI
    // dialog itself (`FolderBrowserDialog`, `choose folder`) is a separate Win32/Carbon window
    // neither process's own console visibility controls.
    child = spawn(cmd, args, { ...NO_WINDOW });
  } catch (e) {
    return done({ error: `folder picker unavailable: ${e.message}` });
  }
  let out = '';
  let err = '';
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    done(result);
  };
  const timer = setTimeout(() => { child.kill(); finish({ error: 'folder picker timed out' }); },
    PICK_TIMEOUT_MS);
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  child.on('error', (e) => finish({ error: `folder picker unavailable: ${e.message}` }));
  child.on('close', (code) => finish(resultOf(code, out, err)));
}

/**
 * `/api/pick-folder` — the OS-NATIVE folder chooser, opened ON THE DAEMON HOST. `done` is
 * called with `{path}` on OK, `{cancelled: true}` on cancel, or `{error}` — the shape the
 * client's `pickFolder()` (in `web/src/api/index.js`) already expects, unchanged since the
 * endpoint was DECLINED (see this file's header for that history, overridden by the user
 * 2026-08-27).
 *
 * ASYNC, NEVER `spawnSync`: a folder dialog stays open until a human answers it — seconds to
 * minutes — and a synchronous spawn would block this single-threaded server's event loop for
 * exactly that long, so no OTHER request could be served while the dialog is up. That is also
 * why `js/web/handler.mjs`'s `doPost` calls this INLINE rather than through `POST_ROUTES`:
 * that table's dispatch is `fn(state, body) -> object`, sent to the client the moment `fn`
 * returns — a shape with no room for "answer later," which is exactly what this endpoint does.
 *
 * The daemon must be running IN A DESKTOP SESSION for a dialog to actually appear; headless
 * (no GUI session, or a platform with no branch below), the process still answers — an
 * `{error}` — never a hang, because `runPicker`'s timeout and `error` handlers both fire
 * `done` on their own.
 */
export function apiPickFolder(done) {
  if (process.platform === 'win32') {
    // `which`, never a bare name: Windows resolves a bare name against the cwd first.
    const powershell = which('powershell');
    if (!powershell) return done({ error: 'folder picker unavailable: powershell not on PATH' });
    return runPicker(powershell, ['-NoProfile', '-STA', '-Command', PICK_SCRIPT_WIN], done,
      (code, out, err) => {
        if (code !== 0) return { error: (err || out).trim() || 'folder picker failed' };
        const p = out.trim();
        return p ? { path: p } : { cancelled: true };
      });
  }
  if (process.platform === 'darwin') {
    return runPicker('osascript', ['-e', PICK_SCRIPT_MAC], done, (code, out, err) => {
      if (code === 0) return { path: out.trim() };
      if (err.includes('-128') || err.includes('User canceled')) return { cancelled: true };
      return { error: err.trim() || 'folder picker failed' };
    });
  }
  return done({ error: 'no native folder dialog on this platform' });
}

// ---- memory ------------------------------------------------------------------------------

/**
 * One fact file, and its line in the MEMORY.md index. The file is ARCHIVED into
 * `memory/archive/`, never unlinked: the console has no purge, `geneseed memory rm --purge` does.
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
  // `memoryDelete` is the `geneseed memory rm` engine, and its reserved-name check is
  // CASE-FOLDED: this endpoint's own compared `MEMORY` exactly, so on Windows and macOS `memory`
  // resolved to MEMORY.md, passed, and deleted the index the agent reads at session start.
  if (memoryDelete(d, name) === null) throw new NotFound(name);
  // The doctor reads nothing in the memory store, so its cached verdict survives (`refresh`).
  state.refresh({ doctor: false });
  return { archived: name };
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

// ---- loop preset picker ---------------------------------------------------------------------

/**
 * The Active tab's one write: rewrite a registered worktree's `LOOP.md` `preset` field.
 * `POST /api/loops/preset` makes two refusals — a `preset` outside `PRESETS` and a `root` that is
 * not a running registered loop (no arbitrary path writes) — and both are decided HERE, as the
 * `NotFound` every other mutating route answers in, so the handler's catch (`4xx`, not the 500 a
 * bare `Error` would fall to) covers this route the way it covers `apiRulesMutate`'s unknown id.
 *
 * DECIDED, NOT RECOGNISED. This route used to call `setLoopPreset` and sort its throws by their
 * MESSAGE text, so rewording an error in `js/loop/registry.mjs` would have turned a 404 into a
 * 500 with no test of this file noticing. "Running" is `activeLoops`' word for it — registered,
 * still a directory, `LOOP.md` present (a corrupt one included, so that it reaches the parse and
 * fails there) — matched on the root the registry stores, which is the realpath. The preset is
 * checked first: `activeLoops` may prune the registry, and a refused preset must touch nothing
 * (`tests/unit/web_server.test.mjs` probes this route against the real machine's registry).
 * Anything `setLoopPreset` still throws, a corrupt `LOOP.md` above all, is a 500.
 */
export function apiLoopsPresetMutate(state, body) {
  const root = strOr(bget(body, 'root'));
  const preset = strOr(bget(body, 'preset'));
  if (!Object.hasOwn(PRESETS, preset)) throw new NotFound(`unknown preset ${JSON.stringify(preset)}`);
  let key;
  try { key = realpathSync.native(root); } catch { key = path.resolve(root); }
  const running = root && activeLoops().some((l) => l.status !== 'finished'
    && normcase(l.root) === normcase(key));
  if (!running) throw new NotFound('unknown loop');
  return { ok: true, loop: setLoopPreset(root, preset) };
}

// ---- MCP ----------------------------------------------------------------------------------

/**
 * The MCP servers each active install ALREADY has, and nothing it could have. Read-only by
 * decision (2026-10): which servers to wire depends on the user and on the host, so the console
 * shows what is in each config and where that file lives, and the user edits it. There is no
 * preset to add and no toggle, so nothing here ever rewrites a config — including
 * `~/.claude.json`, which holds far more than MCP wiring.
 */
export function apiMcp() {
  const out = [];
  for (const [label, p, host, scope, root] of mcpInstallTargets()) {
    if (installState(root, host, scope) !== 'active') continue;
    const cfg = mcpLoad(p, host);
    const servers = mcpServerNames(cfg, host)
      .map((name) => ({ name, state: mcpState(cfg, name, host) }));
    out.push({ label, path: p, host, root, exists: isFile(p),
      commented: mcpCommented(p), servers });
  }
  // `default` is kept for response-shape stability; the table nests MCP per install.
  return { targets: out, default: 0 };
}

/**
 * The MCP config paths a request body is allowed to name, as `path -> [path, host]`.
 *
 * `/api/reveal` hands a path to the desktop's file manager, and this allowlist is the whole
 * security of that endpoint: an unlisted path must 404 before anything is opened.
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
  const [host, scope, root] = detectedInstall(body);
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
 * The job steps for a Build POST.
 *
 * A DEPLOYED INSTALL REBUILT IN ITS OWN EMIT TAKES THE ARGV ITS PROFILE OWNS (`installProfile`,
 * the one reader `rebuild-all`, `status` and `upgrade` share), with only the theme the picker
 * chose swapped in. This path used to re-assemble the axes it happened to carry — no gate
 * switches, `--exclude-rules none`, no excluded skills — so a console Build silently re-armed
 * every switched-off gate and handed back every rule and skill its owner had left out.
 *
 * Nothing deployed (the first-deploy Onboarding form) or a re-target to another emit has no
 * install of that emit to honour — a re-target is a FRESH target, by decision (2026-10-18), so it
 * deliberately carries none of this install's switches or exclusions — and keeps the defaults it
 * always had: footprint, posture
 * and mode off the viewed dir, and ALL packs when unknown — never `harness.config.json`, which
 * would drop the consent gate.
 */
export function buildActionCmds(state, body) {
  const [theme, emit] = buildOverride(state, body);
  const [host, scope] = EMIT_HOST_SCOPE.get(state.emit || '') ?? [];
  if (host && deployed(state) && emit === state.emit) {
    // `setupBuildArgs` always leads with `--theme <theme>`, so the swap is the head alone.
    // `state.root`, not `target`: a project install's markers live at the repo root.
    const [, , ...rest] = installProfile(host, scope, state.root).argv;
    return actionCommands('build', { buildArgv: ['--theme', theme, ...rest] });
  }
  // Only a GLOBAL emit has a home of its own. Any other carries no folder on this route, so the
  // generator fell back to its default `./Harness` — and jobs run with the Geneseed checkout as
  // cwd, so a Bob "project" install landed inside the clone (reported 2026-10), where the doctor's
  // bundle check then read it as 178 missing files. The `deploy` action takes a chosen folder.
  if (!emit.endsWith('-global')) {
    return { error: `${emit} installs into a folder you choose — use Deploy with a folder, `
      + 'not Build' };
  }
  return actionCommands('build', {
    theme, emit, footprint: state.footprint, posture: state.posture, mode: state.mode,
    trust: state.trust,
    doctrines: doctrinesForBuild(state.target),
  });
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
 * The session files' names and their top folders (`memory/`, `notebook/`, …): seed-once, the
 * user's after the first build. Derived from `SESSION_FILES`, the one list of them.
 */
const SEED_FILES = new Set(SESSION_FILES.filter((r) => !r.includes('/')));
const SEED_DIRS = new Set(SESSION_FILES.filter((r) => r.includes('/')).map((r) => r.split('/')[0]));
const isSeedOnce = (rel) => SEED_FILES.has(rel) || SEED_DIRS.has(rel.split('/')[0]);

/**
 * Restore selected drifted files from the SOURCE render.
 *
 * Source wins and local edits are discarded (the inverse, keeping them, is Export
 * improvements). Renders the expected copy exactly as `diffCollect` does, then per rel, BY ITS
 * DIFF STATUS: edited/missing -> overwrite/create the deployed copy; added -> move it into
 * `archived-restore/<stamp>/` inside the install; anything else -> an error and nothing touched.
 *
 * THE CLIENT'S LIST IS A SELECTION, NEVER AN AUTHORITY. Only a rel the drift list offers is
 * acted on, and that list is `diffCollect` with the arguments `apiDiff` passes, so the panel and
 * this verb cannot disagree. Trusting the POST made it a write-or-delete primitive over the whole
 * install (audit SE-1, 2026-10): one request reset `user-rules.md` and the memory index to their
 * stubs, a second unlinked a memory fact and an unrelated secret file. The seed-once files are
 * refused even when a manifest claims them. An added file is ARCHIVED, never unlinked, in the
 * `archived-<name>/<stamp>` shape `archiveStore` gives uninstall; nothing owns the archive, so
 * the next diff does not list it.
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
  let archive = null;
  const target = resolvePath(state.target);
  const offered = new Map(drifted(diffCollect({
    target: state.target, theme: state.theme, emit: state.emit }).files ?? [])
    .map((f) => [f.rel, f.status]));
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
      trust: state.trust,
      // THE PACK SELECTION IS THE FIFTH, and it is the one that makes this verb a BOUNDARY
      // question rather than a cosmetic one. `expected` rendered at all four packs, and this
      // verb COPIES OUT OF IT: restoring AGENT.md onto an install built `--doctrines craft`
      // wrote a carrier stating doctrine process 5 while `claudeHookGroups` had wired no gate
      // behind it — prompt and boundary disagreeing by a WRITE, the write-side twin of the
      // read-side hole `diffCollect` had (and the reason the panel offered the file at all).
      doctrines: doctrinesForBuild(target),
      // The excluded rules for the same boundary reason: without them a restored AGENT.md
      // re-states a rule whose hook gate the install deliberately left unwired.
      excludeRules: excludedRulesOfDir(target),
      excludeSkills: excludedSkillsOfDir(target),
      // The kits: a restored AGENT.md keeps its Kits block and `Active kits:` line.
      kits: kitsOfDir(target),
      // The gate switches: a restored AGENT.md must keep the install's `<gate>: off` lines.
      ...gatesOfDir(target),
    }));
    for (const raw of (isTruthy(files) ? files : [])) {
      const rel = stripWhitespace(formatValue(raw).replace(/\\/g, '/')).replace(/^\/+/, '');
      const dst = resolvePath(path.join(target, rel));
      const src = resolvePath(path.join(expected, rel));
      const status = offered.get(rel);
      if (!rel || !within(dst, target) || !within(src, expected)) {
        errors.push(`${rel}: outside the deployed tree`);
      } else if (!status || isSeedOnce(rel)) {
        errors.push(`${rel}: not a drifted file restore may touch`);
      } else if (status !== 'added' && !isFile(src)) {
        errors.push(`${rel}: not in the source render`);
      } else if (status !== 'added') {
        // Caught per file, so one EISDIR/EBUSY cannot lose the report of the files before it.
        try {
          mkdirSync(path.dirname(dst), { recursive: true });
          // A BYTE copy, so the restored file keeps the render's own line endings rather than
          // the platform's (the `writeText`/`copy2` rule, one file over).
          copyFileSync(src, dst);
          restored.push(rel);
        } catch (e) {
          errors.push(`${rel}: could not restore (${e.code || e.message})`);
        }
      } else {
        // `archiveStore`'s local `YYYYMMDD-HHMMSS` stamp, one per call; a taken name gets `-2`, …
        archive ??= path.join(target, 'archived-restore', new Date().toLocaleString('sv-SE')
          .replace(/\D/g, '').replace(/^(\d{8})/, '$1-'));
        let dest = resolvePath(path.join(archive, rel));
        for (let n = 2; existsSync(dest); n += 1) dest = resolvePath(path.join(archive, `${rel}-${n}`));
        if (!within(dest, archive)) {
          errors.push(`${rel}: outside the archive`);
          continue;
        }
        try {
          mkdirSync(path.dirname(dest), { recursive: true });
          renameSync(dst, dest);
          deleted.push(rel);
        } catch (e) {
          errors.push(`${rel}: could not archive (${e.code || e.message})`);
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  state.refresh();
  return { restored, deleted, errors, archive };
}

/** (host, scope) -> the emit name that installs it. */
const EMIT_FOR = new Map([
  ['opencode global', 'opencode-global'], ['opencode project', 'opencode'],
  ['claude global', 'claude-global'], ['claude project', 'claude'],
  ['bob global', 'bob-global'], ['bob project', 'bob'],
  ['openclaude global', 'openclaude-global'], ['openclaude project', 'openclaude'],
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
  const [host, scope, root] = detectedInstall(body);
  if (installState(root, host, scope) === 'disabled') {
    return { error: 'install is disabled — reactivate it before (re)building' };
  }
  // A LEGACY CARRIER IS REFUSED, NEVER REBUILT — same guard as `rebuild-all`/`migrate` (see
  // `legacyProcessCarrierOfDir`'s docblock): `doctrinesForBuild`/`excludedRulesOfDir` below
  // read a pre-comms carrier exactly as written, and this endpoint's `{cmd}` is EXECUTED by
  // `startJob` (`js/web/handler.mjs`'s `install` action) — building that argv here would write
  // the same permanent loss a console click away.
  if (legacyProcessCarrierOfDir(root, host)) {
    return { error: `${host}:${scope} (${root}) predates the comms pack (its carrier names `
      + "'process 8') — run `geneseed setup` for it before rebuilding from the console" };
  }
  const emit = EMIT_FOR.get(`${host} ${scope}`);
  if (emit === undefined) return { error: `no install mode for ${host}:${scope}` };
  // Every read-back below is narrowed to `host`'s OWN carrier (host-compat B1) — see the
  // comment at `installProfile` in `js/build/generate.mjs`.
  // The theme default is THIS install's own, not the viewed one's: the Kits tab acts on any row.
  const { theme, footprint: fp, posture: pos, mode, trust } = bodyAxes(body, {
    theme: themeOfDir(root, host) || state.theme, footprint: footprintOfDir(root),
    posture: postureOfDir(root, host) || 'peer',
    mode: modeOfDir(root, host) || 'direct', trust: trustOfDir(root, host) || DEFAULT_PRESET });
  // Unspecified means "keep what this install already has", exactly as theme, footprint,
  // posture and mode above do — a rebuild through the console is not a place to silently
  // re-decide the constitution. ⚠ AND A CARRIER WITH NO `Active packs:` MARKER (a pre-2.3
  // install) MUST NOT LAND ON `harness.config.json`: `doctrinesOfDir` answers `null` there,
  // `null` elided the flag, and the generator's config fallback then narrowed the install and
  // took its consent gate with it. `doctrinesForBuild` resolves unknown to ALL packs.
  const doctrines = bodyDoctrines(body) ?? doctrinesForBuild(root, host);
  // The per-rule axis needs NO `doctrinesForBuild`-style rescue: the marker it reads is only
  // written when something is excluded, so its absence is a statement ("nothing") rather than
  // the silence a pre-2.3 carrier gives on packs. Unspecified therefore keeps the install's
  // own answer, and a pre-marker install answers the empty list — which is what it has.
  const excludeRules = bodyExcludeRules(body) ?? excludedRulesOfDir(root, host);
  // The gate switches (the Constitution page's toggles): a strict boolean per gate in the body,
  // else the install's own answer — so a pack Apply keeps every switch as it is.
  const gates = bodyGates(body, root, host);
  // The page sends `kits` deliberately, so an unknown name is refused: ignoring it would run a
  // no-op rebuild and report success. An omitted key keeps the install's own kits.
  let kits = null;
  try {
    kits = bodyKits(body);
    if (kits === null && bget(body, 'kits') !== null) {
      return { error: `unknown kit in ${formatRepr(bget(body, 'kits'))} — this Geneseed ships: `
        + [...loadKits().keys()].join(', ') };
    }
  } catch (e) { return { error: String(e?.message ?? e) }; }
  const out = scope === 'global' ? null : String(root);
  const argv = setupBuildArgs(theme || 'neutral', emit, out, out, fp, pos, mode, doctrines,
    PACK_ORDER, excludeRules, trust, excludedSkillsOfDir(root, host), gates,
    kits ?? kitsOfDir(root, host));
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
  const [host, scope, root] = detectedInstall(body);
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
  for (const fn of [opencodeConfigDir, claudeConfigDir, bobConfigDir,
    openclaudeConfigDir]) {
    try {
      cfgdirs.add(resolvePath(fn()));
    } catch { /* not every host has a resolvable config dir; skip it */ }
  }
  if (cfgdirs.has(root)) {
    return { error: "that's a host global config dir — use its existing row to build a global install" };
  }
  // Same guard as `apiInstallCmd` above: a landing folder that already holds a pre-comms
  // install must not be rebuilt through `doctrinesForBuild`/`excludedRulesOfDir` below. A
  // fresh, never-built folder has no carrier at all, so this is a no-op for the common case.
  if (legacyProcessCarrierOfDir(root, host)) {
    return { error: `${root} predates the comms pack (its carrier names 'process 8') — `
      + 'run `geneseed setup` for it before deploying over it' };
  }
  // A fresh deploy is full, at the default register, mode and trust.
  const { theme, footprint: fp, posture: pos, mode, trust } = bodyAxes(body, {
    theme: state.theme, footprint: 'full', posture: 'peer', mode: 'direct',
    trust: DEFAULT_PRESET });
  // Same resolution as `apiInstallCmd` above, and for the same reason: the console's Deploy
  // form sends host/path/theme/footprint/posture/mode and NO pack selection, and nothing stops
  // it landing on a directory that already holds an install. Taking `bodyDoctrines` alone left
  // the flag off, the generator fell back to `harness.config.json`, and deploying onto an
  // existing all-four Claude install dropped it to one pack — measured: 6 hook groups became 5
  // and `PreToolUse::Bash` went with them. `doctrinesForBuild` resolves unknown to ALL packs.
  const doctrines = bodyDoctrines(body) ?? doctrinesForBuild(root, host);
  const excludeRules = bodyExcludeRules(body) ?? excludedRulesOfDir(root, host);
  const gates = bodyGates(body, root, host);
  // project-scope emit name == host name (opencode / claude / bob / openclaude)
  const argv = setupBuildArgs(theme || 'neutral', host, root, root, fp, pos, mode, doctrines,
    PACK_ORDER, excludeRules, trust, excludedSkillsOfDir(root, host), gates, kitsOfDir(root, host));
  return { cmd: [process.execPath, path.join(ROOT, 'bin', 'build-driver.mjs'), ...argv] };
}
