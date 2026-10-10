/**
 * The four host config dirs, and the two path primitives they are built on.
 *
 * EXTRACTED IN P5c, and the reason is arithmetic rather than taste. `bin/build-driver.mjs`
 * owned these; `bin/geneseed-cli.mjs` needs the same four to find a global install, and a
 * resolver that decides WHERE a driver writes is the last thing that should exist twice.
 * `js/hosts/hooks.mjs` USED to carry a third copy of `opencodeConfigDir`, on the rule that the
 * hook path stays dependency-free; P5d deleted it when `resolveMemoryDir` moved here and the
 * hook became an importer instead. This module is now the single owner for both drivers AND
 * for the hook.
 *
 * The move is a pure one. What holds it is no longer a byte corpus — `tests/golden.mjs`'s two
 * modes compare a run against another run of the SAME generator, so they would follow a
 * changed resolver rather than catch it — but `tests/unit/node_driver.test.mjs`'s relocation
 * table, which asserts each host's global target absolutely.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { printErr, withDiscardableStderr, isDir, isFile, readText } from '../lib/fs.mjs';
import { toPlatformPath, normcase } from '../lib/paths.mjs';
import { selfAndParents } from './hooks-prims.mjs';

/** `_build_global.GLOBAL_MANIFEST` — the file whose presence means "a global install". */
export const GLOBAL_MANIFEST = '.geneseed-manifest.json';

/** The user's own per-install exclusion list; `js/build/stubs.mjs` seeds it, this file reads it. */
export const EXCLUDES_FILE = 'excludes.json';

/** The gate ledger inside an install: the hooks append to it, `status` counts it. */
export const GATE_LEDGER = path.join('notebook', 'gates.jsonl');

/**
 * `sovereign_bypass` — the user's own excludes.json, read on EVERY hook call so an edit
 * takes effect without a re-emit. Every failure mode degrades to false: a hook must never
 * fail or block on a file the user owns.
 *
 * LIVES HERE, NOT IN `hooks.mjs`, because two readers need it and only one of them may pay
 * for the other: the hook (hot path, already imports this module) and `status` (the CLI,
 * under the transitive `child_process` ban that `hooks.mjs`'s `learn` verb breaks). A
 * second copy in `js/inspect/` was the alternative, and a copy is what let the `~user`
 * refusal diverge between the two CLIs once already (see `hooks.mjs`'s header).
 */
export function sovereignBypass(root) {
  if (!root) return false;
  let entries;
  try {
    const data = JSON.parse(readText(path.join(root, EXCLUDES_FILE)));
    entries = Array.isArray(data && data.excludes) ? data.excludes : [];
  } catch {
    return false;
  }
  let cwd;
  try {
    cwd = normcase(resolvePath(process.cwd()));
  } catch {
    return false;
  }
  for (const entry of entries) {
    const raw = (entry && typeof entry === 'object' ? entry.path : entry) || '';
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let base;
    try {
      // `.rstrip("\\/")` AFTER normcase, exactly as the Python orders it, so the separator
      // test below cannot be fooled by a trailing slash in the user's file.
      //
      // `withDiscardableStderr` because `expanduser` writes its refusal at the RAISE SITE
      // and this caller catches: the reference prints nothing here, so replaying the
      // message would be a stderr divergence on every hook call for one bad entry.
      //
      // `resolvePath`, the same resolution as `cwd` above: symlinks and junctions are followed on
      // BOTH sides, so an entry spelled through a link matches the real directory the session
      // stands in (and the OpenCode plugins' `norm` applies the identical rule).
      base = withDiscardableStderr(
        () => normcase(resolvePath(raw.trim())).replace(/[\\/]+$/, ''));
    } catch {
      // PER ENTRY, and the loop continues. One unusable line in a file the USER hand-edits
      // must not decide the whole function — `expanduser` refuses a `~user` form, and the
      // reference's `Path.expanduser()` raises RuntimeError on the same input on POSIX.
      // Skipping errs toward the gate staying ACTIVE, which is the safe direction.
      continue;
    }
    if (cwd === base || cwd.startsWith(base + path.sep)) return true;
  }
  return false;
}

/**
 * `_global_hook_standing_down` — project-bypasses-global, for `context`, `git-gate` and `learn`.
 *
 * A GLOBAL install's hook knows its own dir (`--root`, or `learn`'s `--memory` parent); when a
 * Geneseed PROJECT install of the SAME host sits at or above cwd, that project's hook runs too,
 * and Claude runs every matching hook with the strictest verdict winning — so the global's
 * second injection, its process-5 ask over a project built `--no-consent`, and its second LLM
 * call are all doubles (host-compat Claude B4). `$GENESEED_STACK_GLOBAL` stacks them on purpose.
 *
 * THE MARKER COMES FROM `host`, NOT THE FOLDER NAME. It once came from `basename(hookRoot)`,
 * so a global moved by `$CLAUDE_CONFIG_DIR`/`$BOB_CONFIG_DIR`/`$OPENCLAUDE_CONFIG_DIR` matched
 * no marker and never stood down (Claude B9, OpenClaude I2, Bob B4). With no `host` (Claude's
 * commands, and any emitted before the gates carried one), a folder named like a marker is that
 * marker, else the root's own `.geneseed-emit` names it; neither = never stand down.
 *
 * ONLY A PROJECT INSTALL SILENCES, NEVER ANOTHER GLOBAL. The up-walk from anywhere under home
 * reaches `~`, so with `CLAUDE_CONFIG_DIR=~/.claude-work` (the docs' multi-account example) it
 * finds the OTHER global `~/.claude` — whose hooks this session never loads. A candidate whose
 * own `.geneseed-emit` names a `-global` emit, or that IS a host's global dir (its default
 * `~/<marker>`, which also catches a leftover with no emit marker, or the env-resolved one),
 * ends the walk with false: nothing at or above a global dir is this session's project.
 *
 * `cwd` should be the SESSION's project root (`$CLAUDE_PROJECT_DIR`, see `hookProjectDir`),
 * not the hook's cwd: Claude loads project hooks once, from that root, and the cwd follows
 * the agent's `cd` into repos whose hooks were never loaded.
 *
 * LIVES HERE, beside `sovereignBypass`, for the same reason: the gates must not import
 * `hooks-context.mjs`. Any failure (a `~user` root `resolvePath` refuses) is false: a gate that
 * cannot tell keeps gating.
 */
export function globalHookStandingDown(hookRoot, cwd, host = null) {
  if (!hookRoot || process.env.GENESEED_STACK_GLOBAL) return false;
  const markers = STAND_DOWN_MARKERS;
  const own = path.basename(hookRoot);
  try {
    return withDiscardableStderr(() => {
      let marker = markers[host] || (Object.values(markers).includes(own) ? own : null);
      if (!marker) {
        // A relocated root with no `--host`: its own `.geneseed-emit` (`claude-global`, …) names
        // the host. Absent or unknown = false — guessing Claude would silence a pre-`--host`
        // OpenClaude gate beside a project `.claude`, and OpenClaude loads no `.claude` hooks.
        let emit = '';
        try { emit = readText(path.join(hookRoot, '.geneseed-emit')).trim(); } catch { /* absent */ }
        marker = emit.endsWith('-global') ? markers[emit.slice(0, -'-global'.length)] : null;
        if (!marker) return false;
      }
      const self = normcase(resolvePath(hookRoot));
      for (const d of selfAndParents(resolvePath(cwd))) {
        const cand = path.join(d, marker);
        // Path equality, case-folded on Windows — `~/.claude` and `~/.Claude` are the same
        // install there and two different ones on Linux.
        if (!isFile(path.join(cand, GLOBAL_MANIFEST))) continue;
        const c = normcase(resolvePath(cand));
        return c !== self && !isGlobalDir(cand, c);
      }
      return false;
    });
  } catch {
    return false;
  }
}

/** `cand` (resolved and case-folded as `c`) is some host's GLOBAL install, not a project's. */
function isGlobalDir(cand, c) {
  let emit = '';
  try { emit = readText(path.join(cand, '.geneseed-emit')).trim(); } catch { /* absent */ }
  if (emit.endsWith('-global')) return true;
  return HOSTS.some((h) => h.family === 'claude'
    && (normcase(resolvePath(path.join(os.homedir(), h.projectMarker))) === c
      || normcase(h.configDir()) === c));
}

/**
 * The project root a hook judges against: `$CLAUDE_PROJECT_DIR` (Claude Code and OpenClaude set
 * it for every hook — the session's root, where its project hooks were loaded from), else the
 * cwd. Bob documents no such variable, so under Bob this is the cwd.
 */
export function hookProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/**
 * `_build_core.VERSION_MARKER`. Third caller, so it moves here — `js/build/version.mjs` and
 * `js/inspect/diff.mjs` each had a private const of their own and `js/maintain/uninstall.mjs` would have made
 * a third copy of a value whose whole job is being the same string everywhere. Same
 * arithmetic that put `GLOBAL_MANIFEST` above it.
 */
export const VERSION_MARKER = '.geneseed-version';

/**
 * `Path.expanduser()` — a LEADING `~` only, and `~` alone counts.
 *
 * The docblock here used to claim "Python does not expand `~user` on Windows the way a
 * shell would". That claim was FALSE, and `921384f`'s widened probe corpus caught it:
 * `ntpath.expanduser('~someuser/x')` swaps the last component of `%USERPROFILE%` and
 * returns `C:\Users\someuser\x` — it happily expands a name that may not even be a real
 * account.
 *
 * AND THE POSIX HALF OF THAT SENTENCE WAS WRONG IN ITS TURN, corrected here while the
 * reference is still on the machine to ask. `posixpath.expanduser` does the analogous thing
 * through the password database and returns the path unchanged when the account is unknown
 * — but the reference does not call it. It calls `Path.expanduser`, which re-checks the
 * result and RAISES `RuntimeError: Could not determine home directory.` So the divergence
 * below is WINDOWS-ONLY: on POSIX the reference and this port already agree in kind — both
 * refuse — and differ only in which exception says so.
 *
 * This port deliberately does NEITHER. Reproducing `ntpath`'s swap faithfully needs its own
 * corpus, and the Python reference is being deleted, so byte-parity on this one input stops
 * mattering the moment it is. What matters instead is that a `~user` form never resolves
 * SILENTLY to the wrong place: the old code below returned it untouched, so
 * `--target ~someone/x` created a literal `~someone` directory in whatever cwd the user ran
 * from. It now REFUSES the form outright. This is the single primitive every config-dir env
 * var and every `--target`/`--dir`/`--bundle`/`--out` argument passes through on the way to
 * becoming a filesystem path, so refusing here — rather than at each of those call sites —
 * is one guard instead of several, and none of the paths that already exist there. `~` alone
 * and `~/…`/`~\…` are unaffected; only a name after the tilde is rejected.
 */
export function expanduser(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  if (p.startsWith('~')) {
    const msg = `refusing '${p}': a '~user' path is not expanded by this port (Python's `
      + "ntpath/posixpath would guess a home directory for 'user' — this port does not); "
      + 'pass an absolute path, or "~" / "~/…" for your own home directory';
    printErr(`${msg}\n`);
    throw Object.assign(new Error(msg), { exitCode: 1 });
  }
  return p;
}

/**
 * `Path.resolve()` — absolute, symlinks followed, and the filesystem's OWN casing.
 *
 * `path.resolve` does none of the last two and `realpathSync` THROWS on a path that does not
 * exist yet, which is the normal case here: the first `--emit opencode-global` on a machine
 * resolves a config dir nobody has created. Python's `resolve(strict=False)` canonicalises
 * the part that exists and appends the rest verbatim, so that is what this reproduces.
 * It matters because the resolved directory is printed on stdout and compared byte-for-byte.
 */
export function resolvePath(p) {
  let cur = path.resolve(expanduser(p));
  const tail = [];
  for (;;) {
    try {
      return tail.length ? path.join(realpathSync.native(cur), ...tail) : realpathSync.native(cur);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(expanduser(p));  // nothing on this path exists
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * `_build_core._opencode_config_dir` — and the four resolvers like it are the reason
 * `bin/build-driver.mjs` exists rather than a child doing the work.
 *
 * P3c's rule was "the child must never resolve this": a render child that did would write
 * 135 files into the developer's real `~/.config/opencode`. A driver is the PARENT, so the
 * rule inverts — resolving it there is exactly the job. Precedence is the env var, then
 * `$XDG_CONFIG_HOME/opencode`, then `~/.config/opencode`.
 *
 * The env var does NOT relocate the whole dir upstream, it ADDS one: agents, commands,
 * plugins, skills and `opencode.json` still load from the xdg dir as well, and only the global
 * `AGENTS.md` and the skills home follow the env var alone (`Global.Service.config`). Emitting
 * into the env-var dir is still right — it is the one both lists include — but an older
 * install left in the xdg dir keeps loading beside it; `opencodeShadowedInstall` reports that.
 */
export function opencodeConfigDir() {
  const env = process.env.OPENCODE_CONFIG_DIR;
  if (env) return resolvePath(env);
  return opencodeXdgDir();
}

/** The dir OpenCode ALWAYS loads, `OPENCODE_CONFIG_DIR` or not (`Global.Path.config`). */
function opencodeXdgDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? expanduser(xdg) : path.join(os.homedir(), '.config');
  return resolvePath(path.join(base, 'opencode'));
}

/**
 * The xdg dir when it holds a Geneseed install BESIDE the one at `$OPENCODE_CONFIG_DIR` —
 * both load, so every plugin (learn, activity, notify, ponytail) runs twice — else null.
 */
export function opencodeShadowedInstall() {
  if (!process.env.OPENCODE_CONFIG_DIR) return null;
  const env = opencodeConfigDir();
  const xdg = opencodeXdgDir();
  if (env === xdg) return null;
  const both = [env, xdg].every((d) => isFile(path.join(d, GLOBAL_MANIFEST)));
  return both ? xdg : null;
}

/**
 * `_build_core._claude_config_dir` — `~/.claude`, relocatable via `$CLAUDE_CONFIG_DIR`.
 *
 * Claude Code's own documented variable (`env-vars.md`; `claude-directory.md`: "every
 * `~/.claude` path … lives under that directory instead"), so it moves CLAUDE.md, skills,
 * agents, rules and settings together. This once had NO env branch, on the false premise that
 * Claude documents none — and a user who set it got a global install their Claude never read
 * (host-compat Claude B9). `~/.claude.json` is NOT moved here: `mcpConfigFor` keeps its own rule.
 */
export function claudeConfigDir() {
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) return resolvePath(env);
  return resolvePath(path.join(os.homedir(), '.claude'));
}

/** `_build_core._bob_config_dir` — `~/.bob`, relocatable via `$BOB_CONFIG_DIR`. */
export function bobConfigDir() {
  const env = process.env.BOB_CONFIG_DIR;
  if (env) return resolvePath(env);
  return resolvePath(path.join(os.homedir(), '.bob'));
}

/**
 * OpenClaude (`@gitlawb/openclaude`) — `~/.openclaude`, relocatable via `$OPENCLAUDE_CONFIG_DIR`.
 *
 * Unlike Claude's, this env branch is the HOST'S OWN documented variable, not a Geneseed knob:
 * OpenClaude reads it in `src/utils/envUtils.ts` and never falls back to `~/.claude` or
 * `$CLAUDE_CONFIG_DIR`, so honouring it is what keeps the two CLIs agreeing on the target.
 */
export function openclaudeConfigDir() {
  const env = process.env.OPENCLAUDE_CONFIG_DIR;
  if (env) return resolvePath(env);
  return resolvePath(path.join(os.homedir(), '.openclaude'));
}

/**
 * `_build_global.HOSTS` — one row per host, IN ITS ORDER: opencode, claude, bob, openclaude.
 * A new host is one row here; `EMIT_HOST_SCOPE` (`js/hosts/installs.mjs`) and `CLAUDE_STYLE`
 * below are derived from it.
 *
 * An array rather than an object because the order is observable output, not an
 * implementation detail: `harness exclude add` walks it and prints one message per host, so
 * a reordering is a diff in stderr.
 *
 * `projectMarker` joined in P5f. `_install_targets` asks "does this cwd carry a project
 * install of host H", and `_claude_cfg` asks "which subdir holds a project install's
 * manifest" — both are the same `.opencode`/`.claude`/`.bob`/`.openclaude` value the Python reads
 * out of `build.HOSTS[host]["project_marker"]`, so it belongs beside the config dir rather
 * than in a second table in `js/hosts/installs.mjs`.
 *
 * `agentFile` joined in P5h, and for one caller: `cmd_uninstall` names the managed block's
 * carrier in its "removes:" preamble (`the CLAUDE.md managed block`, `the AGENTS.md managed
 * block`). It is a column and not a literal in the message for the reason every other column
 * here is one — Bob answers `AGENTS.md` while Claude answers `CLAUDE.md`, and
 * a host added later must not need the message edited to stay true.
 *
 * `family` joined in 2026-10: `'claude'` for every host emitted through the Claude-shaped
 * engine — one manifest shape, one `settings.json` hook wiring, one strict-JSON `mcpServers`
 * config, one reversal. The list had been spelled out by hand in ten places, one of which
 * ignored the named constant right above it.
 *
 * `catalog` — does the host list every skill and agent to the model by itself? See
 * `hostCatalogsNatively` below for what it decides and why it is split per kind.
 *
 * `carrierInLayer` joined for host-compat B1 (2026-10) — THE ONE SOURCE for whether a host's
 * PROJECT carrier sits at `<repo>/<projectMarker>/<agentFile>` rather than
 * `<repo>/<agentFile>`. Only OpenClaude has it: its root `CLAUDE.md` is deliberately left
 * unwritten so a Claude Code install can share the repo. Two readers, both DERIVED rather than
 * restated: `js/build/driver.mjs`'s `CLAUDE_SHAPED.openclaude.carrierInLayer` reads this
 * column (not a second literal `true`), and `installs.mjs`'s `carriersFor` reads it too — if a
 * future host also nests its carrier, this is the one place that has to say so.
 */
export const HOSTS = [
  { host: 'opencode', family: 'opencode', configDir: opencodeConfigDir, projectMarker: '.opencode', agentFile: 'AGENT.md', catalog: { skills: true, agents: true } },
  { host: 'claude', family: 'claude', configDir: claudeConfigDir, projectMarker: '.claude', agentFile: 'CLAUDE.md', catalog: { skills: true, agents: true } },
  { host: 'bob', family: 'claude', configDir: bobConfigDir, projectMarker: '.bob', agentFile: 'AGENTS.md', catalog: { skills: true, agents: false } },
  { host: 'openclaude', family: 'claude', configDir: openclaudeConfigDir, projectMarker: '.openclaude', agentFile: 'CLAUDE.md', catalog: { skills: true, agents: true }, carrierInLayer: true },
];

/** Each Claude-family host's project marker, keyed by host — `globalHookStandingDown`'s table. */
const STAND_DOWN_MARKERS = Object.fromEntries(HOSTS.filter((h) => h.family === 'claude')
  .map((h) => [h.host, h.projectMarker]));

/** The Claude-STYLE hosts (`family: 'claude'`), in `HOSTS` order. Test with `.includes(host)`. */
export const CLAUDE_STYLE = HOSTS.filter((h) => h.family === 'claude').map((h) => h.host);

/**
 * `_build_global.host_catalogs_natively` — does `host` list every skill and agent to the
 * model by itself?
 *
 * `HOSTS`' `catalog` column. `doctor`'s `_rendered_problems` has to know, because a host
 * that catalogues natively gets AGENT.md's tables collapsed to a pointer and comparing the
 * portable shape against its bundle reports AGENT.md stale on every run forever. It is a
 * column and not a set literal so that the capability is declared in exactly one place
 * — the Python's own reason for the helper. The driver reads it through this function too.
 *
 * Unknown host -> false, which is the shape that KEEPS the tables. The value arrives from a
 * user-editable `.geneseed-emit` marker, so an unrecognised one must degrade to the portable
 * bundle rather than raise.
 *
 * SPLIT PER KIND (2026-09): Bob reads `.bob/skills/<name>/SKILL.md` natively — verified
 * against its docs in the Bob injection review — but has no markdown agents directory, so a
 * single boolean was wrong both ways: `false` shipped the §4 Skills table on top of a
 * catalogue Bob already had (~1.7k tokens twice), `true` would have stripped the §3 Agents
 * table that is Bob's ONLY agent catalogue. Each CATALOG block in AGENT.md names its kind and
 * resolves against its own flag.
 *
 * Returns `{ skills, agents }` for a known host, `false` for an unknown one.
 */
export function hostCatalogsNatively(host) {
  return HOSTS.find((h) => h.host === host)?.catalog || false;
}

/** `_harness_learn.MEMORY_DIR_NAMES` — the neutral name and the imperial theme's. */
const MEMORY_DIR_NAMES = ['memory', 'anamnesis'];

/**
 * `_harness_learn._resolve_memory_dir` — where `learn` dedups and indexes, and what
 * `status` reports on its memory row.
 *
 * Precedence: `--memory` > `$GENESEED_MEMORY` > a `memory/` (or `anamnesis/`) beside cwd or
 * under `./Harness` > `$GENESEED_HARNESS/memory` > the OpenCode GLOBAL config dir's store.
 * The last two matter for the recommended opencode-global install, whose store lives in
 * `~/.config/opencode` rather than beside any repo. null => stdout-only.
 *
 * HERE rather than in `js/hosts/hooks.mjs`, where it was written, because P5d gave it a second
 * caller that cannot import that file: `bin/geneseed-cli.mjs` is under a transitive
 * `child_process` ban and `learn` spawns the model CLI. This module is the one both can
 * reach, and it already owns the `opencodeConfigDir` the last fallback needs — so the move
 * DELETED a duplicate resolver rather than adding a shared one.
 */
export function resolveMemoryDir(explicit) {
  if (explicit) {
    const p = toPlatformPath(explicit);
    return isDir(p) ? p : null;
  }
  const env = process.env.GENESEED_MEMORY;
  if (env && isDir(env)) return toPlatformPath(env);
  const cwd = process.cwd();
  const bases = [cwd, path.join(cwd, 'Harness')];
  const gh = process.env.GENESEED_HARNESS;
  if (gh) {
    // PER BASE, and the walk continues. `$GENESEED_HARNESS` is the FOURTH user-controlled
    // tilde input and the one the `~user` refusal was never swept onto: `expanduser` throws
    // on `~someone/x`, and this resolver is reached by `geneseed status` (js/inspect/status.mjs's
    // `resolveMemoryDir(null)`) and by the `learn` hook, whose entry point
    // (`bin/geneseed-hook.mjs`) has NO top-level try — so an unguarded throw here is a stack
    // trace on a hook path and a non-zero exit, the exact failure the other three guards
    // exist to prevent. Skipping the base degrades to "no memory store from $GENESEED_HARNESS",
    // which is what an unset variable already does. `withDiscardableStderr` because the
    // refusal prints at the RAISE SITE and both callers byte-compare stderr; the reference
    // (`rituals/_harness_learn.py`, same guard) prints nothing here.
    try { bases.push(withDiscardableStderr(() => expanduser(gh))); } catch { /* skip it */ }
  }
  try { bases.push(opencodeConfigDir()); } catch { /* best-effort, as the Python */ }
  for (const base of bases) {
    for (const name of MEMORY_DIR_NAMES) {
      const cand = path.join(base, name);
      if (isDir(cand)) return cand;
    }
  }
  return null;
}
