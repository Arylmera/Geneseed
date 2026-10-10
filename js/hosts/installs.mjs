/**
 * How a DEPLOYED install is recognised — `_harness_setup`'s detection half and
 * `_harness_mcp`'s registry-reading half, which are one subject in two Python files.
 *
 * EXTRACTED IN P5f, and by the same arithmetic that produced `js/hosts/hosts.mjs` and
 * `js/build/source.mjs`: this is the third verb-set to need it. P5d wrote `themeOfDir` and
 * `footprintOfDir` inside `js/inspect/status.mjs` because `status` was the only caller; `diff`
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
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { CONFIG, PACK_ORDER, THEMES, discoverNames, resolveSkillNames } from '../build/source.mjs';
import {
  CLAUDE_STYLE, DISABLED_STASH, GLOBAL_MANIFEST, HOSTS, isHostGlobalDir, resolvePath,
} from './hosts.mjs';
import { registryRoots } from '../inspect/registry.mjs';
import { printErr, readText, isFile, isDir } from '../lib/fs.mjs';
import { formatRepr, isDict } from '../lib/json.mjs';
import { comparePaths } from '../lib/paths.mjs';
import { claudeHookShell } from './shim.mjs';

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
// `bin/build-driver.mjs`, which answers `geneseed build` — the case where there is no install to
// ask in the first place.

// ---- theme, footprint, posture, mode, read back off a deployed tree -----------------------

/**
 * `_build_render.theme_files` — shipped themes, `_`-prefixed scaffolds excluded.
 *
 * `dir` defaults to the checkout's own `themes/`, which is every caller but one: P2's
 * `syncThemes` is driven over a FIXTURE directory by the corpus in
 * `tests/unit/maintainer_tools.test.mjs`, because the tool it belongs to rewrites committed
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
 * `_harness_setup.CARRIERS` — the Python's four root-level carriers, plus one JS-only addition.
 *
 * A shared table rather than three copies of the same list: `_theme_of_dir`,
 * `_posture_of_dir` and `_mode_of_dir` each walk it, and the order is observable (the first
 * carrier that answers wins). `rules/geneseed.md` is spelled with `path.join` at each use
 * because the Python writes `d / "rules" / "geneseed.md"` for that one entry.
 *
 * `.openclaude/CLAUDE.md` is NOT in the Python — OpenClaude didn't exist yet — and it is half
 * of the fix for host-compat verdict B1 (the other half is `carriersFor`, below).
 * OpenClaude's own per-repo carrier is `carrierInLayer` (see `CLAUDE_SHAPED.openclaude` in
 * `js/build/driver.mjs`, and the `HOSTS` column of the same name): it sits at
 * `<repo>/.openclaude/CLAUDE.md`, and the root `CLAUDE.md` is deliberately left untouched so a
 * Claude Code install can share the repo.
 *
 * ⚠ THIS LIST STAYS HOST-AGNOSTIC ON PURPOSE — it is only `firstCarrier`'s FALLBACK for a
 * caller with no host to narrow by (none of this module's exported `*OfDir` readers is one;
 * see `carriersFor`). A caller that DOES have a host must pass it, or in a repo sharing two
 * carriers that answer the same probe — only root `CLAUDE.md` today, between `claude` and
 * `openclaude`'s global scope — this host-agnostic order decides for both of them, which was
 * exactly B1's failure mode reversed: reading `.openclaude/CLAUDE.md` unconditionally made
 * `claude`'s OWN read-back answer OpenClaude's settings in a shared repo.
 */
const CARRIERS = [
  'AGENT.md', path.join('.openclaude', 'CLAUDE.md'), 'CLAUDE.md',
  path.join('rules', 'geneseed.md'), 'AGENTS.md',
];

/**
 * `host`'s own carrier path(s), narrowed off the single `HOSTS` table — `carrierInLayer` and
 * `projectMarker`/`agentFile` — rather than a second hand-rolled host→carrier map.
 *
 * ONE HOST, ONE ANSWER, EXCEPT BOB. `carrierInLayer` true (OpenClaude only) tries the nested
 * per-repo path FIRST and the bare `agentFile` SECOND, because the same column name means two
 * different locations depending on scope: `<repo>/.openclaude/CLAUDE.md` for a project
 * install, `<cfgDir>/CLAUDE.md` for a global one (see `CLAUDE_SHAPED.openclaude-global`,
 * which has no `carrierInLayer`). Bob is the one host with a second, differently-NAMED
 * carrier — `rules/geneseed.md` at global scope, because Bob never auto-loads a global
 * `AGENTS.md` (`CLAUDE_SHAPED['bob-global']`'s summary says so) — which `HOSTS` has no column
 * for and this hard-codes, same as the un-narrowed `CARRIERS` above always did.
 */
function carriersFor(host) {
  const row = HOSTS.find((h) => h.host === host);
  if (!row) return CARRIERS;
  if (host === 'bob') return [path.join('rules', 'geneseed.md'), row.agentFile];
  return row.carrierInLayer
    ? [path.join(row.projectMarker, row.agentFile), row.agentFile]
    : [row.agentFile];
}

/**
 * The scan `themeOfDir`, `leadOfDir`, `doctrinesOfDir` and `excludedRulesOfDir` each wrote
 * out: try each carrier in order, first answer wins. `probe(carrierPath)` returns
 * `undefined` to mean "keep looking" and anything else — including `null` or `[]`, both
 * legitimate stop values for the two register readers below — to mean "stop, this is the
 * answer". `fallback` is what every caller's own trailing `return …;` supplied once the
 * whole list was exhausted with no answer.
 *
 * `host`, when given, narrows the scan to THAT HOST'S OWN carrier(s) via `carriersFor` —
 * `null` (the default) keeps today's full, host-agnostic `CARRIERS` walk, so every call site
 * this task's fix round did not touch is unchanged. Every exported reader below takes the
 * same optional `host` last, mirroring `trustOfDir`'s existing `(d, host = null)` shape one
 * screen down — this is not a new convention, it is that one applied to the carrier scan too.
 *
 * ⚠ HOST-NARROWED: THE FIRST CANDIDATE THAT EXISTS IS AUTHORITATIVE, EVEN IF ITS PROBE COMES
 * BACK `undefined`. `undefined` is overloaded on purpose for the host-agnostic walk above (it
 * means BOTH "this carrier is absent" and "this carrier exists but says nothing"), and that
 * is exactly right for `CARRIERS`, where only one entry can ever exist for a given host —
 * but `carriersFor` can return TWO paths for one host (OpenClaude's nested-then-bare
 * `CLAUDE.md`; Bob's `rules/geneseed.md`-then-`AGENTS.md`), and "exists but says nothing" is
 * the COMMON case for `excludedRulesOfDir`/`excludedSkillsOfDir` — their marker line is
 * written only when something is excluded. Falling through past an existing-but-silent own
 * carrier to the SECOND candidate let it read a sibling host's file that happens to sit at
 * that second path (root `CLAUDE.md`, for OpenClaude's second candidate, in a repo also
 * carrying a Claude install) — the fix-round-1 bug, reversed again. So once a host is given,
 * `isFile` on each candidate (checked AFTER the probe, so a non-existent file's `undefined`
 * still falls through to try the host's OWN next candidate — the one legitimate reason the
 * list has two entries) stops the walk at the first one that exists and returns `fallback`,
 * never a later file's answer.
 */
function firstCarrier(d, probe, fallback = null, host = null) {
  for (const carrier of (host === null ? CARRIERS : carriersFor(host))) {
    const carrierPath = path.join(d, carrier);
    const result = probe(carrierPath);
    if (result !== undefined) return result;
    if (host !== null && isFile(carrierPath)) return fallback;
  }
  return fallback;
}

/**
 * A marker value that can only name a file directly in the themes dir: no separator, no `..`,
 * and not a `_`-prefixed scaffold.
 */
const THEME_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * `_harness_setup._theme_of_dir` — the marker, else the sigil in one of five carriers.
 *
 * The marker's value becomes `<themes>/<name>.json` in `loadTheme`, so a path in it
 * (`../harness.config`) loaded any `.json` as a theme. A value that is not a plain name falls
 * through to the sigil scan, as a missing marker does. A plain name that is not shipped is
 * still RETURNED: `loadTheme` then refuses it loudly, which `status`/`rebuild-all`/`migrate`
 * cells pin ("unknown theme 'nosuchtheme'"), rather than a typo going unnoticed.
 *
 * `host`, when given, narrows the sigil scan to that host's own carrier — see `firstCarrier`.
 *
 * ⚠ THE ROOT MARKER ITSELF IS HOST-NARROWED TOO (host-compat B1, round 3): `driver.mjs` writes
 * it at `d` unconditionally for a GLOBAL emit (every host's `-global` arm, the `writeText`
 * right after `writeMarkers`), but at PROJECT scope only for a host whose emit calls `build()`
 * directly — today that is `opencode` alone; the CLAUDE-STYLE hosts (`claude`/`bob`/
 * `openclaude`, `CLAUDE_STYLE` below) go through `claudeShaped` instead, which never calls it
 * (`driver.mjs`'s own comment: "Deliberately not written for the claude/bob/openclaude
 * PROJECT emits"). So a claude-style host must distrust this marker UNLESS `d` is provably
 * that host's OWN global config dir — `isHostGlobalDir` (`hosts.mjs`), which is what makes this
 * scope-correct without a `scope` parameter: at ANY other `d` (a project root, or another
 * host's global dir entirely) a claude-style host's project emit never wrote this file, so a
 * present one is a SIBLING's (`opencode`'s project marker, in a shared repo — the B1 failure,
 * reached a third way) and `themeOfDir` falls through to `firstCarrier`'s sigil scan instead,
 * exactly as it already must for a claude-style host's own project installs.
 */
export function themeOfDir(d, host = null) {
  let trust = host === null || !CLAUDE_STYLE.includes(host);
  // A `configDir()` that throws cannot prove `d` is the global: distrust the marker.
  try { trust ||= isHostGlobalDir(host, d); } catch { /* sigil scan below */ }
  if (trust) {
    const marker = path.join(d, '.geneseed-theme');
    if (isFile(marker)) {
      const name = (readMaybe(marker) ?? '').trim();
      if (THEME_NAME_RE.test(name)) return name;
    }
  }
  return firstCarrier(d, (carrierPath) => themeFromAgent(carrierPath) || undefined, null, host);
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
      printErr(`[geneseed] WARN: ${marker} holds unknown footprint ${formatRepr(v)} — `
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
 * would go unnoticed — the former Python corpus covered it, and no test drives it now.
 */
export function capitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

function leadOfDir(d, names, host = null) {
  return firstCarrier(d, (carrierPath) => {
    const text = readMaybe(carrierPath);
    if (text === null) return undefined;
    for (const name of names) {
      if (text.includes(`**${capitalize(name)}**`)) return name;
    }
    return undefined;
  }, null, host);
}

export const postureOfDir = (d, host = null) => leadOfDir(d, discoverNames('postures', 'peer'), host);
export const modeOfDir = (d, host = null) => leadOfDir(d, discoverNames('modes', 'direct'), host);

/**
 * The loop skill's default trust preset, read back off a deployed install — `null` when no
 * loop skill is deployed there.
 *
 * CARRIED BY THE SKILL, NOT BY A CARRIER: `--trust` is the one build axis with zero always-on
 * footprint, so it is not in AGENT.md to be found. The skill renders a literal
 * `Default trust preset: **<Label>**` line, and this scans the places an emit lands it: the
 * native layer (`skills/loop/SKILL.md`, in the root itself for a global install and under the
 * host's `projectMarker` for a project one) and the plain bundle (`skills/loop.md`).
 *
 * `host` narrows the project dirs to that host's own: in a repo carrying `.opencode/` AND
 * `.claude/`, the Claude row otherwise read OpenCode's preset, since OpenCode comes first in
 * `HOSTS`. Without it every host's dir is tried, in `HOSTS` order — the caller that has no host.
 */
const TRUST_RE = /^Default trust preset: \*\*(Prudent|Balanced|Aggressive)\*\*/m;
export function trustOfDir(d, host = null) {
  const rows = host === null ? HOSTS : HOSTS.filter((h) => h.host === host);
  for (const base of ['', ...rows.map((h) => h.projectMarker)]) {
    for (const rel of [['skills', 'loop', 'SKILL.md'], ['skills', 'loop.md']]) {
      const m = TRUST_RE.exec(readMaybe(path.join(d, base, ...rel)) ?? '');
      if (m) return m[1].toLowerCase();
    }
  }
  return null;
}

/** The `Active packs:` marker line the template emits, in one of the five carriers. */
const ACTIVE_PACKS_RE = /^Active packs:[ \t]*(.+?)[ \t]*$/m;

/**
 * A carrier rendered BEFORE the comms pack existed — the address migration's one detector.
 *
 * The comms pack took `process 7` (reference codes) out of process, and `process 8` (one
 * writer per file) was renumbered to `process 7`. An install built before that names
 * `process` in its marker and not `comms`, and so does a later install whose owner turned
 * comms OFF — the marker alone cannot tell them apart. The carrier text can: a pre-comms
 * process pack had eight rules, so wherever it was active the carrier renders a
 * `process 8` heading, and wherever that rule was excluded the `Excluded rules:` line names
 * it. No current carrier can say `process 8` — the pack has seven rules and nothing cites
 * an eighth.
 *
 * ponytail: text sniff, not a stamp. It holds only while process has seven rules; the day
 * process gets an eighth, this must move to a build stamp (or be retired, once no install
 * built before the migration can remain).
 */
const legacyProcessCarrier = (text) => /\bprocess 8\b/.test(text);

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
export function doctrinesOfDir(d, host = null) {
  return firstCarrier(d, (carrierPath) => {
    const text = readMaybe(carrierPath);
    if (text === null) return undefined;
    const m = ACTIVE_PACKS_RE.exec(text);
    if (!m) return undefined;
    if (m[1] === 'none') return [];
    const named = m[1].split(',').map((s) => s.trim());
    if (!named.every((n) => PACK_ORDER.includes(n))) return null;
    // MIGRATION: a pre-comms install that carried process carried the codes rule inside it,
    // so it keeps that rule by gaining comms. Its old `process 7` exclusion, if any, is
    // re-addressed to `comms 1` by `excludedRulesOfDir` in the same pass.
    if (named.includes('process') && !named.includes('comms') && legacyProcessCarrier(text)) {
      named.push('comms');
    }
    return PACK_ORDER.filter((pk) => named.includes(pk));
  }, null, host);
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
 * `geneseed build`, which `configDefaults()` in `bin/build-driver.mjs` answers. Anything holding a
 * directory has an install to ask, so it calls this and never the config.
 *
 * `[]` still passes through untouched — a marker that reads `none` is an answer, not a silence.
 */
export function doctrinesForBuild(d, host = null) {
  return doctrinesOfDir(d, host) ?? [...PACK_ORDER];
}

/** `Excluded rules: process 7, craft 3` — the marker's optional second line. */
const EXCLUDED_RULES_RE = /^Excluded rules:[ \t]*(.+?)[ \t]*$/m;

/**
 * The individual doctrine rules a DEPLOYED install left out — the second axis, read back.
 *
 * ⚠ ITS NULL SEMANTICS ARE THE OPPOSITE OF `doctrinesOfDir`'S, AND THAT IS THE POINT. A
 * missing `Active packs:` line means "this install does not say", which has to resolve to
 * ALL packs or a pre-migration install loses its consent gate on the next upgrade. A missing
 * `Excluded rules:` line means "nothing was excluded" — because the line is only ever written
 * when something is, so its absence is a STATEMENT rather than a silence. Both answers fail
 * closed: unknown packs bind the most, unknown exclusions take away the least. They only look
 * inconsistent until you ask which direction is safe for each.
 *
 * That is also what makes this backward compatible by construction: every install that exists
 * today has no such line, reads as `[]`, and behaves exactly as it does now.
 *
 * A malformed entry condemns the whole line to `[]` rather than to the part that parsed —
 * same rule as the pack list, same reason, opposite default. Half an exclusion list would
 * take away rules nobody named.
 */
export function excludedRulesOfDir(d, host = null) {
  return firstCarrier(d, (carrierPath) => {
    const text = readMaybe(carrierPath);
    if (text === null) return undefined;
    const m = EXCLUDED_RULES_RE.exec(text);
    if (!m) return undefined;
    if (m[1] === 'none') return [];
    const named = m[1].split(',').map((s) => s.trim());
    // `<pack> <n>` on the page, `<pack>.<n>` in the code — the same asymmetry the rendered
    // line documents. A name this checkout does not ship is a corrupt line, not a hint.
    const ids = named.map((s) => {
      const parts = s.split(/[ \t]+/);
      return parts.length === 2 && PACK_ORDER.includes(parts[0]) && /^\d+$/.test(parts[1])
        ? `${parts[0]}.${Number(parts[1])}` : null;
    });
    if (!ids.every(Boolean)) return [];
    // MIGRATION: the same pre-comms carrier spells the old addresses — see
    // `legacyProcessCarrier`. One map, applied once, so `process 8` cannot chain onward.
    const MOVED = { 'process.7': 'comms.1', 'process.8': 'process.7' };
    const out = legacyProcessCarrier(text) ? ids.map((id) => MOVED[id] ?? id) : ids;
    return [...new Set(out)].sort();
  }, [], host);
}

/** `Excluded skills: bruno, daydream` — written only when something is excluded. */
const EXCLUDED_SKILLS_RE = /^Excluded skills:[ \t]*(.+?)[ \t]*$/m;

/**
 * The skills a DEPLOYED install left out, read back so `upgrade`, `rebuild-all` and `diff`
 * re-render the same set. Same semantics as `excludedRulesOfDir`: a missing line is `[]`
 * (nothing excluded), and a name this checkout does not ship condemns the whole line to `[]`
 * — re-admitting a skill is the safe direction, and the flag would refuse the name anyway.
 *
 * A name that only got OLDER is not unknown: an alias reads back as its target and a retired
 * name drops out (`resolveSkillNames`), so a skill merge does not quietly re-admit everything
 * else the install left out. Silent unless the caller passes `notify` — status, diff and the
 * console call this on every read; the replays that rebuild an install (`rebuild-all`,
 * `upgrade`, `migrate`) pass it. `host` is last, after `notify`, for the same reason
 * `trustOfDir` puts it last: every existing positional call keeps working unchanged.
 */
export function excludedSkillsOfDir(d, notify = null, host = null) {
  return firstCarrier(d, (carrierPath) => {
    const text = readMaybe(carrierPath);
    if (text === null) return undefined;
    const m = EXCLUDED_SKILLS_RE.exec(text);
    if (!m) return undefined;
    const { ids, notices, unknown } = resolveSkillNames(m[1].split(',').map((s) => s.trim()).filter(Boolean));
    if (unknown.length) return [];
    if (notify) for (const n of notices) notify(n);
    return ids;
  }, [], host);
}

// ---- what host a deployed dir belongs to (`_harness_mcp`) ---------------------------------

/** `_harness_mcp._claude_read_manifest`. */
export function claudeReadManifest(cfgDir) {
  const data = readJsonMaybe(path.join(cfgDir, GLOBAL_MANIFEST));
  return isDict(data) ? data : {};
}

/**
 * `_harness_mcp._manifest_is_claude` — keyed on the `managed` MAP, not on `claude_md`: a Bob
 * global emit ships no AGENTS.md and records no `claude_md`, and still needs the
 * Claude-style reversal.
 */
export function manifestIsClaude(cfgDir) {
  return isDict(claudeReadManifest(cfgDir).managed);
}

/**
 * `_harness_mcp._EMIT_HOST_SCOPE` — a marker's emit name fixes (host, scope). Derived from
 * `HOSTS`, whose emit names are `<host>` and `<host>-global`, so a new host is one row there.
 */
export const EMIT_HOST_SCOPE = new Map(HOSTS.flatMap(({ host }) => [
  [host, [host, 'project']], [`${host}-global`, [host, 'global']],
]));

/** `_harness_mcp._emit_host_scope_of` — `root`'s own marker, resolved, or null. */
export function emitHostScopeOf(root) {
  const emit = readMaybe(path.join(root, '.geneseed-emit'));
  if (emit === null) return null;
  return EMIT_HOST_SCOPE.get(emit.trim()) ?? null;
}

// `DISABLED_STASH` moved to `hosts.mjs`: the hook stand-down reads it and must not import this.
export { DISABLED_STASH };

/**
 * `_harness_mcp._claude_cfg` — where a Claude-STYLE install keeps its manifest.
 *
 * The config dir itself for a global install; `<repo>/<project_marker>` for a project one.
 * Host-aware so Bob and OpenClaude ride the whole Claude lifecycle with only the subdir
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
  if (CLAUDE_STYLE.includes(host)) return claudeState(root, scope, host);
  if (isDir(path.join(root, DISABLED_STASH))) return 'disabled';
  return installKind(root) !== null ? 'active' : 'absent';
}

/**
 * Host-compat verdict I1: an OpenClaude PROJECT install is additive, never exclusive — it loads
 * its own `<repo>/.openclaude/CLAUDE.md` **and** whatever root `CLAUDE.md`/`AGENTS.md` a claude
 * or bob PROJECT install already wrote there (`B/src/utils/claudemd.ts` l.904-928; `CARRIERS`
 * above deliberately leaves the root file untouched for OpenClaude so a Claude/Bob install can
 * share the repo). There is no clean fix: excluding the root file would hide the user's OWN
 * content in it too, so the only thing `status`/`doctor` can do is say the doubling exists.
 *
 * `installState` on the two hosts is enough — a claude/bob PROJECT install is 'active' only
 * once it has actually written its own `.claude`/`.bob` manifest, which is exactly when it has
 * also written the root carrier.
 */
export function openclaudeDualHarnessRoot(root) {
  if (installState(root, 'openclaude', 'project') !== 'active') return false;
  return installState(root, 'claude', 'project') === 'active'
    || installState(root, 'bob', 'project') === 'active';
}

/** Every PROJECT root `installTargets()` reaches where `openclaudeDualHarnessRoot` is true. */
export function openclaudeDualHarnessRoots() {
  const roots = new Set();
  for (const [, scope, root] of installTargets()) {
    if (scope === 'project') roots.add(resolvePath(root));
  }
  return [...roots].filter(openclaudeDualHarnessRoot).sort(comparePaths);
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
 * the cwd never doubles either. `resolvePath` rather than `path.resolve` because Python's
 * `Path.resolve()` returns the filesystem's own casing — on Windows two spellings of the same
 * directory differ as strings and not as installs, and this Set is keyed by string.
 */
export function installTargets() {
  const out = [];
  const seen = new Set();

  const add = (host, scope, root) => {
    // A "project" whose marker dir IS this host's global (`isHostGlobalDir`: the env-resolved
    // dir, the default `~/<marker>`, or a `-global` emit) is the global install seen from its
    // parent (the daemon's cwd is $HOME, where $HOME/.claude == ~/.claude) — not a separate
    // project. Surfacing it would alias the global's files, and `rebuild-all` would re-emit it
    // as a project rooted at $HOME (final review C2, under `$CLAUDE_CONFIG_DIR`).
    if (scope !== 'global') {
      try {
        const spec = HOSTS.find((h) => h.host === host);
        if (isHostGlobalDir(host, path.join(root, spec.projectMarker))) return;
      } catch { /* as the Python's bare `except Exception: pass` */ }
    }
    const key = `${host}\0${resolvePath(root)}`;
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

/**
 * Each Claude install whose emitted hook FORM no longer matches this machine's hook shell
 * (`claudeHookShell`; Task 15) — the "Git Bash removed after the emit" gap, which otherwise
 * reports nothing: hooks signal through stdout and Claude treats a parse error as non-blocking.
 *
 * Bash form with Git Bash now gone is a PROBLEM (every hook, both gates included, fails open
 * under PowerShell). PowerShell form with Git Bash now present is a `[note]`: the hooks work,
 * they only pay PowerShell's startup. Read from the manifest's recorded claims — the form the
 * emit wrote — not re-derived; Windows only, since nowhere else has two hook shells. `targets`
 * and `platform` are parameters so a test can hand it a sandboxed install.
 */
export function hookShellProblems(targets = installTargets(), platform = process.platform) {
  if (platform !== 'win32') return [];
  const now = claudeHookShell(process.env, platform);
  const out = [];
  for (const [host, scope, root] of targets) {
    // A disabled install's manifest still records the hooks it unwired: nothing runs, nothing drifts.
    if (host !== 'claude' || claudeState(root, scope) !== 'active') continue;
    const cfg = claudeCfg(root, scope);
    const recorded = readJsonMaybe(path.join(cfg, GLOBAL_MANIFEST))?.managed?.settings_hooks;
    const handlers = (Array.isArray(recorded) ? recorded : [])
      .flatMap((r) => (Array.isArray(r?.group?.hooks) ? r.group.hooks : []));
    if (!handlers.length) continue;
    const was = handlers.some((h) => h?.shell === 'powershell') ? 'powershell' : 'bash';
    if (was === now) continue;
    out.push(was === 'bash'
      ? `[hooks] ${cfg}: hooks were emitted for Git Bash, which is no longer found, so Claude Code `
        + 'runs them under PowerShell where they fail open (no gate fires) - run: geneseed rebuild-all'
      : `[note] ${cfg}: hooks were emitted for PowerShell, but Git Bash is now found - they work, `
        + 'and pay PowerShell startup on every call; geneseed rebuild-all switches them back');
  }
  return out;
}

// ---- what this machine installed (`_harness_setup._installed_defaults`) --------------------

/**
 * `_harness_setup._installed_defaults` — all six keys.
 *
 * It carried only `theme` and `emit` for four phases because those are the two `status`
 * prints and the two `doctor` reads, and the port's keep-vs-delete rule is "part of an
 * asserted partition", not "the Python has it". `setup` is the caller the debt was recorded
 * against: `collectSetupLines` pre-selects the posture, mode and footprint picker at
 * `inst.posture` / `inst.mode` / `inst.footprint`, so a three-key answer would have silently
 * pre-selected the CONFIGURED default over the DEPLOYED one on three of its five questions.
 * Nothing in `status` or `doctor` moves: both read the keys they already read.
 *
 * `doctrines` joined last, for the same reason and one phase later: the wizard's pack question
 * shipped before the marker reader existed, so it defaulted to `all` for everyone and re-asked
 * an installer who had already narrowed their selection. ⚠ THIS KEY IS THE ONE WITH THREE
 * STATES, and the `=== null` tests below preserve all three: `null` is "no carrier on this
 * machine said", `[]` is a carrier that said `none`, a list is a carrier that named packs.
 * Only a WIZARD may read it — it is a pre-selection shown to a human who then answers. No
 * build-side consumer resolves a pack set from here; that is `doctrinesForBuild(dir)`, which
 * asks one named install rather than whichever candidate this walk happens to reach first.
 */
export function installedDefaults() {
  const found = {
    theme: null, posture: null, mode: null, emit: null, footprint: null, doctrines: null,
    excludeRules: null, excludeSkills: null,
  };
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
    // `doctrinesOfDir` and not `doctrinesForBuild`: the resolved form answers `[...PACK_ORDER]`
    // for a carrier with no marker, which would end this walk at the FIRST candidate and hide
    // a later carrier that does say. The null has to survive to the caller here.
    if (found.doctrines === null) found.doctrines = doctrinesOfDir(base);
    // ⚠ THE PER-RULE AXIS HAS ONLY TWO STATES, so the walk cannot use `=== null` to mean
    // "keep looking" the way the line above does — `excludedRulesOfDir` answers `[]` for a
    // carrier that excludes nothing AND for one with no marker at all, and the empty list is a
    // real answer. An EMPTY answer therefore keeps the walk going and a non-empty one stops it:
    // the first carrier on this machine that actually names an exclusion is the one that
    // pre-selects. The cost of that choice is that "excludes nothing" and "no carrier" are
    // indistinguishable here, which is exactly what the marker itself already says.
    if (!found.excludeRules?.length) found.excludeRules = excludedRulesOfDir(base);
    if (!found.excludeSkills?.length) found.excludeSkills = excludedSkillsOfDir(base);
  }
  return found;
}
