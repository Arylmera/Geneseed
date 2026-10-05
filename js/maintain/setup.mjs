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
import { existsSync } from 'node:fs';
import path from 'node:path';

import { main as driverMain, resolveOut } from '../build/driver.mjs';
import { playLine } from '../ui/anim.mjs';
import { discoverNames, PACK_ORDER } from '../build/source.mjs';
import { exportImprovements } from '../inspect/diff.mjs';
import { cmdDoctor } from '../inspect/doctor.mjs';
import { setupBuildArgs } from '../build/generate.mjs';
import { GLOBAL_MANIFEST, HOSTS, opencodeConfigDir } from '../hosts/hosts.mjs';
import {
  claudeCfg, defaultMode, defaultPosture, defaultTheme, EMIT_HOST_SCOPE, installedDefaults,
  readJsonMaybe, themeFiles,
} from '../hosts/installs.mjs';
import { printOut, printErr } from '../lib/fs.mjs';
import { which } from '../lib/paths.mjs';
import { ask, askChoice, confirm } from '../lib/prompt.mjs';
import { parseIntStrict } from '../lib/text.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';

// --------------------------------------------------------------------------------------
// the option tables
// --------------------------------------------------------------------------------------

/** `_harness_setup.THEME_BLURBS`. A theme without one shows its bare name. */
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

/** `_harness_setup.POSTURE_BLURBS`. */
const POSTURE_BLURBS = {
  peer: 'candid equal — dense, challenges, no flattery (default)',
  mentor: 'explains the why, checks understanding',
  expert: 'maximum density, no basics',
  assistant: 'precise execution, low initiative — you steer',
  artisan: 'peer with toolsmith reflexes — terminal-first',
};

/** `_harness_setup.MODE_BLURBS`. */
const MODE_BLURBS = {
  direct: 'the agent works every task itself, turn by turn (default)',
  foreman: 'triages tasks, spawns pipelines for substantial work',
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
 * `_harness_setup._theme_options`.
 *
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

/** `_harness_setup._posture_options`. */
export function postureOptions() {
  return discoverNames('postures', 'peer').map((n) => [n, POSTURE_BLURBS[n] ?? '']);
}

/** `_harness_setup._mode_options`. */
export function modeOptions() {
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
 * `_harness_setup.EMIT_OPTIONS`.
 *
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

/** `_harness_setup.FOOTPRINT_OPTIONS`. */
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
 * `_harness_setup._collect_setup_lines` — the six questions, the plan, the confirm.
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
export function collectSetupLines() {
  printOut('Geneseed setup — answer a few questions; nothing is written until you confirm.\n');
  const inst = installedDefaults();
  const theme = askChoice('Theme', themeOptions(), inst.theme || defaultTheme());
  const posture = askChoice('Posture', postureOptions(), inst.posture || defaultPosture());
  const mode = askChoice('Mode', modeOptions(), inst.mode || defaultMode());
  const doctrines = askDoctrines(inst.doctrines);
  const emit = askChoice('Install mode', EMIT_OPTIONS, inst.emit || 'opencode-global');
  const footprint = askChoice('Footprint', FOOTPRINT_OPTIONS,
    inst.footprint || 'lean');
  let out = null;
  let root = null;
  // Every PROJECT emit needs the repo root — claude/bob/openclaude included: without `--out`
  // their CLAUDE.md/.claude land in the generator's default ./Harness, where the host never
  // looks.
  if (['opencode', 'claude', 'bob', 'openclaude'].includes(emit)) {
    root = ask('Repo root to install into', '.');
    out = root;
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
  printOut(`\nAbout to run:  geneseed build ${
    setupBuildArgs(theme, emit, out, root, footprint, posture, mode, doctrines, allPacks,
      excludeRules, undefined, excludeSkills).join(' ')}\n`);
  if (!confirm('Proceed?', true)) return null;
  // The key only when there is something to carry, so a selection that excludes no skill is
  // the same object it was before the flag existed.
  return {
    theme, posture, mode, doctrines, excludeRules, ...(excludeSkills ? { excludeSkills } : {}),
    emit, out, root, footprint,
  };
}

// --------------------------------------------------------------------------------------
// the summary
// --------------------------------------------------------------------------------------

/**
 * `_harness_setup._java_major_ok` — does a `java -version` banner name a major >= minimum?
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
 * `_harness_setup._lsp_prereqs` — `(label, present, hint)` for what OpenCode cannot install
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
      // `capture_output=True, text=True` — the banner goes to STDERR on every JVM, which is
      // why the Python reads `.stderr` and not `.stdout`.
      // `NO_WINDOW` on BOTH sides as of this commit. The reference reached for a bare
      // `subprocess.run` here rather than `_harness_core.run`, so the flag was missing from
      // the Python too and the java probe flashed a console from the web's setup action —
      // a defect the two implementations SHARED, which is exactly what a cross-
      // implementation comparison cannot report. Fixed in `_harness_setup.py` beside this.
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
 * `_harness_setup._setup_summary_lines` — the post-build report as `[kind, text]` rows,
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
  } catch { /* as the Python's bare `except Exception` */ }
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
 * `_harness_setup._setup_lines` — gather, export drift, build, summarise, offer the doctor.
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
    doctrines = null, excludeRules = null, excludeSkills = null,
  } = sel;
  if (emit === 'opencode-global') {
    // The build below overwrites the deployed global harness, and the self-improvement loops
    // may have edited it in place. Preserve that drift first.
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
    doctrineOptions().map(([n]) => n), excludeRules, undefined, excludeSkills);
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
 * `_harness_setup.cmd_setup` — the TTY gate, then the wizard.
 *
 * The refusal is the whole of what a cell can observe (see the module header) and it is the
 * only part of this file the acceptance matrix compares. `process.stdin.isTTY` is `undefined`
 * off a terminal rather than `false`, which is why it is negated rather than compared.
 */
export function cmdSetup() {
  if (!process.stdin.isTTY) {
    printErr('[setup] needs an interactive terminal. Non-interactive? e.g.:\n'
      + '  geneseed build --emit opencode-global --theme neutral\n');
    return 1;
  }
  if (!toolsReport()) return 1;
  return setupLines();
}

/**
 * The AI coding tools Geneseed installs into, as `[label, present, url]` rows in HOSTS order.
 *
 * PRESENT MEANS THE COMMAND IS ON PATH, and nothing else. The config dir looked like a second
 * signal — a desktop-only install has one and no command — but GENESEED ITSELF CREATES IT: a
 * `bob-global` emit writes `~/.bob` on a machine that never had Bob, and the first run of this
 * check reported Bob present on exactly such a machine. A wrong "ok" sends the user to an
 * install mode for a tool they cannot open; a wrong "not found" costs one line they can ignore.
 *
 * NO SPAWN, deliberately. `which` walks PATH by hand, so asking costs nothing on the CLI's
 * child_process allow-list — a `claude --version` probe would have been a third entry there to
 * learn nothing `which` does not already say. `lookup` is the seam for the test, which cannot
 * rely on what this machine happens to have installed.
 */
export function hostTools({ lookup = which } = {}) {
  return [
    ['OpenCode', 'opencode', 'https://opencode.ai/docs/'],
    ['Claude Code', 'claude', 'https://code.claude.com/docs/en/setup'],
    ['IBM Bob', 'bob', 'https://bob.ibm.com/'],
    ['OpenClaude', 'openclaude', 'https://openclaude.gitlawb.com/'],
  ].map(([label, cmd, url]) => [label, Boolean(lookup(cmd)), url]);
}

/**
 * Show which tools are here before asking anything — the install-mode question is easier to
 * answer knowing it — and when NONE is, ask whether to stop and install one first. It never
 * installs one: on a managed machine that is IT's call, and each tool has its own installer.
 * A missing tool among several present is a line, not a question; nobody needs all four.
 * `false` is the user choosing to stop.
 */
export function toolsReport(tools = hostTools()) {
  printOut('AI coding tools on this machine:\n');
  for (const [label, present, url] of tools) {
    printOut(present ? `  ok  ${label}\n` : `  --  ${label} not on PATH — install: ${url}\n`);
  }
  if (tools.some(([, present]) => present)) { printOut('\n'); return true; }
  printOut('\nNone of them is installed. Install the one you use (links above), then run setup '
    + 'again — or go on and pick the plain bundle, which any AGENT.md tool can read.\n');
  if (confirm('Continue without one?', false)) { printOut('\n'); return true; }
  printOut('Stopped. Run setup again once a tool is installed.\n');
  return false;
}
