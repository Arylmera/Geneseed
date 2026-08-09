/**
 * `rituals/_harness_setup.py`'s wizard — the LINE-MODE install flow, and the first verb in
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
 * and everything past it is gated as a CORPUS in `tests/test_pure_function_parity.py`.
 *
 * The corpus is a new shape and the brief predicted the reason: a corpus over a stdin reader
 * needs a SEEDED FD, not a string. `tests/fixtures/pure_probe.{py,mjs}` are run with stdin
 * redirected from a file of answers and their WHOLE stdout compared — so the prompts, the
 * numbered menus, the default markers, the `About to run:` line and the returned selection
 * are all one byte comparison. That is a stricter gate than a cell would have been, because
 * a cell could not have varied the answers at all.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readSync } from 'node:fs';
import path from 'node:path';

import { main as driverMain, resolveOut } from '../bin/geneseed.mjs';
import { discoverNames } from './checkout.mjs';
import { exportImprovements } from './diff.mjs';
import { cmdDoctor } from './doctor.mjs';
import { setupBuildArgs } from './generate.mjs';
import { GLOBAL_MANIFEST, opencodeConfigDir } from './hosts.mjs';
import {
  defaultMode, defaultPosture, defaultTheme, installedDefaults, themeFiles,
} from './installs.mjs';
import { pyInt, pyPrint, pyPrintErr, pyWhich } from './lib/pyfs.mjs';

// --------------------------------------------------------------------------------------
// the three readers
// --------------------------------------------------------------------------------------

/**
 * `_harness_setup._ask` — `input(f"{prompt}{suffix}: ").strip()`, or the default at EOF.
 *
 * WHY IT READS A BYTE AT A TIME. Node has no synchronous line read: `readFileSync(0)` blocks
 * until EOF rather than until Enter, so a wizard built on it would hang on a real terminal
 * until the user pressed Ctrl-D. Reading fd 0 one byte at a time to the first `\n` is what
 * `input()` does, and it is the only synchronous shape that stops where Enter stops. The
 * body arrived in P5h inside `js/uninstall.mjs`'s `confirm`; `setup` is the second caller,
 * so it moved to where the Python's own owner is — `_harness_setup` — and `confirm` is built
 * on it here exactly as `_confirm` is built on `_ask` there.
 *
 * The EOF branch is the one a piped caller sees, and it agrees with Python by two different
 * routes that happen to produce one answer: `input()` RAISES `EOFError` and the `except`
 * returns the default, while a zero-length read here leaves `line` empty and `|| dflt` does
 * the same. A partial line with no trailing newline is not EOF to either — Python returns
 * the characters and so does this.
 *
 * `.trim()` is `str.strip()` in every case but U+FEFF, which JS counts as whitespace and
 * Python does not; that is a standing item of this port and not this function's to settle.
 */
export function ask(prompt, dflt = '') {
  const suffix = dflt ? ` [${dflt}]` : '';
  // `input()` writes its prompt to stdout with no newline — nothing for `pyPrint` to
  // translate, and it must NOT gain one.
  process.stdout.write(`${prompt}${suffix}: `);
  const ans = readLine().trim();
  return ans || dflt;
}

/**
 * Fd 0 to the first `\n`, dropping a `\r` before it — the CRLF a Windows console sends.
 *
 * THE BYTES ARE COLLECTED AND DECODED ONCE, and that is a fix rather than a style. The
 * version this arrived as decoded EACH BYTE on its own — `buf.toString('utf8', 0, n)` inside
 * the loop — which turns every multi-byte character into two or three U+FFFD. It was
 * invisible for a phase because its only caller was `confirm`, whose answer is `y` or `n`;
 * the wizard's first non-ASCII answer is what exposed it, and the corpus caught it on the
 * first run. Scanning for the terminators a byte at a time is still correct: `\n` and `\r`
 * are ASCII, and no continuation byte of a UTF-8 sequence is below 0x80.
 */
function readLine() {
  const buf = Buffer.alloc(1);
  const bytes = [];
  for (;;) {
    let n = 0;
    try { n = readSync(0, buf, 0, 1, null); } catch { break; }
    if (n === 0) break;
    if (buf[0] === 0x0a) break;
    if (buf[0] !== 0x0d) bytes.push(buf[0]);
  }
  return Buffer.from(bytes).toString('utf8');
}

/** `_harness_setup._confirm` — `_ask` with a Y/n suffix; the default on an empty answer. */
export function confirm(prompt, dflt = true) {
  const ans = ask(`${prompt} (${dflt ? 'Y/n' : 'y/N'})`).toLowerCase();
  return ans === '' ? dflt : ans[0] === 'y';
}

/**
 * `_harness_setup._ask_choice` — a numbered menu; the chosen KEY, or the default.
 *
 * THREE THINGS ABOUT THE FALLBACK ORDER, all of them observable and none of them obvious:
 *
 *   * The key match lives in Python's `except ValueError`, so an answer that PARSES as an
 *     integer never reaches it. `99` against a five-option menu returns the default; it does
 *     not go looking for an option literally named `99`.
 *   * An in-range index wins, a parsed out-of-range index falls to the default, and only an
 *     UNPARSEABLE answer is matched against the keys. `pyInt` is what separates the second
 *     case from the third, and it is not `Number()` — see its own docblock.
 *   * The default's index is computed with `next(...)` and no fallback, so a default that is
 *     not in `options` raises `StopIteration` on the reference. That is reachable (a
 *     deployed install can carry a theme this checkout no longer ships) and it is mirrored
 *     as a throw rather than smoothed over: the two implementations must fail in the same
 *     place, and a silent `-1` here would be a divergence dressed as robustness.
 */
export function askChoice(prompt, options, dflt) {
  pyPrint(`\n${prompt}:\n`);
  options.forEach(([key, desc], i) => {
    const label = desc ? `${key} — ${desc}` : key;
    pyPrint(`  ${i + 1}) ${label}${key === dflt ? '   (default)' : ''}\n`);
  });
  const defaultIdx = options.findIndex(([k]) => k === dflt);
  if (defaultIdx < 0) throw new Error(`StopIteration: no option named ${dflt}`);
  const raw = ask('Choose', String(defaultIdx + 1));
  const idx = pyInt(raw);
  if (idx !== null) {
    if (idx >= 1 && idx <= options.length) return options[idx - 1][0];
  } else {
    for (const [key] of options) if (raw === key) return key;
  }
  return dflt;
}

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
  ['copilot-global', 'GitHub Copilot personal config dir (~/.copilot) — copilot-instructions.md, agents, skills.'],
  ['copilot', 'Per-repo AGENTS.md + .github/ for GitHub Copilot, committed into one repository.'],
  ['files', 'Plain bundle for any AGENT.md tool.'],
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
 * `_harness_setup._collect_setup_lines` — the five questions, the plan, the confirm.
 *
 * Returns the selection, or null when the confirm is declined. Every default is the
 * DEPLOYED value first (`installedDefaults`) and the CONFIGURED one second, which is why
 * P5i is the phase that had to give `installedDefaults` its posture, mode and footprint keys
 * back: three of the five questions read them.
 */
export function collectSetupLines() {
  pyPrint('Geneseed setup — answer a few questions; nothing is written until you confirm.\n');
  const inst = installedDefaults();
  const theme = askChoice('Theme', themeOptions(), inst.theme || defaultTheme());
  const posture = askChoice('Posture', postureOptions(), inst.posture || defaultPosture());
  const mode = askChoice('Mode', modeOptions(), inst.mode || defaultMode());
  const emit = askChoice('Install mode', EMIT_OPTIONS, inst.emit || 'opencode-global');
  const footprint = askChoice('Footprint', FOOTPRINT_OPTIONS.map(([k, d]) => [k, d]),
    inst.footprint || 'lean');
  let out = null;
  let root = null;
  // Every PROJECT emit needs the repo root — claude/bob/copilot included: without `--out`
  // their CLAUDE.md/.claude land in the generator's default ./Harness, where the host never
  // looks.
  if (['opencode', 'claude', 'bob', 'copilot'].includes(emit)) {
    root = ask('Repo root to install into', '.');
    out = root;
  } else if (emit === 'files') {
    out = ask('Output dir for the bundle', 'Harness');
  }
  pyPrint(`\nAbout to run:  python build.py ${
    setupBuildArgs(theme, emit, out, root, footprint, posture, mode).join(' ')}\n`);
  if (!confirm('Proceed?', true)) return null;
  return { theme, posture, mode, emit, out, root, footprint };
}

// --------------------------------------------------------------------------------------
// the summary
// --------------------------------------------------------------------------------------

/**
 * `_harness_setup._java_major_ok` — does a `java -version` banner name a major >= minimum?
 *
 * `21.0.2` gives 21 and the legacy `1.8.0` gives 1, which is never >= 21 — that asymmetry is
 * the whole function. `\p{Nd}` rather than `[0-9]` because Python's `\d` matches any Unicode
 * decimal and JS's does not without the flag, and `pyInt` reads the group for the same
 * reason. No `java` prints such a banner; matching Python where it is free is cheaper than a
 * comment explaining where it does not.
 */
export function javaMajorOk(versionOutput, minimum = 21) {
  const m = /version "(\p{Nd}+)/u.exec(versionOutput);
  if (!m) return false;
  const n = pyInt(m[1]);
  return n !== null && n >= minimum;
}

/**
 * `_harness_setup._lsp_prereqs` — `(label, present, hint)` for what OpenCode cannot install
 * for itself. Today that is a JDK 21+ for `jdtls`; the JS-runtime servers self-download.
 *
 * THE SECOND SPAWN ON THIS ENTRY POINT, and the reason `test_the_cli_reaches_child_process_\
 * only_where_it_is_declared` became a TABLE. `js/doctor.mjs` was the sole allowed importer
 * for one binding and one argv; this is the second, and the port's rule is that the second
 * instance of anything turns a special case into a table cross-checked against the source.
 * The argv is asserted literally there, so an allow-list entry cannot be reused to start an
 * interpreter.
 */
export function lspPrereqs() {
  const java = pyWhich('java');
  let ok = false;
  if (java) {
    try {
      // `capture_output=True, text=True` — the banner goes to STDERR on every JVM, which is
      // why the Python reads `.stderr` and not `.stdout`.
      const out = spawnSync(java, ['-version'], { encoding: 'utf8' }).stderr;
      ok = javaMajorOk(out ?? '');
    } catch { ok = false; }
  }
  return [['Java 21+ (jdtls)', ok,
    'install a JDK 21+ — e.g. `brew install openjdk@21`, '
    + "SDKMAN `sdk install java 21-tem`, or your distro's package"]];
}

/**
 * `_harness_setup._setup_summary_lines` — the post-build report as `[kind, text]` rows,
 * `kind` being ok | warn | info.
 *
 * `ok` is the build's own success, so the first row is the only one that can say "build
 * failed"; every later row assumes a tree on disk. The global-install warning is the row
 * with real behaviour in it: a bundle or project emit made while an OpenCode GLOBAL install
 * exists is loaded by nothing, and saying so is the difference between a wizard and a form.
 */
export function setupSummaryLines(theme, emit, out, root, ok) {
  const agentMd = emit === 'opencode-global'
    ? path.join(opencodeConfigDir(), 'AGENT.md')
    : path.join(resolveOut(out || 'Harness'), 'AGENT.md');
  const lines = [];
  if (ok && existsSync(agentMd)) {
    lines.push(['ok', `AGENT.md written to ${agentMd}`]);
  } else if (ok) {
    lines.push(['warn', `expected AGENT.md at ${agentMd} but it is not there`]);
  } else {
    lines.push(['warn', 'build failed — see the output above']);
  }
  if (emit === 'opencode-global') {
    const cfgDir = opencodeConfigDir();
    const hint = process.platform === 'win32'
      ? `learn plugin: $env:GENESEED_HARNESS = "${cfgDir}"  (persist: setx GENESEED_HARNESS "${cfgDir}")`
      : 'learn plugin: export GENESEED_HARNESS="$HOME/.config/opencode"';
    lines.push(['info', hint]);
  } else if (emit === 'files') {
    lines.push(['info', `point your tool's instructions at ${agentMd}`]);
  }
  try {
    const cfg = opencodeConfigDir();
    if (emit !== 'opencode-global' && existsSync(path.join(cfg, GLOBAL_MANIFEST))) {
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
  lines.push(['info', `theme is now '${theme}' — start a NEW OpenCode session for the new voice`]);
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
 * TWO THINGS THE REFERENCE DOES THAT THIS DOES NOT, both stated in the module header's
 * terms. `theme_anim.play_line` — the themed install animation — belongs to P7 with the rest
 * of the terminal layer, and the Python already wraps it in a bare `except: pass` labelled
 * "cosmetic only — never block a successful install". And the `python build.py` in the
 * printed plan is the reference's own wording, kept verbatim: it is compared byte-for-byte
 * by the corpus, and rewriting it to `geneseed build` is P10's documentation pass, not a
 * silent edit here.
 */
export function setupLines() {
  const sel = collectSetupLines();
  if (!sel) {
    pyPrint('[setup] cancelled — nothing written.\n');
    return 0;
  }
  const {
    theme, emit, out, root, footprint = 'lean', posture = 'peer', mode = 'direct',
  } = sel;
  if (emit === 'opencode-global') {
    // The build below overwrites the deployed global harness, and the self-improvement loops
    // may have edited it in place. Preserve that drift first.
    try {
      const [ipath] = exportImprovements();
      if (ipath) {
        pyPrint(`- local edits found in the deployed harness — saved to ${ipath}\n`);
        pyPrint('  (hand that file to your agent to back-port them into src/)\n');
      }
    } catch (e) {
      pyPrint(`! could not export local edits (${e && e.message}) — continuing.\n`);
    }
  }
  const argv = setupBuildArgs(theme, emit, out, root, footprint, posture, mode);
  pyPrint(`Running:  python build.py ${argv.join(' ')}\n`);
  const rc = driverMain(argv);
  if (rc !== 0) {
    pyPrintErr('[setup] build failed — no harness written (see the output above).\n');
    return rc;
  }
  for (const [kind, text] of setupSummaryLines(theme, emit, out, root, true)) {
    pyPrint(`${{ ok: '✓', warn: '!', info: '-' }[kind] ?? '-'} ${text}\n`);
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
    pyPrintErr('[setup] needs an interactive terminal. Non-interactive? e.g.:\n'
      + '  python build.py --emit opencode-global --theme neutral\n');
    return 1;
  }
  return setupLines();
}
