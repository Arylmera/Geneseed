/**
 * How a DEPLOYED install is recognised — `_harness_setup`'s detection half and
 * `_harness_mcp`'s registry-reading half, which are one subject in two Python files.
 *
 * EXTRACTED IN P5f, and by the same arithmetic that produced `js/hosts.mjs` and
 * `js/checkout.mjs`: this is the third verb-set to need it. P5d wrote `themeOfDir` and
 * `footprintOfDir` inside `js/status.mjs` because `status` was the only caller; `diff`
 * renders its 'expected' copy in the theme and footprint the deployment actually uses, and
 * `rebuild-all` re-emits every install in its own theme, emit, footprint, posture and mode.
 * Three callers of one detector is where a private helper becomes a module.
 *
 * WHAT THE MOVE DID NOT DO, and it is the P5f brief's second blind spot answered by
 * measurement. `installedDefaults` still omitted posture and mode after P5f, because
 * `cmd_rebuild_all` never calls `_installed_defaults`: it calls `_posture_of_dir(root)` and
 * `_mode_of_dir(root)` directly, per install root, which is a different question from "what
 * did this machine install". **P5i is where the debt came due** — `collectSetupLines`
 * pre-selects three pickers off it — and the missing keys are now returned.
 * `status/posture-and-mode-in-the-carrier-change-nothing` stays exactly as valid as it was:
 * it is the positive control that the PANEL prints neither, and the panel reads two keys of
 * the five whatever the other three hold.
 *
 * WHAT A CELL CANNOT REACH HERE. `installTargets` walks `process.cwd()` and the four host
 * config dirs, and both are fenceable — `golden.cell_env` redirects HOME/XDG and every cell
 * chooses its own `cwd`. What it also walks is the persistent registry, which lives under
 * the redirected `$XDG_CONFIG_HOME` and is therefore fenceable too. So unlike `status`, none
 * of this module's inputs is the unfenceable `ROOT`; the `rebuild-all` cells seed real
 * installs and get real answers.
 *
 * That sentence was FALSE until wave 2 of the P0/P1 review: `installedDefaults` walked
 * `ROOT / "Harness"` and `ROOT.parent / "Harness"`, so on a checkout carrying a built
 * bundle every cell that seeded no emit marker read this developer's own install — four
 * web cells recorded it. Both candidates are gone (the argument is in the Python), and the
 * claim is now true rather than aspirational.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { CONFIG, PACK_ORDER, THEMES, discoverNames } from './checkout.mjs';
import { GLOBAL_MANIFEST, HOSTS, pyResolve } from './hosts.mjs';
import { registryRoots } from './registry.mjs';
import { comparePaths, pyPrintErr, pyRepr, readText } from './lib/fs.mjs';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/**
 * `Path.read_text(encoding="utf-8")`, or null where Python raises OSError.
 *
 * `readText`, not a bare `readFileSync`: `read_text` opens in TEXT mode, so Python's
 * universal-newline decoding folds `\r\n` and a lone `\r` to `\n` before the caller ever
 * sees them, and `readFileSync` does not. Every caller here reads a single-line marker and
 * trims it, which is why the divergence sat latent through five phases — P6b's
 * `/api/profile` is the first consumer that hands the whole decoded text back out, and
 * `profile/a-seeded-profile-carries-its-fingerprint` failed on the CRLF the seeder wrote
 * AND on the sha256 of it. Fixed here rather than at that one call site: the multi-line
 * readers (`installs.mjs`'s AGENT.md sigil scan and carrier read, `uninstall.mjs`'s two)
 * all mirror a Python `read_text` too, so every one of them was wrong in the same way and
 * a guard at the new caller would have left them wrong.
 */
export function readMaybe(p) {
  try { return readText(p); } catch { return null; }
}

/** `json.loads(...)` of a file, or null — Python catches JSONDecodeError and OSError alike. */
export function readJsonMaybe(p) {
  const txt = readMaybe(p);
  if (txt === null) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

// ---- the configured defaults (`_harness_setup._default_*`) --------------------------------

/**
 * `_harness_setup._default_theme` / `_default_posture` / `_default_mode`.
 *
 * One reader for three keys where the Python has three near-identical functions. The fallback
 * differs per key and is the argument, so nothing is shared that is not actually the same:
 * each is `harness.config.json`'s value or a literal, with an unreadable or non-JSON file
 * falling through to the literal. NOT `configDefaults()` from the driver, which warns on a
 * corrupt file — these three are silent, as their Python originals are.
 */
function configuredDefault(key, fallback) {
  if (existsSync(CONFIG)) {
    const doc = readJsonMaybe(CONFIG);
    if (doc && typeof doc === 'object') return doc[key] ?? fallback;
  }
  return fallback;
}

export const defaultTheme = () => configuredDefault('theme', 'neutral');
export const defaultPosture = () => configuredDefault('posture', 'peer');
export const defaultMode = () => configuredDefault('mode', 'direct');

// There is deliberately no `defaultDoctrines()` beside the three above, and its absence is
// the invariant. `theme`, `posture` and `mode` may fall back to `harness.config.json` when an
// install does not say, because the worst a wrong answer does there is cosmetic. The pack
// selection is not like them: it decides whether the commit/push consent gate is wired, so
// resolving "this install does not say" out of a MACHINE-WIDE config file narrows every
// pre-2.3 install on its first upgrade — `{"doctrines":["craft"]}` and the gate is gone from
// carriers that never asked. Unknown resolves to ALL packs; see `doctrinesForBuild` below.
// The config value keeps exactly one legitimate reader: `configDefaults()` in
// `bin/geneseed.mjs`, which answers `geneseed build` — the case where there is no install to
// ask in the first place.

// ---- theme, footprint, posture, mode, read back off a deployed tree -----------------------

/**
 * `_build_render.theme_files` — shipped themes, `_`-prefixed scaffolds excluded.
 *
 * `dir` defaults to the checkout's own `themes/`, which is every caller but one: P2's
 * `syncThemes` is driven over a FIXTURE directory by the cross-implementation corpus in
 * `tests/test_maintainer_tools_parity.py`, because the tool it belongs to rewrites committed
 * files and cannot be gated against the real ones. A parameter, not a second enumeration —
 * a scaffold mistaken for a theme is exactly what this function exists to prevent, once.
 *
 * Sorted with `comparePaths` and not `.sort()`: the Python sorts `Path` objects, which compare
 * through `_str_normcase`, so on Windows `Cyberpunk.json` sorts before `bar.json` there and
 * after it under a bare code-unit sort. No shipped theme has an upper-case name, so no
 * emitted byte moves — it is the fixture corpus that can reach a name that does.
 */
export function themeFiles(dir = THEMES) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.json') && !n.startsWith('_'))
    .map((n) => path.join(dir, n)).sort(comparePaths);
}

/** `_harness_setup._theme_from_agent` — match a theme's unique LOADED_SIGIL in a carrier. */
function themeFromAgent(agentMd) {
  const text = readMaybe(agentMd);
  if (text === null) return null;
  for (const tf of themeFiles()) {
    const doc = readJsonMaybe(tf);
    const sig = (doc && typeof doc === 'object' ? doc.LOADED_SIGIL : '') || '';
    if (sig && text.includes(sig)) return path.basename(tf, '.json');
  }
  return null;
}

/**
 * `_harness_setup.CARRIERS` — the five instruction carriers, in the Python's order.
 *
 * A shared table rather than three copies of the same list: `_theme_of_dir`,
 * `_posture_of_dir` and `_mode_of_dir` each walk it, and the order is observable (the first
 * carrier that answers wins). `rules/geneseed.md` is spelled with `path.join` at each use
 * because the Python writes `d / "rules" / "geneseed.md"` for that one entry.
 */
const CARRIERS = ['AGENT.md', 'CLAUDE.md', path.join('rules', 'geneseed.md'),
  'copilot-instructions.md', 'AGENTS.md'];

/** `_harness_setup._theme_of_dir` — the marker, else the sigil in one of five carriers. */
export function themeOfDir(d) {
  const marker = path.join(d, '.geneseed-theme');
  if (isFile(marker)) {
    const name = (readMaybe(marker) ?? '').trim();
    if (name) return name;
  }
  for (const carrier of CARRIERS) {
    const found = themeFromAgent(path.join(d, carrier));
    if (found) return found;
  }
  return null;
}

/** `_harness_setup.FOOTPRINTS`. */
const FOOTPRINTS = ['lean', 'full'];

/**
 * `_harness_setup._footprint_of_dir`.
 *
 * `status` reads no footprint row at all; the WARN is why this function is ported there, and
 * `diff` and `rebuild-all` read the RETURN value as well. An unrecognised marker is reported
 * rather than swallowed (Rule V, *Surface Failures* — VII before the three-tier renumber, and
 * VII now names *Least Privilege*), and a compared stderr is what makes that observable —
 * `status/a-bogus-footprint-marker-warns-on-stderr` is the cell.
 */
export function footprintOfDir(d) {
  const marker = path.join(d, '.geneseed-footprint');
  if (isFile(marker)) {
    const v = (readMaybe(marker) ?? '').trim();
    if (FOOTPRINTS.includes(v)) return v;
    if (v) {
      pyPrintErr(`[geneseed] WARN: ${marker} holds unknown footprint ${pyRepr(v)} — `
        + `reading it as 'full'. Known: ${FOOTPRINTS.join(', ')}.\n`);
    }
  }
  return 'full';
}

/**
 * `_harness_setup._posture_of_dir` / `_mode_of_dir` — CONTENT-detected, not markered.
 *
 * The inlined `## Posture` / `## Mode` section opens with a distinctive `**<Name>**` lead, so
 * a deployed install carries its register in the prose and needs no extra marker file. The
 * two Python functions are identical but for which name list they scan, which is the argument
 * here — and the list comes from `discoverNames`, the same call the driver's `--posture`
 * choices come from, so a new posture file is detectable and buildable in one change.
 *
 * `str.capitalize()` is NOT `s[0].toUpperCase() + s.slice(1)`: Python lowercases the REST of
 * the string, so a posture file named `Foreman` renders `**Foreman**` and one named `FOREMAN`
 * would be scanned for as `**Foreman**` by both implementations only if this reproduces the
 * lowercasing. Every shipped name is already lowercase, which is exactly why the difference
 * would go unnoticed — the corpus in `tests/test_pure_function_parity.py` is what covers it.
 */
export function pyCapitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

function leadOfDir(d, names) {
  for (const carrier of CARRIERS) {
    const text = readMaybe(path.join(d, carrier));
    if (text === null) continue;
    for (const name of names) {
      if (text.includes(`**${pyCapitalize(name)}**`)) return name;
    }
  }
  return null;
}

export const postureOfDir = (d) => leadOfDir(d, discoverNames('postures', 'peer'));
export const modeOfDir = (d) => leadOfDir(d, discoverNames('modes', 'direct'));

/** The `Active packs:` marker line the template emits, in one of the five carriers. */
const ACTIVE_PACKS_RE = /^Active packs:[ \t]*(.+?)[ \t]*$/m;

/**
 * The doctrine packs a DEPLOYED install carries — the third register read back off disk,
 * beside `postureOfDir` and `modeOfDir`, and the first that is a SET.
 *
 * MARKERED IN PROSE, like posture and mode and unlike theme/footprint: `src/AGENT.md.tmpl`
 * writes a literal `Active packs: <list>` line under the doctrines section, so no extra dotfile
 * has to survive a copy. The label is NOT token-substituted, so a themed bundle still answers.
 *
 * ⚠ THREE RETURN STATES, AND THE NULL IS THE SAFETY ONE.
 *   - `null` — no marker in any carrier. That is a pre-migration install, or a carrier that
 *     never had one, and it means "unknown", NOT "no packs". Every consumer must read it as
 *     the process pack being ACTIVE, so the commit/push consent gate stays installed. Write
 *     `doctrinesOfDir(root)` into an explicit `=== null` / `??` test — never
 *     `doctrinesOfDir(root)?.includes('process')`, which is falsy on `null` and would strip
 *     the gate from every existing install on its next upgrade.
 *   - `[]` — the marker is present and reads `none`. A deliberate empty selection (invariants
 *     and ontology only) and a real configuration: the gate comes OFF.
 *   - a list — the packs named, re-ordered through `PACK_ORDER`, because this value is
 *     compared against a marker the build writes in that order.
 *
 * A marker line this checkout cannot read WHOLE falls back to `null` rather than to whatever
 * part of it did parse, for the same reason: a corrupt line is unknown, and unknown fails
 * closed. ⚠ "Whole" is the strict word and it is what the first cut of this got wrong. The
 * regex is single-line, so a marker a wrapper had folded — `Active packs: craft, rigor,\nops,
 * process` — matched its first half, every name in that half was known, and the function
 * answered the NARROWED set `['craft','rigor']` with no complaint. That is fail-OPEN against
 * this docblock's own promise: the process pack disappears from an install that has it, and
 * the gate goes with it. So every comma-separated field must be non-empty AND a pack this
 * checkout ships; one that is not condemns the whole line to `null`. A trailing comma is
 * exactly the empty field a fold leaves behind, which is what makes this catch it.
 */
export function doctrinesOfDir(d) {
  for (const carrier of CARRIERS) {
    const text = readMaybe(path.join(d, carrier));
    if (text === null) continue;
    const m = ACTIVE_PACKS_RE.exec(text);
    if (!m) continue;
    if (m[1] === 'none') return [];
    const named = m[1].split(',').map((s) => s.trim());
    if (!named.every((n) => PACK_ORDER.includes(n))) return null;
    return PACK_ORDER.filter((p) => named.includes(p));
  }
  return null;
}

/**
 * `doctrinesOfDir` with the `null` RESOLVED — the one spelling every build-side consumer uses.
 *
 * ⚠ UNKNOWN RESOLVES TO ALL PACKS, NEVER TO A CONFIG VALUE. `doctrinesOfDir`'s docblock puts
 * the rule on the reader; this function is what makes it true of the readers, because the
 * previous shape (`doctrinesOfDir(root) ?? defaultDoctrines()`) left every consumer free to
 * pick its own fallback and all five of them picked `harness.config.json`. With
 * `{"doctrines":["craft"]}` in that file, an `upgrade`/`rebuild-all`/`migrate` re-emitted every
 * pre-2.3 install at ONE pack and took the commit/push consent gate off installs whose owners
 * had never been asked — the exact outcome the fail-closed reading exists to prevent, and it
 * got WIDER when the reader was hardened, because more inputs now answer `null`.
 *
 * A config value is a legitimate default only where there is NO INSTALL TO ASK: a fresh
 * `geneseed build`, which `configDefaults()` in `bin/geneseed.mjs` answers. Anything holding a
 * directory has an install to ask, so it calls this and never the config.
 *
 * `[]` still passes through untouched — a marker that reads `none` is an answer, not a silence.
 */
export function doctrinesForBuild(d) {
  return doctrinesOfDir(d) ?? [...PACK_ORDER];
}

// ---- what host a deployed dir belongs to (`_harness_mcp`) ---------------------------------

/** `_harness_mcp._claude_read_manifest`. */
export function claudeReadManifest(cfgDir) {
  const data = readJsonMaybe(path.join(cfgDir, GLOBAL_MANIFEST));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/**
 * `_harness_mcp._manifest_is_claude` — keyed on the `managed` MAP, not on `claude_md`: a Bob
 * global emit ships no AGENTS.md and records no `claude_md`, and still needs the
 * Claude-style reversal.
 */
export function manifestIsClaude(cfgDir) {
  const mg = claudeReadManifest(cfgDir).managed;
  return typeof mg === 'object' && mg !== null && !Array.isArray(mg);
}

/** `_harness_mcp._EMIT_HOST_SCOPE` — a marker's emit name fixes (host, scope). */
export const EMIT_HOST_SCOPE = new Map([
  ['opencode', ['opencode', 'project']], ['opencode-global', ['opencode', 'global']],
  ['claude', ['claude', 'project']], ['claude-global', ['claude', 'global']],
  ['bob', ['bob', 'project']], ['bob-global', ['bob', 'global']],
  ['copilot', ['copilot', 'project']], ['copilot-global', ['copilot', 'global']],
]);

/** `_harness_mcp._emit_host_scope_of` — `root`'s own marker, resolved, or null. */
export function emitHostScopeOf(root) {
  const emit = readMaybe(path.join(root, '.geneseed-emit'));
  if (emit === null) return null;
  return EMIT_HOST_SCOPE.get(emit.trim()) ?? null;
}

/** `_harness_mcp.DISABLED_STASH` — a sibling dir whose presence means "disabled". */
export const DISABLED_STASH = '.geneseed-disabled';

/**
 * `_harness_mcp._claude_cfg` — where a Claude-STYLE install keeps its manifest.
 *
 * The config dir itself for a global install; `<repo>/<project_marker>` for a project one.
 * Host-aware so Bob and Copilot ride the whole Claude lifecycle with only the subdir
 * differing, and the marker comes from `HOSTS` rather than a literal for that reason.
 */
export function claudeCfg(root, scope, host = 'claude') {
  if (scope === 'global') return root;
  const spec = HOSTS.find((h) => h.host === host);
  return path.join(root, spec ? spec.projectMarker : '.claude');
}

/** `_harness_mcp._claude_state`. */
function claudeState(root, scope = 'global', host = 'claude') {
  const cfg = claudeCfg(root, scope, host);
  if (isDir(path.join(cfg, DISABLED_STASH, host))) return 'disabled';
  return existsSync(path.join(cfg, GLOBAL_MANIFEST)) ? 'active' : 'absent';
}

/** `_harness_mcp._install_kind` — 'global' | 'project' | null. */
export function installKind(root) {
  if (existsSync(path.join(root, GLOBAL_MANIFEST))) return 'global';
  if (isDir(path.join(root, '.opencode'))) return 'project';
  return null;
}

/** `_harness_mcp._install_state` — 'active' | 'disabled' | 'absent'. */
export function installState(root, host = 'opencode', scope = 'global') {
  if (['claude', 'bob', 'copilot'].includes(host)) return claudeState(root, scope, host);
  if (isDir(path.join(root, DISABLED_STASH))) return 'disabled';
  return installKind(root) !== null ? 'active' : 'absent';
}

/** `_harness_mcp._registered_targets` — (host, scope, root) for every registered root. */
export function registeredTargets() {
  const out = [];
  for (const root of registryRoots()) {
    const hs = emitHostScopeOf(root);
    if (hs) out.push([hs[0], hs[1], root]);
  }
  return out;
}

/**
 * `_harness_mcp._install_targets` — every (host, scope, root) an install may live at,
 * most-local first.
 *
 * De-duplicated on the (host, RESOLVED path) pair, which is three behaviours in one rule: a
 * cwd carrying both `.opencode/` and `.claude/` yields two correctly-typed rows, a cwd that
 * IS a global config dir never doubles its own host's row, and a registered root that is also
 * the cwd never doubles either. `pyResolve` rather than `path.resolve` because Python's
 * `Path.resolve()` returns the filesystem's own casing — on Windows two spellings of the same
 * directory differ as strings and not as installs, and this Set is keyed by string.
 */
export function installTargets() {
  const out = [];
  const seen = new Set();

  const add = (host, scope, root) => {
    // A "project" whose marker dir IS this host's global config dir is the global install
    // seen from its parent (the daemon's cwd is $HOME, where $HOME/.claude == ~/.claude) —
    // not a separate project. Surfacing it would alias the global's files.
    if (scope !== 'global') {
      try {
        const spec = HOSTS.find((h) => h.host === host);
        if (pyResolve(path.join(root, spec.projectMarker)) === pyResolve(spec.configDir())) {
          return;
        }
      } catch { /* as the Python's bare `except Exception: pass` */ }
    }
    const key = `${host}\0${pyResolve(root)}`;
    if (!seen.has(key)) { seen.add(key); out.push([host, scope, root]); }
  };

  const cwd = process.cwd();
  for (const { host, projectMarker } of HOSTS) {
    if (isDir(path.join(cwd, projectMarker))) add(host, 'project', cwd);
  }
  for (const { host, configDir } of HOSTS) {
    try { add(host, 'global', configDir()); } catch { /* a missing host dir is not fatal */ }
  }
  for (const [host, scope, root] of registeredTargets()) add(host, scope, root);
  return out;
}

// ---- what this machine installed (`_harness_setup._installed_defaults`) --------------------

/**
 * `_harness_setup._installed_defaults` — all five keys, as of P5i.
 *
 * It carried only `theme` and `emit` for four phases because those are the two `status`
 * prints and the two `doctor` reads, and the port's keep-vs-delete rule is "part of an
 * asserted partition", not "the Python has it". `setup` is the caller the debt was recorded
 * against: `collectSetupLines` pre-selects the posture, mode and footprint picker at
 * `inst.posture` / `inst.mode` / `inst.footprint`, so a three-key answer would have silently
 * pre-selected the CONFIGURED default over the DEPLOYED one on three of its five questions.
 * Nothing in `status` or `doctor` moves: both read the keys they already read.
 */
export function installedDefaults() {
  const found = { theme: null, posture: null, mode: null, emit: null, footprint: null };
  const candidates = [];
  for (const { host, configDir } of HOSTS) {
    try { candidates.push([configDir(), `${host}-global`]); } catch { /* as the Python */ }
  }
  // One cwd-relative bundle candidate — `ROOT / "Harness"` and `ROOT.parent / "Harness"`
  // left with the Python's, see `_harness_setup._installed_defaults` for the argument.
  candidates.push([path.join(process.cwd(), 'Harness'), null]);
  for (const [base, knownEmit] of candidates) {
    if (found.emit === null) {
      const em = path.join(base, '.geneseed-emit');
      if (isFile(em)) {
        found.emit = (readMaybe(em) ?? '').trim() || null;
      } else if (isFile(path.join(base, GLOBAL_MANIFEST))) {
        // A manifest with no emit marker: a known config dir names its own host; a bundle
        // tells Claude from OpenCode by shape.
        found.emit = knownEmit
          ?? (manifestIsClaude(base) ? 'claude-global' : 'opencode-global');
      }
    }
    if (found.theme === null) found.theme = themeOfDir(base) ?? null;
    if (found.posture === null) found.posture = postureOfDir(base) ?? null;
    if (found.mode === null) found.mode = modeOfDir(base) ?? null;
    // `found["footprint"] is None` in the Python, so only the FIRST marker on the walk
    // speaks — and `footprintOfDir` never answers null, which is why a boolean stood in for
    // the value while nothing read it.
    if (found.footprint === null && isFile(path.join(base, '.geneseed-footprint'))) {
      found.footprint = footprintOfDir(base);
    }
  }
  return found;
}
