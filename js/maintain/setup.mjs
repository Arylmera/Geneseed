/**
 * The install wizard — the LINE-MODE flow, and the first verb in
 * this port that reads stdin.
 *
 * WHAT `setup` ACTUALLY IS, measured rather than taken from the brief. `cmd_setup` is 21
 * lines and every one of them is a dispatch:
 *
 *     not sys.stdin.isatty()   -> two lines on stderr, exit 1
 *     curses.wrapper(_setup_flow)  -> the full-screen wizard — `_harness_tui_views`, P7's
 *     any exception from that  -> `[setup] TUI unavailable (…); using prompts.` + _setup_lines
 *
 * So it has the same shape as `cmd_menu` and `cmd_home`, which the P5i brief excluded from
 * P5 for exactly that reason: a thin dispatcher whose loud arm belongs to a later phase. An
 * import-following closure walk scored it at 1,307 LOC; a walk that also follows a callback
 * passed by NAME scores it at 2,687, and the ~1,100 difference is `_setup_flow`. The brief
 * named that blind spot for `cmd_menu` and did not apply it here.
 *
 * `setup` is still P5's, and the difference from `menu` is the phases table's own sentence:
 * P7 is descoped for GA and GA ships with "the text wizard + web console". `_setup_lines` IS
 * that text wizard. So the LINE arm crosses and the curses arm does not, and `cmdSetup` here
 * goes straight from the TTY check to `setupLines`.
 *
 * THAT IS A DIVERGENCE, and it is stated rather than hidden. On a TTY the reference tries
 * curses first and prints `[setup] TUI unavailable (…); using prompts.` when it fails; this
 * has no curses to try, so it prints nothing and starts asking. On Windows — where the
 * reference ALWAYS lands in the line wizard, because `import curses` is an ImportError —
 * the only difference between the two is that one stderr line. It is invisible to every
 * cell for the reason below, and it is P7's to reconcile when `_setup_flow` crosses.
 *
 * WHY NO CELL CAN REACH ANY OF THIS. `cmd_setup` refuses when `sys.stdin.isatty()` is false,
 * and a cell's stdin is a pipe. So the whole wizard is unreachable from the acceptance
 * matrix in the same way `_confirm` was in P5h — except that here it is not one branch, it
 * is the verb. The `setup/*` cells therefore gate the REFUSAL, absolutely and on both sides,
 * and everything past it is gated as a CORPUS in `tests/unit/wizard.test.mjs`.
 *
 * The corpus is a new shape and the brief predicted the reason: a corpus over a stdin reader
 * needs a SEEDED FD, not a string. `tests/fixtures/pure_probe.mjs` is run with stdin
 * redirected from a file of answers and its WHOLE stdout compared — so the prompts, the
 * numbered menus, the default markers, the `About to run:` line and the returned selection
 * are all one byte comparison. That is a stricter gate than a cell would have been, because
 * a cell could not have varied the answers at all.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { main as driverMain, parseDriverArgs, resolveOut } from '../build/driver.mjs';
import { preserveRefusal } from '../build/profile.mjs';
import { cmdLink } from '../hosts/link.mjs';
import { autostartInstall, autostartState } from '../hosts/shim.mjs';
import { loadProfile, profileBuildArgs } from './profiles.mjs';
import { playLine } from '../ui/anim.mjs';
import { discoverNames, GATE_SWITCHES, PACK_ORDER, loadKits } from '../build/source.mjs';
import { exportImprovements } from '../inspect/diff.mjs';
import { cmdDoctor } from '../inspect/doctor.mjs';
import { setupBuildArgs } from '../build/generate.mjs';
import { SHARED_TIER_BENEFIT, sharedTierCost, sharedTierFigure } from '../inspect/cost.mjs';
import { GLOBAL_MANIFEST, HOSTS, opencodeConfigDir } from '../hosts/hosts.mjs';
import {
  claudeCfg, defaultMode, defaultPosture, defaultTheme, EMIT_HOST_SCOPE, gatesOfDir, installedDefaults,
  readJsonMaybe, sharedTierOfDir, themeFiles,
} from '../hosts/installs.mjs';
import { printOut, printErr } from '../lib/fs.mjs';
import { which } from '../lib/paths.mjs';
import { ask, askChoice, confirm } from '../lib/prompt.mjs';
import { parseIntStrict } from '../lib/text.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';

// --------------------------------------------------------------------------------------
// the option tables
// --------------------------------------------------------------------------------------

/** A theme without one shows its bare name. */
const THEME_BLURBS = {
  neutral: 'plain professional voice',
  imperial: 'Warhammer 40k',
  military: 'ops / SOP / radio-brevity',
  pirate: 'high-seas crew',
  wizard: 'arcane grimoire',
  cyberpunk: 'netrunner',
  gamer: 'speedrunner / co-op',
  sports: 'play-by-play commentator',
};

const POSTURE_BLURBS = {
  peer: 'candid equal — dense, challenges, no flattery (default)',
  mentor: 'explains the why, checks understanding',
  expert: 'maximum density, no basics',
  assistant: 'precise execution, low initiative — you steer',
  artisan: 'peer with toolsmith reflexes — terminal-first',
};

const MODE_BLURBS = {
  direct: 'the agent works every task itself, turn by turn (default)',
  foreman: 'triages tasks, hands blocking work to task workers',
};

/**
 * One line per doctrine pack, written for someone who has never read `src/doctrines/README.md`
 * — this is the only description of a pack an installer ever sees.
 *
 * `process` says what turning it OFF costs, and it is the only one that has to. The other three
 * trade practices for context; process 5 is the commit/push consent gate, so dropping the pack
 * drops the rule that every commit and every push is asked for. A blurb that read "planning and
 * context economy" would have sold that away in a menu.
 */
const DOCTRINE_BLURBS = {
  craft: 'how code is written — reuse first, house conventions, docs, the smallest diff',
  rigor: 'how work is proven — idempotence, honest tests, coverage, gates that can fail',
  ops: 'how the machine is driven — tool discovery, non-blocking commands, teardown',
  process: 'how a session runs — planning, context economy, docs first, and the consent gate '
    + 'on every commit and push (drop this pack and that gate goes with it)',
  comms: 'how answers are presented — stable reference codes, a diagram or a table only where it earns its place',
};

/**
 * The sort key is `(name != "neutral", name)`, which floats `neutral` to the top and leaves
 * the rest alphabetical — a boolean sorts False before True in Python, and `false < true` is
 * the same order once both are numbers here. `themeFiles()` is already name-sorted, so the
 * comparator only has to move one element.
 */
export function themeOptions() {
  const opts = themeFiles().map((p) => {
    const stem = path.basename(p, '.json');
    return [stem, THEME_BLURBS[stem] ?? ''];
  });
  opts.sort((a, b) => {
    const ka = a[0] !== 'neutral';
    const kb = b[0] !== 'neutral';
    if (ka !== kb) return ka ? 1 : -1;
    return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
  });
  return opts.length ? opts : [['neutral', THEME_BLURBS.neutral]];
}

function postureOptions() {
  return discoverNames('postures', 'peer').map((n) => [n, POSTURE_BLURBS[n] ?? '']);
}

function modeOptions() {
  return discoverNames('modes', 'direct').map((n) => [n, MODE_BLURBS[n] ?? '']);
}

/**
 * The doctrine packs, in `PACK_ORDER` — the third option table, and the one that is a SET.
 *
 * The order is NARRATIVE and comes from `PACK_ORDER`; `discoverNames` only says which packs
 * this checkout actually ships. Ordering by discovery instead would read `craft, ops, process,
 * rigor` — it `.sort()`s — and the menu a human answers would stop matching the `Active packs:`
 * line the build writes, which is normalised into `PACK_ORDER` at the driver. Same intersection
 * the driver's `parseDoctrines` and the config loader take, for the same reason.
 */
export function doctrineOptions() {
  const known = discoverNames('doctrines', PACK_ORDER[0]);
  return PACK_ORDER.filter((n) => known.includes(n)).map((n) => [n, DOCTRINE_BLURBS[n] ?? '']);
}

/**
 * Exported since P6b: `/api/themes` returns the same nine as its `emits` list, and a copy
 * of a table under test silently stops being the table under test.
 */
export const EMIT_OPTIONS = [
  ['opencode-global', 'OpenCode global config dir — every repo inherits it (recommended).'],
  ['claude-global', 'Claude Code global config dir (~/.claude) — CLAUDE.md, agents, skills, hooks.'],
  ['opencode', 'Per-repo .opencode/ layer committed into one repository.'],
  ['claude', 'Per-repo CLAUDE.md + .claude/ committed into one repository.'],
  ['bob-global', 'IBM Bob global config dir (~/.bob) — rules/geneseed.md, agents, skills, settings.json.'],
  ['bob', 'Per-repo AGENTS.md + .bob/ for IBM Bob, committed into one repository.'],
  ['files', 'Plain bundle for any AGENT.md tool.'],
  // Appended AFTER `files`, not beside the other hosts: the menu is answered by number, and a
  // scripted `setup` that pipes its answers must keep meaning what it meant.
  ['openclaude-global', 'OpenClaude global config dir (~/.openclaude) — CLAUDE.md, agents, skills, hooks.'],
  ['openclaude', 'Per-repo .openclaude/ (CLAUDE.md, agents, skills, hooks) for OpenClaude, committed into one repository.'],
];

const FOOTPRINT_OPTIONS = [
  ['lean', 'Lean — terse rule lines + a pointer to the full laws file (default, lighter context).'],
  ['full', 'Full — every law\'s complete text inlined in AGENT.md.'],
];

// --------------------------------------------------------------------------------------
// the gather
// --------------------------------------------------------------------------------------

/**
 * The Doctrine-packs question — one `all`/`choose` gate, then a y/n per pack.
 *
 * TWO LEVELS RATHER THAN FOUR QUESTIONS, because the overwhelmingly common answer is "all of
 * them" and a wizard that asks four yes/nos to get there taxes every install for the rare one.
 * The gate's default is `all`, so an installer who holds Enter through the whole wizard gets
 * the full set — which is what every pre-packs install already had.
 *
 * `askChoice` and not `confirm` for the per-pack question: `confirm` reads the first character
 * and prints no description, so the pack's blurb — the only place a reader is told what the
 * pack costs — would have nowhere to go. Two named options give it a line.
 *
 * Answering `no` to all four is legal and yields `[]`, which `setupBuildArgs` spells
 * `--doctrines none`. That is a real configuration (invariants and ontology only), not a
 * mistake to guard against, so it is not second-guessed here.
 *
 * `deployed` is what the machine's carriers already say (`installedDefaults().doctrines`), and
 * it drives BOTH levels: a narrowed install opens on `choose` with its own packs pre-ticked,
 * so holding Enter through the wizard KEEPS the selection instead of silently widening it back
 * to all four. `null` — no carrier said — still opens on `all`, which is the same resolution
 * `doctrinesForBuild` gives unknown, so the wizard and the build agree about silence.
 *
 * ⚠ It never returns `null`, at either level, and `tests/unit/setup.test.mjs` pins that: this
 * is the one call site allowed to reach `setupBuildArgs` without a `doctrinesForBuild`
 * fallback, and that exemption is only sound while the function is total.
 */
function askDoctrines(deployed = null) {
  const opts = doctrineOptions();
  const all = opts.map(([n]) => n);
  const known = Array.isArray(deployed) ? all.filter((n) => deployed.includes(n)) : null;
  const narrowed = known !== null && known.length !== all.length;
  const pick = askChoice('Doctrine packs', [
    ['all', `${all.join(' + ')}${narrowed ? '' : ' (default)'}`],
    ['choose', `pick packs${narrowed ? ` (installed: ${known.join(', ') || 'none'})` : ''}`],
  ], narrowed ? 'choose' : 'all');
  if (pick !== 'choose') return all;
  return all.filter((name) => askChoice(`Include ${name} — ${DOCTRINE_BLURBS[name] ?? name}`,
    [['yes', `build ${name} into AGENT.md`], ['no', `leave ${name} out`]],
    known === null || known.includes(name) ? 'yes' : 'no') === 'yes');
}

/**
 * The Kits questions (spec A5): one yes/no per shipped kit, each defaulting to whether the install
 * has it on (`deployed`, its `Active kits:` marker), so holding Enter keeps the installed set. A
 * single pick could not hold two kits at once, which is why the menu became per kit when the second
 * kit shipped. Asked ONLY when this checkout ships a kit, so a kit-less wizard reads exactly the
 * stdin it always did (and has no kit to carry: `kitsOfDir` drops an unshipped one).
 * Returns the kit list, or null for none (`setupBuildArgs` omits `--kits`).
 */
export function askKits(deployed = null, kits = null) {
  try { kits ??= loadKits(); } catch (e) {
    process.stderr.write(`warning: kit question skipped — ${e.message}\n`);
    return null;
  }
  const on = (deployed ?? []).filter((k) => kits.has(k));
  const picked = [...kits].filter(([k, m]) => askChoice(`Kit ${k} — ${m.description ?? k}`,
    [['yes', `install the ${k} kit`], ['no', `leave ${k} out`]], on.includes(k) ? 'yes' : 'no') === 'yes');
  return picked.length ? picked.map(([k]) => k) : null;
}

/**
 * The shared-tier question, for a PROJECT install only (D11: a global install owns the tier).
 * The default is what the target install already says, so holding Enter keeps it; the trade is
 * printed above the question, with this machine's own token figure in place of the example.
 */
function askSharedTier(emit, root) {
  const [host] = EMIT_HOST_SCOPE.get(emit) ?? [];
  let on = false;
  try { on = sharedTierOfDir(resolveOut(root || '.'), host); } catch { /* unreadable: off */ }
  const figure = sharedTierFigure();
  printOut(`\nShared tier — Benefit: ${SHARED_TIER_BENEFIT}\n  Cost: ${sharedTierCost(figure ?? '0')}\n`);
  return askChoice('Shared tier for this project',
    [['no', 'this project reads only its own harness'], ['yes', 'also read your machine-wide tier']],
    on ? 'yes' : 'no') === 'yes';
}

/**
 * The six questions, the plan, the confirm.
 *
 * Returns the selection, or null when the confirm is declined. Every default is the
 * DEPLOYED value first (`installedDefaults`) and the CONFIGURED one second, which is why
 * P5i is the phase that had to give `installedDefaults` its posture, mode and footprint keys
 * back: three of the five questions read them.
 *
 * Doctrines reads the same walk, and joined it last because the `Active packs:` marker reader
 * did not exist when the question shipped. Until it did, every re-run of the wizard offered
 * `all` to an installer who had deliberately narrowed their packs — the one register where
 * holding Enter SILENTLY WIDENED a selection instead of keeping it. `inst.doctrines` is passed
 * whole, `null` included, because `askDoctrines` distinguishes "no carrier said" from "a
 * carrier said none" and the two open the question differently.
 */
/**
 * The gate switches of the one install a setup answer re-runs: the chosen emit's global config
 * dir, or the project/bundle root it names. Never another host's install — carrying its `off`
 * across would disarm a gate nobody switched off here. FAILS CLOSED: no install there, or a dir
 * that cannot be resolved, reads as all armed (`gatesOfDir` already fails closed per line).
 */
function targetGates(emit, out) {
  const [host, scope] = EMIT_HOST_SCOPE.get(emit) ?? [];
  try {
    if (!host) return gatesOfDir(resolveOut(out || 'Harness'));
    const dir = scope === 'global'
      ? HOSTS.find((h) => h.host === host).configDir() : resolveOut(out || '.');
    return gatesOfDir(dir, host);
  } catch {
    return Object.fromEntries(GATE_SWITCHES.map((g) => [g.key, true]));
  }
}

export function collectSetupLines(kitMap = null) {
  printOut('Geneseed setup — answer a few questions; nothing is written until you confirm.\n');
  const inst = installedDefaults();
  const theme = askChoice('Theme', themeOptions(), inst.theme || defaultTheme());
  const posture = askChoice('Posture', postureOptions(), inst.posture || defaultPosture());
  const mode = askChoice('Mode', modeOptions(), inst.mode || defaultMode());
  const doctrines = askDoctrines(inst.doctrines);
  // Kits on stay on (spec A3); `kitsOfDir` already dropped a retired one.
  const kits = askKits(inst.kits, kitMap);
  const emit = askChoice('Install mode', EMIT_OPTIONS, inst.emit || 'opencode-global');
  const footprint = askChoice('Footprint', FOOTPRINT_OPTIONS,
    inst.footprint || 'lean');
  let out = null;
  let root = null;
  let sharedTier = false;
  // Every PROJECT emit needs the repo root — claude/bob/openclaude included: without `--out`
  // their CLAUDE.md/.claude land in the generator's default ./Harness, where the host never
  // looks.
  if (['opencode', 'claude', 'bob', 'openclaude'].includes(emit)) {
    root = ask('Repo root to install into', '.');
    out = root;
    sharedTier = askSharedTier(emit, root);
  } else if (emit === 'files') {
    out = ask('Output dir for the bundle', 'Harness');
  }
  // The full pack list is passed as the elision default rather than left to `setupBuildArgs`'s
  // own: the menu the user just answered was built from `doctrineOptions()`, so "they picked
  // everything" must be judged against that same list, not against a second one.
  const allPacks = doctrineOptions().map(([n]) => n);
  // ⚠ PRESERVED, NOT ASKED. The wizard has no per-rule question — five registers is already
  // the ceiling for a prompt sequence somebody answers by holding Enter, and a rule list is a
  // console control, not a terminal one. But it must not be DROPPED either: re-running the
  // wizard on an install that excluded `process 5` would otherwise hand the consent gate back
  // without a word, which is the same silent widening the pack question was fixed for.
  //
  // `null` when there is nothing to preserve rather than `[]`: an empty list makes
  // `setupBuildArgs` spell `--exclude-rules none`, and that string would land in the
  // "About to run:" line every recorded wizard probe compares byte for byte.
  const excludeRules = inst.excludeRules?.length ? inst.excludeRules : null;
  // Skills left out are preserved the same way, and elide when there are none.
  const excludeSkills = inst.excludeSkills?.length ? inst.excludeSkills : null;
  // The gate switches too: a re-run that dropped them would re-arm every gate its owner switched
  // off. Read off the install THIS answer targets, never the machine walk above (`targetGates`).
  // `setupBuildArgs` elides an armed gate, so an all-armed install prints what it always did.
  const gates = targetGates(emit, out);
  const gated = Object.values(gates).some((on) => on === false);
  printOut(`\nAbout to run:  geneseed build ${
    setupBuildArgs(theme, emit, out, root, footprint, posture, mode, doctrines, allPacks,
      excludeRules, undefined, excludeSkills, gates, kits, sharedTier).join(' ')} --reset\n`);
  if (!confirm('Proceed?', true)) return null;
  // The key only when there is something to carry, so a selection that excludes no skill and
  // switches off no gate is the same object it was before either existed.
  return {
    theme, posture, mode, doctrines, excludeRules, ...(excludeSkills ? { excludeSkills } : {}),
    ...(gated ? { gates } : {}), ...(kits ? { kits } : {}), ...(sharedTier ? { sharedTier } : {}),
    emit, out, root, footprint,
  };
}

// --------------------------------------------------------------------------------------
// the summary
// --------------------------------------------------------------------------------------

/**
 * Does a `java -version` banner name a major >= minimum?
 *
 * `21.0.2` gives 21 and the legacy `1.8.0` gives 1, which is never >= 21 — that asymmetry is
 * the whole function. `\p{Nd}` rather than `[0-9]` because Python's `\d` matches any Unicode
 * decimal and JS's does not without the flag, and `parseIntStrict` reads the group for the same
 * reason. No `java` prints such a banner; matching Python where it is free is cheaper than a
 * comment explaining where it does not.
 */
export function javaMajorOk(versionOutput, minimum = 21) {
  const m = /version "(\p{Nd}+)/u.exec(versionOutput);
  if (!m) return false;
  const n = parseIntStrict(m[1]);
  return n !== null && n >= minimum;
}

/**
 * `(label, present, hint)` for what OpenCode cannot install
 * for itself. Today that is a JDK 21+ for `jdtls`; the JS-runtime servers self-download.
 *
 * THE SECOND SPAWN ON THIS ENTRY POINT, and the reason `ALLOWED_SPAWNS` in
 * `tests/unit/hook_cli.test.mjs` became a TABLE. `js/inspect/doctor.mjs` was the sole allowed importer
 * for one binding and one argv; this is the second, and the port's rule is that the second
 * instance of anything turns a special case into a table cross-checked against the source.
 * The argv is asserted literally there, so an allow-list entry cannot be reused to start an
 * interpreter.
 */
export function lspPrereqs() {
  const java = which('java');
  let ok = false;
  if (java) {
    try {
      // The banner goes to STDERR on every JVM, which is why this reads `.stderr`.
      // `NO_WINDOW` so the java probe does not flash a console from the web's setup action.
      const out = spawnSync(java, ['-version'], { encoding: 'utf8', ...NO_WINDOW }).stderr;
      ok = javaMajorOk(out ?? '');
    } catch { ok = false; }
  }
  return [['Java 21+ (jdtls)', ok,
    'install a JDK 21+ — e.g. `brew install openjdk@21`, '
    + "SDKMAN `sdk install java 21-tem`, or your distro's package"]];
}

/** The name each host goes by on screen — the same four labels `hostTools` prints. */
const TOOL_NAME = {
  opencode: 'OpenCode', claude: 'Claude Code', bob: 'IBM Bob', openclaude: 'OpenClaude',
};

/**
 * Where an emit put its root file, and — for the Claude-shaped hosts — its hooks.
 *
 * READ BACK, NOT RE-SPELLED: the placements differ by host and scope (Bob global's preamble is
 * `rules/geneseed.md`, a Claude project's CLAUDE.md sits beside `.claude/`, a project's hooks go
 * to `settings.local.json`, Bob global's to `settings/settings.json`), and the emit already
 * records each one in the install's manifest (`managed.claude_md`, `settings_file`,
 * `settings_hooks`). A summary that recomputed them would be a second owner of every rule.
 */
function emitFacts(emit, out) {
  const [host, scope] = EMIT_HOST_SCOPE.get(emit) ?? ['files', 'project'];
  if (host === 'files' || host === 'opencode') {
    const dir = emit === 'opencode-global' ? opencodeConfigDir() : resolveOut(out || 'Harness');
    return { host, rootFile: path.join(dir, 'AGENT.md') };
  }
  const spec = HOSTS.find((h) => h.host === host);
  const cfg = claudeCfg(scope === 'global' ? spec.configDir() : resolveOut(out || '.'), scope, host);
  const managed = readJsonMaybe(path.join(cfg, GLOBAL_MANIFEST))?.managed ?? {};
  const rootFile = managed.claude_md?.rel
    ? path.resolve(cfg, managed.claude_md.rel)
    : path.join(cfg, host === 'bob' ? path.join('rules', 'geneseed.md') : spec.agentFile);
  return {
    host,
    rootFile,
    settings: managed.settings_file ? path.join(cfg, managed.settings_file) : null,
    hookGroups: Array.isArray(managed.settings_hooks) ? managed.settings_hooks.length : 0,
  };
}

/**
 * The post-build report as `[kind, text]` rows,
 * `kind` being ok | warn | info.
 *
 * `ok` is the build's own success, so the first row is the only one that can say "build
 * failed"; every later row assumes a tree on disk. HOST-AWARE since the install-hardening
 * pass: it used to know only OpenCode's AGENT.md, so a successful claude-global install ended
 * on "expected AGENT.md … but it is not there" and "start a NEW OpenCode session". The
 * global-install warning is the row with real behaviour in it: a bundle or project emit made
 * while an OpenCode GLOBAL install exists is loaded by nothing, and saying so is the
 * difference between a wizard and a form.
 */
export function setupSummaryLines(theme, emit, out, root, ok) {
  const f = emitFacts(emit, out ?? root);
  const name = path.basename(f.rootFile);
  const lines = [];
  if (ok && existsSync(f.rootFile)) {
    lines.push(['ok', `${name} written to ${f.rootFile}`]);
  } else if (ok) {
    lines.push(['warn', `expected ${name} at ${f.rootFile} but it is not there`]);
  } else {
    lines.push(['warn', 'build failed — see the output above']);
  }
  if (ok && f.settings) {
    lines.push(['ok', `${f.hookGroups} hook groups wired in ${f.settings}`]);
    if (!process.env.GENESEED_LLM) {
      lines.push(['info', 'memory learning is off until you set GENESEED_LLM '
        + '(see docs/reference/env-context.md)']);
    }
  }
  if (emit === 'files') {
    lines.push(['info', `point your tool's instructions at ${f.rootFile}`]);
  }
  try {
    const cfg = opencodeConfigDir();
    // Only for an emit OpenCode itself would load — a Claude or Bob install is not shadowed.
    if (['opencode', 'files'].includes(emit) && existsSync(path.join(cfg, GLOBAL_MANIFEST))) {
      lines.push(['warn', `a global install exists at ${cfg} — OpenCode loads THAT, `
        + `not this build; re-run with 'opencode-global' to change it`]);
    }
  } catch { /* best effort */ }
  // LSP prereqs, for the OpenCode emits alone — they are the ones that get `"lsp": true`.
  if (ok && emit.startsWith('opencode')) {
    for (const [label, present, hint] of lspPrereqs()) {
      lines.push(present ? ['ok', `${label} present`] : ['warn', `${label} missing — ${hint}`]);
    }
  }
  const tool = TOOL_NAME[f.host];
  lines.push(['info', tool
    ? `theme is now '${theme}' — start a NEW ${tool} session to load it`
    : `theme is now '${theme}' — start a NEW session in your tool to load it`]);
  lines.push(['info', 'what was installed and what each piece does: '
    + 'https://github.com/Arylmera/Geneseed/blob/main/docs/understand/on-your-machine.md']);
  return lines;
}

// --------------------------------------------------------------------------------------
// the flow
// --------------------------------------------------------------------------------------

/**
 * Gather, export drift, build, summarise, offer the doctor.
 *
 * THE BUILD IS AN IMPORT, NOT A SPAWN, for the reason P5e established for `harness build`:
 * the Python needs a second process because `build.py` is a different PROGRAM, and here the
 * driver is a module in this one. The observable contract — the tree, the streams, the exit
 * code — is the same, and `driverMain` already converts the generator's `die` into a throw
 * so a refusal returns a code instead of killing the wizard.
 *
 * ONE THING THE REFERENCE DOES THAT THIS DOES NOT, stated in the module header's terms. The
 * printed plan used to name the Python driver and its args on both sides — the reference's own
 * wording, kept verbatim because the corpus compares it byte-for-byte. P2 rewrote it to
 * `geneseed build <args>` in BOTH implementations at once, for the reason the whole task
 * exists: the deletion phase may not move a recorded byte, so a string frozen in the corpus
 * can only change while both sides are still here to be re-recorded together. `geneseed
 * build` is not a paraphrase — it forwards its extra arguments to this generator on both
 * sides (`_harness_build.cmd_build`, and `driverMain` here), so the line still names a
 * command the reader can type, and names one that survives the deletion.
 *
 * `theme_anim.play_line` USED TO BE THE SECOND, and P7c crossed it — `js/ui/anim.mjs`, gated by
 * the theme-animation jobs in `tests/unit/wizard.test.mjs`. The bare `catch` around it
 * is the reference's own, labelled there "cosmetic only — never block a successful install",
 * and it is kept for the same reason: the animation runs AFTER the build has already
 * succeeded, so nothing it can do may change the exit code.
 */
export function setupLines() {
  const sel = collectSetupLines();
  if (!sel) {
    printOut('[setup] cancelled — nothing written.\n');
    return 0;
  }
  const {
    theme, emit, out, root, footprint = 'lean', posture = 'peer', mode = 'direct',
    doctrines = null, excludeRules = null, excludeSkills = null, gates = {}, kits = null,
    sharedTier = false,
  } = sel;
  if (emit === 'opencode-global') {
    // The build below overwrites the deployed global harness, which may carry hand edits (or
    // in-place edits from a harness older than the notebook notes). Preserve that drift first.
    try {
      const [ipath] = exportImprovements();
      if (ipath) {
        printOut(`- local edits found in the deployed harness — saved to ${ipath}\n`);
        printOut('  (hand that file to your agent to back-port them into src/)\n');
      }
    } catch (e) {
      printOut(`! could not export local edits (${e && e.message}) — continuing.\n`);
    }
  }
  // Same list the question was built from — see `collectSetupLines`. The build that actually
  // runs must carry the pack selection the plan line just previewed, or the wizard would print
  // one command and run another.
  const argv = setupBuildArgs(theme, emit, out, root, footprint, posture, mode, doctrines,
    doctrineOptions().map(([n]) => n), excludeRules, undefined, excludeSkills, gates, kits, sharedTier);
  // `--reset`: the wizard's answers are a WHOLE selection, and `setupBuildArgs` elides an axis at
  // its default, so answering one back to it (mode direct, posture peer) over an install would
  // otherwise trip the preserve guard (js/build/profile.mjs). The plan line above says the same.
  argv.push('--reset');
  printOut(`Running:  geneseed build ${argv.join(' ')}\n`);
  const rc = driverMain(argv);
  if (rc !== 0) {
    printErr('[setup] build failed — no harness written (see the output above).\n');
    return rc;
  }
  try {
    playLine(theme, true);        // themed install animation (motion → reveal card)
  } catch { /* cosmetic only — never block a successful install */ }
  for (const [kind, text] of setupSummaryLines(theme, emit, out, root, true)) {
    printOut(`${{ ok: '✓', warn: '!', info: '-' }[kind] ?? '-'} ${text}\n`);
  }
  if (confirm('\nRun a health check (doctor) now?', true)) {
    // Scoped to the theme just installed — no full-sweep noise post-install.
    return cmdDoctor({ theme, all: false, bundle: null, noBundle: false });
  }
  return 0;
}

/**
 * The TTY gate, then the wizard.
 *
 * The refusal is the whole of what a cell can observe (see the module header) and it is the
 * only part of this file the acceptance matrix compares. `process.stdin.isTTY` is `undefined`
 * off a terminal rather than `false`, which is why it is negated rather than compared.
 */
export async function cmdSetup(args = {}) {
  const refusal = (await import('./update.mjs')).gateRefusal();
  if (refusal) {
    printErr(`[setup] not started: ${refusal}\n`);
    return 1;
  }
  // Before the TTY refusal: a profile run asks nothing, so a script or a remote shell may run it
  // (install profiles, D15).
  if (args?.profile) return setupProfile(args.profile);
  if (!process.stdin.isTTY) {
    printErr('[setup] needs an interactive terminal. Non-interactive? e.g.:\n'
      + '  geneseed build --emit opencode-global --theme neutral\n');
    return 1;
  }
  if (!toolsReport()) return 1;
  return setupLines();
}

/**
 * `[label, command, install url]` per host, in HOSTS order. The command is also the host id a
 * profile lists (`setupProfile` pairs a `hostTools` row with its host by this index).
 */
const HOST_TOOLS = [
  ['OpenCode', 'opencode', 'https://opencode.ai/docs/'],
  ['Claude Code', 'claude', 'https://code.claude.com/docs/en/setup'],
  ['IBM Bob', 'bob', 'https://bob.ibm.com/'],
  ['OpenClaude', 'openclaude', 'https://openclaude.gitlawb.com/'],
];

/**
 * The AI coding tools Geneseed installs into, as `[label, present, url, where]` rows in HOSTS
 * order. `where` is the path found OFF the PATH (see `userInstall`), else null.
 *
 * PRESENT MEANS THE TOOL ITSELF WAS FOUND — its command on PATH, or its program in a per-user
 * install location — and never its config dir. That dir looked like a signal — a desktop-only
 * install has one and no command — but GENESEED ITSELF CREATES IT: a `bob-global` emit writes
 * `~/.bob` on a machine that never had Bob, and the first run of this check reported Bob present
 * on exactly such a machine. A wrong "ok" sends the user to an install mode for a tool they
 * cannot open; a wrong "not found" costs a line, and `toolsReport` lets them name the path.
 *
 * NO SPAWN, deliberately. `which` walks PATH by hand, so asking costs nothing on the CLI's
 * child_process allow-list — a `claude --version` probe would have been a third entry there to
 * learn nothing `which` does not already say. `lookup` and `userLookup` are the seams for the
 * test, which cannot rely on what this machine happens to have installed.
 */
export function hostTools({ lookup = which, userLookup = userInstall } = {}) {
  return HOST_TOOLS.map(([label, cmd, url]) => {
    if (lookup(cmd)) return [label, true, url, null];
    const where = userLookup(cmd);
    return [label, Boolean(where), url, where || null];
  });
}

/**
 * Per-host off-PATH places: a bin dir a tool's own installer uses, and a name pattern for the
 * desktop app folder. Only Bob ships as a desktop IDE; matching `claude` against app folders
 * would find the Claude desktop chat app, which is not Claude Code.
 */
const USER_BIN_DIRS = {
  opencode: ['.opencode/bin'],
  claude: ['.claude/local'],
  bob: [],
  openclaude: [],
};
const APP_PATTERN = { bob: /\bbob\b/i };

/**
 * Where a tool installed FOR ONE USER lives when its installer did not put it on PATH — the
 * report of 2026-10 was IBM Bob installed under the user's own profile, which `which` never sees.
 *
 * Three kinds of place, each one the tool's own program, never its config dir:
 *   * a per-user bin dir: `~/.local/bin` and `~/bin` for every tool, plus the dir its own
 *     installer uses (`USER_BIN_DIRS`) — an executable file, through `which` and its PATHEXT;
 *   * on Windows, `%APPDATA%\npm` (a per-user `npm i -g`) and a desktop app folder under
 *     `%LOCALAPPDATA%\Programs` whose name matches `APP_PATTERN`;
 *   * on macOS, a matching `.app` in `/Applications` or `~/Applications`.
 * The first hit wins. Everything a machine could differ on is a parameter, for the test.
 */
export function userInstall(cmd, {
  home = os.homedir(), env = process.env, platform = process.platform,
  find = which, list = listDir,
} = {}) {
  const bins = ['.local/bin', 'bin', ...(USER_BIN_DIRS[cmd] ?? [])].map((d) => path.join(home, d));
  if (platform === 'win32' && env.APPDATA) bins.push(path.join(env.APPDATA, 'npm'));
  const hit = find(cmd, bins.join(path.delimiter));
  if (hit) return hit;
  const pattern = APP_PATTERN[cmd];
  if (!pattern) return null;
  const appDirs = platform === 'win32'
    ? (env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Programs')] : [])
    : platform === 'darwin' ? ['/Applications', path.join(home, 'Applications')] : [];
  for (const dir of appDirs) {
    const name = list(dir).find((n) => pattern.test(n)
      && (platform !== 'darwin' || n.endsWith('.app')));
    if (name) return path.join(dir, name);
  }
  return null;
}

/** `readdirSync`, with a missing or unreadable dir as no entries. */
function listDir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/**
 * Show which tools are here before asking anything — the install-mode question is easier to
 * answer knowing it — and when NONE is, ask whether to stop and install one first. It never
 * installs one: on a managed machine that is IT's call, and each tool has its own installer.
 * A missing tool among several present is a line, not a question; nobody needs all four.
 * When none is found, the user can name where theirs is before being asked to stop — the
 * search covers PATH and the usual per-user places, not every folder an installer may pick.
 * `false` is the user choosing to stop.
 */
function toolsReport(tools = hostTools()) {
  printOut('AI coding tools on this machine:\n');
  for (const [label, present, url, where] of tools) {
    if (!present) printOut(`  --  ${label} not found — install: ${url}\n`);
    else printOut(where ? `  ok  ${label} (${where}, not on PATH)\n` : `  ok  ${label}\n`);
  }
  if (tools.some(([, present]) => present)) { printOut('\n'); return true; }
  printOut('\nNone of them was found on PATH or in the usual per-user folders.\n');
  // Quotes stripped: a path dragged into a Windows console arrives wrapped in them.
  const given = ask('Installed somewhere else? Path to the tool (Enter to skip)')
    .replace(/^"(.*)"$/, '$1');
  if (given && existsSync(given)) { printOut(`  ok  ${given}\n\n`); return true; }
  if (given) printOut(`  --  nothing at ${given}\n`);
  printOut('Install the one you use (links above), then run setup again — or go on and pick the '
    + 'plain bundle, which any AGENT.md tool can read.\n');
  if (confirm('Continue without one?', false)) { printOut('\n'); return true; }
  printOut('Stopped. Run setup again once a tool is installed.\n');
  return false;
}

// --------------------------------------------------------------------------------------
// the profile run (`setup --profile <name>`)
// --------------------------------------------------------------------------------------

/**
 * What a profile run would change back on `argv`'s target install (spec D14): the preserve
 * guard's own comparison, run on the argv WITHOUT `--reset` (with it the guard returns null) and
 * with no flag counted as given, so every setting that differs is listed. `[]` when there is no
 * install there yet, or when the argv cannot be parsed (the build then refuses on its own terms).
 */
export function profileChanges(argv) {
  try {
    const args = parseDriverArgs(argv.filter((a) => a !== '--reset'));
    return preserveRefusal(args, new Set(), null)?.changes ?? [];
  } catch {
    return [];
  }
}

/**
 * The login item, as one `{ ok, text }` line for the summary. Rewritten only when it is absent
 * or stale (spec D7); a hand-written one is left alone with a warning that names it. `null`
 * where the platform has no login item Geneseed writes.
 */
function defaultAutostart() {
  const cur = autostartState();
  if (!cur) return null;
  if (cur.state === 'ours') return { ok: true, text: `login item already set: ${cur.file}` };
  const r = autostartInstall();
  if (r.ok) return { ok: true, text: `login item written: ${cur.file}` };
  return { ok: false, text: `login item not written: ${r.error} (see docs/guides/autostart.md)` };
}

/**
 * Start the console without a browser, or restart it when it already runs so it serves the code
 * just pulled (spec D21). `restartDaemon` with `onlyIfRunning` false is exactly that: it stops a
 * live console first and starts one either way. The URL comes from the daemon record AFTER the
 * start, because a busy port moves the console to another one. Lazy: `js/web/daemon.mjs` spawns,
 * and only this arm of `setup` needs it.
 */
async function defaultConsole() {
  const [{ readDaemon, restartDaemon }, { webState }] = await Promise.all([
    import('../web/daemon.mjs'), import('../web/state.mjs'),
  ]);
  const rc = await restartDaemon(null, null, false);
  const url = readDaemon(webState(null).target)?.url ?? null;
  return { ok: rc === 0 && Boolean(url), url };
}

/**
 * `geneseed setup --profile <name>` — the whole install with no question asked.
 *
 * The flow is the spec's ("Flow of `geneseed setup --profile <name>`"): load the profile, find
 * the hosts it lists on this machine (D27), build each one globally (a failure is recorded and
 * the loop goes on, D16), then `link` (always, D23), the login item and the console (warnings,
 * never failures), the doctor scoped to the profile's theme (D22), and an ASCII summary — the
 * install scripts run in cmd.exe, whose codepage turns an em dash into mojibake.
 *
 * EVERY SIDE EFFECT IS A SEAM in `deps`, because each one reaches outside the checkout: `link`
 * writes the real user PATH (PowerShell, HKCU) or a shell rc file, the login item writes the
 * Startup folder or a LaunchAgent, the console spawns a daemon. A test injects all of them; the
 * defaults are the real ones and only the CLI reaches them.
 */
export async function setupProfile(name, deps = {}) {
  const {
    load = loadProfile, tools = null, build = driverMain, exportDrift = exportImprovements,
    changes = profileChanges, link = (report) => cmdLink({ dir: null }, { unattended: true, report }),
    autostart = defaultAutostart, startConsole = defaultConsole,
    doctor = (theme) => cmdDoctor({ theme, all: false, bundle: null, noBundle: false }),
    configDir = (host) => HOSTS.find((h) => h.host === host).configDir(),
    platform = process.platform,
  } = deps;
  const loaded = load(name);
  if (!loaded.ok) {
    printErr(`[setup] ${loaded.error}\n`);
    return 1;
  }
  const p = loaded.profile;
  const rows = tools ?? hostTools();
  const found = HOST_TOOLS.map(([label, host, url], i) => ({ label, host, url, present: Boolean(rows[i]?.[1]) }));
  const listed = found.filter((t) => p.hosts.includes(t.host));
  const targets = listed.filter((t) => t.present);
  printOut(`Geneseed setup - profile '${name}'${p.description ? `: ${p.description}` : ''}\n\n`);
  if (!targets.length) {
    // D3: nothing installed, each listed tool's install link, a non-zero exit.
    printOut('None of the AI coding tools this profile installs into was found on this machine:\n');
    for (const t of listed) printOut(`  --  ${t.label} - install: ${t.url}\n`);
    printOut('\nInstall one of them, then run this command again. Nothing was installed.\n');
    return 1;
  }

  const results = [];
  for (const t of targets) {
    const argv = profileBuildArgs(p, t.host);
    const moved = changes(argv);
    let saved = null;
    try {
      [saved] = exportDrift(configDir(t.host));
    } catch (e) {
      printOut(`! could not export local edits of ${t.label} (${e && e.message}) - continuing.\n`);
    }
    printOut(`Running:  geneseed build ${argv.join(' ')}\n`);
    let rc;
    try {
      rc = build(argv);
    } catch (e) {
      rc = e && e.exitCode ? e.exitCode : 1;
      printErr(`[setup] ${t.label}: ${e && e.message}\n`);
    }
    results.push({ ...t, argv, rc, moved, saved });
  }
  const built = results.filter((r) => r.rc === 0);

  printOut('\n');
  const report = {};
  let linkRc;
  try {
    linkRc = link(report);
  } catch (e) {
    linkRc = 1;
    printErr(`[setup] link: ${e && e.message}\n`);
  }

  let login = null;
  let consoleUrl = null;
  let consoleOk = true;
  if (p.login !== false) {
    if (platform === 'win32' || platform === 'darwin') {
      try {
        login = autostart();
      } catch (e) {
        login = { ok: false, text: `login item not written: ${e && e.message}` };
      }
    } else {
      // D24: no login item here, and the console still starts now.
      login = { ok: false, text: 'no login item exists for this platform - start the console with: geneseed web start' };
    }
    try {
      const c = await startConsole();
      consoleOk = c.ok;
      consoleUrl = c.url;
    } catch (e) {
      consoleOk = false;
      printErr(`[setup] web console: ${e && e.message}\n`);
    }
  }

  // The doctor only over a harness that was written: with every build failed there is nothing
  // for it to check that the failures above have not already said.
  let doctorRc = null;
  if (built.length) {
    printOut('\n');
    try {
      doctorRc = doctor(p.theme);
    } catch (e) {
      doctorRc = 1;
      printErr(`[setup] doctor: ${e && e.message}\n`);
    }
  }

  const out = ['', `Summary - profile '${name}'`];
  for (const r of results) {
    if (r.rc === 0) {
      out.push(`  ok    ${r.label}: installed (${r.host}-global)`);
    } else {
      // D25: no --force on a profile run. The build's own output names the file it refused.
      out.push(`  FAIL  ${r.label}: build failed (exit ${r.rc}) - see its output above. If it names a file`,
        '        of yours at a name Geneseed ships, move that file, or replace it with:',
        `        geneseed build ${r.argv.join(' ')} --force`);
    }
    if (r.moved.length) {
      out.push(`        changed back to the profile: ${r.moved.map((c) => `${c.name} ${c.from} -> ${c.to}`).join(', ')}`);
    }
    if (r.saved) out.push(`        local edits saved to ${r.saved} (hand that file to your agent to back-port them)`);
  }
  for (const t of listed.filter((x) => !x.present)) out.push(`  --    ${t.label}: not found - install: ${t.url}`);
  for (const t of found.filter((x) => x.present && !p.hosts.includes(x.host))) {
    out.push(`  --    ${t.label}: found, not in this profile - left as it is`);
  }
  if (report.foreign) {
    out.push(`  !     geneseed on PATH: ${report.foreign} is not a launcher Geneseed wrote, so it was left alone`);
  } else if (linkRc !== 0) {
    out.push('  !     geneseed is not on PATH - run geneseed.cmd (Windows) or ./geneseed from this folder');
  } else {
    out.push('  ok    geneseed on PATH (open a NEW terminal to use it)');
  }
  if (report.rcFile) out.push(`        added the PATH block to ${report.rcFile}`);
  if (login) out.push(`  ${login.ok ? 'ok  ' : '!   '}  ${login.text}`);
  if (p.login !== false) {
    out.push(consoleOk && consoleUrl ? `  ok    web console: ${consoleUrl}`
      : '  !     web console did not start - run: geneseed web start');
  }
  if (doctorRc !== null) out.push(doctorRc === 0 ? '  ok    doctor' : '  FAIL  doctor reported problems - see its output above');
  out.push('', 'Next steps:',
    `  1. Open the web console: ${consoleUrl ?? 'geneseed web start'}`,
    '  2. Run: geneseed --help',
    '  3. Read the Understand docs: https://github.com/Arylmera/Geneseed/blob/main/docs/understand/',
    '');
  printOut(`${out.join('\n')}\n`);
  return results.some((r) => r.rc !== 0) || (doctorRc !== null && doctorRc !== 0) ? 1 : 0;
}
