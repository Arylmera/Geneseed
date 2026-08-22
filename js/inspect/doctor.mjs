/**
 * `geneseed doctor` — validate the build.
 *
 * Sixteen `*Problems` checks over one theme (or every theme) — and `[doctor] ok — …` when all
 * sixteen find nothing. The checks themselves live beside this file, in `checks-build.mjs`,
 * `checks-repo.mjs` and `checks-authoring.mjs`, over the primitives in `scan.mjs`; what is left
 * here is the driver that chooses the themes, runs the checks and prints the verdict.
 *
 * WHY THE GATE LOOKS THE WAY IT DOES, and it is worth stating here rather than only in the
 * spec: **delete any single check and a clean run is byte-identical**, so a comparison of two
 * runs cannot tell a full doctor from a stub that prints the OK line.
 * `tests/unit/harness.test.mjs` and `tests/unit/authoring_gates.test.mjs` therefore plant ONE
 * FAULT PER CHECK, in a private copy of the checkout — see `copyCheckout` in
 * `tests/helpers/cli_golden.mjs` for why a verb that reads `ROOT` needed a fixture kind that
 * did not exist until the port.
 *
 * WHY THIS IS THE VERB THAT SPAWNS. `bin/geneseed-cli.mjs` is under a blanket transitive
 * `child_process` ban, and its own docblock predicted the day a verb that genuinely spawns
 * would land: this is it. `authoringProblems` runs `node --check` over the OpenCode plugins,
 * and there is no in-process equivalent — `vm.Script` compiles as a SCRIPT and every plugin is
 * ESM (`import { promises as fs } from "node:fs"`), which `node --check` accepts through
 * module-syntax detection and `vm.Script` rejects with a SyntaxError of its own. So the ban is
 * an ALLOW-LIST of exactly the shape the hook entry already carries for `$GENESEED_LLM`: one
 * binding, one call site, and a test that names the argv. What the ban actually protects —
 * that this tool never shells back to the generator — is asserted directly instead.
 *
 * WHAT `doctorCollect` DOES NOT REACH, MEASURED RATHER THAN ASSUMED. It takes `onProgress`
 * and `groups`; `cmdDoctor` passes neither, and they are the TUI's and the web's. `ran` is
 * kept anyway, because it is four lines and dropping it would make the web's use of
 * `doctorCollect` a rewrite rather than a parameter.
 */
import path from 'node:path';
import { emitGlobalInto, emitProjectInto, main as driverMain } from '../../bin/build-driver.mjs';
import { ROOT } from '../build/source.mjs';
import { resolvePath } from '../hosts/hosts.mjs';
import { installedDefaults, themeFiles } from '../hosts/installs.mjs';
import { validateIsVendored } from '../hosts/native.mjs';
import { printOut } from '../lib/fs.mjs';
import { authoringProblems } from './checks-authoring.mjs';
import {
  checkBuild, colorThemeProblems, renderedProblems, themeParityProblems,
} from './checks-build.mjs';
import { moduleMapProblems, shimProblems } from './checks-repo.mjs';
import { isDoctorNote, sortedProblems, sortedUnique, stemOf, withTempDir } from './scan.mjs';

/**
 * `_harness_build._themes_to_check` — which themes doctor validates.
 *
 * An explicit `--theme` wins. Otherwise, unless `--all` forces the maintainer sweep, scope to
 * the theme THIS host installed so a one-theme user is not buried under the same problem
 * echoed across all fourteen. Falls back to the full sweep when nothing is installed (a fresh
 * clone) or the detected theme is unknown, so a maintainer in a clean checkout still gets
 * full coverage. Pure, and gated as such: `--all` is a 14-theme sweep no cell can afford.
 */
export function themesToCheck(theme, allThemes, detected, available) {
  if (theme) return [theme];
  if (!allThemes && detected && available.includes(detected)) return [detected];
  return [...available].sort();
}

/**
 * `contextlib.redirect_stdout(io.StringIO())` — swallow an emit's log, and ONLY stdout.
 *
 * The Python redirects stdout and leaves stderr alone, so a WARN from the emit still reaches
 * the user. Reproducing that exactly is the point: swallowing both would hide
 * `warnBobGlobalOverProject` and swallowing neither would put ~200 lines of emit summary into
 * doctor's output. `withPlatformNewlines` inside `emitGlobalInto` wraps whatever `write` is
 * installed at call time, so it translates into this buffer and the bytes never leave.
 */
function swallowStdout(fn) {
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = real; }
}

/**
 * `_harness_build._global_emit_problems` — validate the opencode-global emit, in BOTH
 * footprints.
 *
 * The RECOMMENDED install, and otherwise a doctor blind spot: the files build and ./Harness
 * were checked and the global layout never was. The two footprints produce genuinely
 * different AGENT.md bodies — lean swaps the inlined laws for a digest plus a pointer and
 * ships a standalone laws file the full emit does not write — so checking one leaves the
 * other's links and tokens unvalidated, and lean being the default made that the shape most
 * installs actually run.
 */
export function globalEmitProblems(themeName) {
  const problems = [];
  for (const footprint of ['lean', 'full']) {
    withTempDir((tmp) => {
      const cfgDir = path.join(tmp, 'cfg');
      try {
        swallowStdout(() => emitGlobalInto('opencode', {
          theme: themeName, out: path.join(tmp, 'bundle'), cfgDir, footprint,
        }));
      } catch (e) {
        if (e && e.exitCode !== undefined) {
          problems.push(`[${themeName} global/${footprint}] build failed`);
          return;
        }
        throw e;
      }
      problems.push(...checkBuild(`${themeName} global/${footprint}`, cfgDir));
    });
  }
  return problems;
}

/**
 * `_harness_build._claude_bob_emit_problems` — validate the claude/bob/copilot PER-REPO
 * emits, which were never checked before.
 *
 * That is exactly why the CLAUDE.md/AGENTS.md skill-table dead links shipped unnoticed: the
 * emits that render straight into a repo were outside doctor's sweep. Scanned with
 * `validateIsVendored` rather than `isVendoredPath`, because the native per-repo layer nests
 * skills one level deeper than a bundle does.
 */
export function claudeBobEmitProblems(themeName) {
  const problems = [];
  for (const label of ['claude', 'bob', 'copilot']) {
    withTempDir((tmp) => {
      const root = path.join(tmp, 'root');
      try {
        swallowStdout(() => emitProjectInto(label, {
          theme: themeName, out: path.join(root, 'bundle'), root,
        }));
      } catch (e) {
        if (e && e.exitCode !== undefined) {
          problems.push(`[${themeName} ${label}] build failed`);
          return;
        }
        throw e;
      }
      problems.push(...checkBuild(`${themeName} ${label}`, root, validateIsVendored));
    });
  }
  return problems;
}

/**
 * `_harness_build._doctor_collect` — run every check; return `[themes, problems]`.
 *
 * TWO PARAMETERS OF THE PYTHON ARE NOT HERE, and both are absences on purpose. `on_progress`
 * is the TUI's — it drags ~140 lines of curses drawing behind it and no caller this binary
 * has can supply one. `groups` is the WEB's, the structured `{check, label, problems}` view
 * the Doctor page renders, and `_web_actions.py` / `_web_core.py` are its only callers; both
 * stay Python until P6. Four lines of accumulator with no caller and no cell is unreachable
 * code that is not part of an asserted partition, which is this port's own criterion for
 * deleting rather than keeping. P6 adds it with the caller that needs it.
 *
 * THE PER-THEME BUILD IS THE DRIVER, IN-PROCESS. The Python shells to `build.py` and reads a
 * return code; here that is `driverMain`, the route P5e established and the only one the
 * `child_process` allow-list leaves. `cwd=ROOT` does not travel in-process and does not have
 * to: `--out` is an absolute path, which is the one input `resolveOut` would have read the
 * working directory for.
 */
export function doctorCollect({
  theme = null, allThemes = false, bundle = null, noBundle = false, groups = null,
} = {}) {
  const available = themeFiles().map(stemOf);
  if (!available.length) return [[], ['[doctor] no themes found']];

  // `_ran` — the label is the one place each check is NAMED, and since P6b a caller can
  // pass an array to collect them. `/api/doctor` renders one card per entry, which is the
  // only reason the structured view exists; `cmd_doctor` passes nothing and gets the flat
  // list, so the return contract is unchanged either way. `on_progress` is still P7's.
  const ran = (check, label, probs) => {
    if (groups !== null) groups.push({ check, label, problems: sortedProblems(probs) });
    return probs;
  };

  // Only probe the deployed install when we actually need it (no theme / not --all).
  const detected = (theme || allThemes) ? null : (installedDefaults().theme ?? null);
  const themes = themesToCheck(theme, allThemes, detected, available);
  // Sampled HERE, before the emit loop below — every emit rewrites the hook shim, so a check
  // placed after them could only ever observe the freshly repaired file and would be dead
  // code that always reports clean. Reported in its usual slot further down.
  const shimProbs = shimProblems();
  let problems = [];
  withTempDir((tmp) => {
    for (const themeName of themes) {
      const out = path.join(tmp, themeName);
      // capture_output=True: BOTH streams, unlike the emits below, which redirect stdout
      // only. A failing build's stderr is not doctor's output either — the return code is.
      const rc = captureBoth(() => driverMain(['--theme', themeName, '--out', out]));
      if (rc !== 0) {
        problems = problems.concat(ran('build', `Build scan (${themeName})`,
          [`[${themeName}] build failed`]));
        continue;
      }
      problems = problems.concat(ran('build', `Build scan (${themeName})`,
        checkBuild(themeName, out)));
      problems = problems.concat(ran('global', `Global install (${themeName})`,
        globalEmitProblems(themeName)));
      problems = problems.concat(ran('claude_bob',
        `Claude/Bob/Copilot per-repo emit (${themeName})`, claudeBobEmitProblems(themeName)));
    }
  });
  problems = problems.concat(ran('parity', 'Theme parity', themeParityProblems()));
  problems = problems.concat(ran('colors', 'Colour themes', colorThemeProblems()));
  problems = problems.concat(ran('authoring', 'Authoring gates', authoringProblems()));
  problems = problems.concat(ran('shim', 'Hook shim', shimProbs));
  problems = problems.concat(ran('map', 'Module map', moduleMapProblems()));
  // P10c's `cli` check is GONE, and the reason is not that it stopped mattering. It hashed
  // `rituals/harness.py` and compared that against a digest baked into `cli.json`, to catch a
  // parser edited without regenerating the table. P2 made the table the OWNED document
  // (`js/cli-table.json`), so there is no generator to fall behind and no second file to hash
  // — the digest was a claim about a file this migration deletes. What replaces it is
  // `tests/test_cli_reference.py`'s argparse-vs-table equality, for as long as the parser is
  // still here to walk.
  if (!noBundle) {
    // `Path(bundle).expanduser().resolve()`, which `resolvePath` already IS — the default is
    // deliberately NOT resolved, because the Python's `ROOT / "Harness"` is not either and
    // the resolved spelling is what the messages print.
    const b = bundle ? resolvePath(bundle) : path.join(ROOT, 'Harness');
    problems = problems.concat(ran('bundle', 'Committed bundle drift', renderedProblems(b)));
  }
  return [themes, sortedUnique(problems)];
}

/** `run(..., capture_output=True)` — both streams into the void, the return code out. */
function captureBoth(fn) {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = out; process.stderr.write = err; }
}

/**
 * `_harness_build.cmd_doctor` — the CLI face.
 *
 * With `--theme`, one theme. With none it scopes to the INSTALLED theme, so a one-theme
 * install is not buried under the same issue repeated across every theme; `--all` is the full
 * maintainer sweep. The cross-theme parity check runs in every mode.
 */
export function cmdDoctor(args) {
  const [themes, collected] = doctorCollect({
    theme: args.theme, allThemes: Boolean(args.all), bundle: args.bundle,
    noBundle: Boolean(args.noBundle),
  });
  if (!themes.length) {
    printOut(`${collected.length ? collected[0] : '[doctor] no themes found'}\n`);
    return 1;
  }
  // ⚠ NOTES ARE PRINTED AND NOT COUNTED. The only producer is the pack-off citation report in
  // `constitutionProblems`, and the state it describes is one the install's owner chose: a
  // build that leaves body prose citing a pack it did not render. Silence there is how prose
  // and boundary drift apart, and a non-zero exit there is doctor failing a legal
  // configuration. Nothing in the recorded CLI corpus produces one — the checkout's own
  // `harness.config.json` names no packs — so the byte-compared output is unmoved.
  const notes = collected.filter(isDoctorNote);
  const problems = collected.filter((p) => !isDoctorNote(p));
  const scoped = !args.theme && !args.all && themes.length === 1;
  const note = scoped
    ? `  (scoped to installed theme '${themes[0]}'; run with --all to sweep every theme)` : '';
  for (const n of notes) printOut(`${n}\n`);
  if (problems.length) {
    printOut(`[doctor] ${problems.length} problem(s) across ${themes.length} theme(s):\n`);
    for (const p of problems) printOut(`  - ${p}\n`);
    if (problems.some((p) => p.includes('dead link'))) {
      printOut('  tip: dead links to skills mean your source is incomplete — run '
        + '`./geneseed update` (or re-sync src/), then re-check.\n');
    }
    if (problems.some((p) => p.startsWith('[themes]') && p.includes('missing key'))) {
      // ⚠ THE TIP USED TO NAME `./geneseed build --sync-themes`, AND THAT COMMAND ERRORS.
      // It was argued here on the premise that "`build` forwards its extra arguments to the
      // generator" — which was true of the reference and is not true of `cmdBuild`
      // (`js/build/generate.mjs`), which forwards `--theme` and nothing else. So the front door
      // answered `unrecognized arguments: --sync-themes` to anyone who followed doctor's own
      // advice, for as long as the premise went unchecked. The flag belongs to the GENERATOR,
      // whose binary is `geneseed-build` — which is what `README.md` and `SETUP.md` have said
      // all along. A hint is a command; if it is not runnable it is decoration.
      printOut('  tip: a theme is missing a key another theme defines — run '
        + '`geneseed-build --sync-themes` to fill it from _TEMPLATE.json, '
        + 'then restyle the added key(s) and re-check.\n');
    }
    if (note) printOut(`${note}\n`);
    return 1;
  }
  printOut('[doctor] ok — ' + `${themes.length} theme(s) clean: no unresolved tokens, no dead `
    + 'links, nothing escapes the bundle; themes in parity; specs carry purpose '
    + 'lines; rendered bundle in sync\n');
  if (note) printOut(`${note}\n`);
  return 0;
}

