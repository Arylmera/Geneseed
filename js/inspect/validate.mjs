/**
 * `validate` — the generator's old `--validate-only`, on this binary because it runs the
 * doctor's scans over a sandbox it renders first.
 *
 * Split out of `doctor.mjs`, where it already sat behind a banner of its own. It is a
 * separate VERB with a separate exit contract, and it is the one verb no recorded cell ever
 * reached — see its row in `tests/ported.json`.
 */
import path from 'node:path';
import { buildInto, emitGlobalInto, emitProjectInto } from '../../bin/build-driver.mjs';
import { pyResolve } from '../hosts/hosts.mjs';
import { validateIsVendored } from '../hosts/native.mjs';
import { pyPrint, pyPrintErr, readText } from '../lib/fs.mjs';
import { comparePaths } from '../lib/paths.mjs';
import { pyStripSpace } from '../lib/text.mjs';
import { linkProblems } from './checks-build.mjs';
import { cmdDoctor } from './doctor.mjs';
import { TOKEN_RE, isDir, isFile, rglob, sortedUnique, withTempDir, within } from './scan.mjs';

// --------------------------------------------------------------------------------------
// validate  —  the generator's `--validate-only`, on this binary because it runs the doctor
// --------------------------------------------------------------------------------------

/**
 * `build._validate_sandbox_problems` — the unresolved-token / dead-link / non-hermetic-link
 * scan over an already-rendered sandbox tree.
 *
 * A NEAR-TWIN OF `checkBuild` ABOVE, AND DELIBERATELY NOT IT, because the reference is two
 * functions and they differ in three observable ways: the token list is `sorted(set(...))`
 * here and bare `set(...)` there, the message carries no `[theme]` prefix (the caller adds
 * `[emit]` instead), and an unreadable file is SKIPPED rather than raised. Python duplicates
 * the loop because `build.py` cannot import the harness tree; here the two live in one file
 * and the duplication is eight lines — every primitive underneath (`rglob`, `stripCode`,
 * `linkProblems`, `readText`) is the shared one, which is the half that could actually drift.
 */
export function validateSandboxProblems(sandbox) {
  const out = pyResolve(sandbox);
  const problems = [];
  for (const md of rglob(out)) {
    if (!md.endsWith('.md') || !isFile(md)) continue;
    const rel = path.relative(out, md);
    if (validateIsVendored(rel)) continue;
    let text;
    // `except (OSError, UnicodeDecodeError): continue` — binary or unreadable, nothing here.
    try { text = readText(md); } catch { continue; }
    for (const tok of sortedUnique(text.match(TOKEN_RE) ?? [])) {
      problems.push(`unresolved token ${tok} in ${rel}`);
    }
    problems.push(...linkProblems(md, text, out, rel));
  }
  return problems;
}

/**
 * `subprocess.run(..., capture_output=True, text=True)` around an IN-PROCESS call.
 *
 * The reference shells to `harness.py doctor`; this calls `cmdDoctor` directly, and the
 * difference has to be undone in one place: a child's `capture_output` hands the parent
 * UNIVERSAL-NEWLINE text, so `r.stdout` holds `\n` on Windows even though the child wrote
 * `\r\n`. `pyPrint` inside `cmdDoctor` writes `\r\n`. Without the fold, the `.strip()` below
 * would leave every interior line CRLF and the re-print would double the translation.
 */
function captureStreams(fn) {
  const chunks = { out: [], err: [] };
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (c) => { chunks.out.push(String(c)); return true; };
  process.stderr.write = (c) => { chunks.err.push(String(c)); return true; };
  let code;
  try {
    code = fn();
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  const decode = (xs) => xs.join('').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return { code, out: decode(chunks.out), err: decode(chunks.err) };
}

/**
 * `build._validate_only` — render + emit the requested target into a throwaway sandbox, run
 * every validation a real build would gate on, print what WOULD have been written, and return
 * the exit code. Nothing under the sandbox survives, and no marker, manifest or registry row
 * is ever written for real.
 *
 * WHY IT IS HERE AND NOT ON THE GENERATOR DRIVER, which is where its flag lives. The
 * source-tree half of the check IS the doctor, and this module starts a process (`node --check`
 * over the OpenCode plugins). `bin/build-driver.mjs` is under a transitive ban on reaching any
 * module that can, gated twice — `tests/test_node_cli_parity.py` greps the driver's source and
 * `tests/test_hook_cli_parity.py` walks its relative imports. Siting the tool on the CLI
 * binary, which already carries the doctor, crosses it with neither gate amended and without
 * the dynamic `import()` that would evade the walk.
 *
 * THE MARKER GUARANTEE COMES FREE, and that is why `emitProjectInto`/`emitGlobalInto`/
 * `buildInto` are used rather than `driverMain(['--emit', …])`: the driver writes
 * `.geneseed-emit`/`.geneseed-footprint` and records an install-registry row AFTER the
 * dispatch, so routing through it would register a temp directory that is deleted a
 * millisecond later. The reference calls the emit functions directly for the same reason.
 *
 * THE EMIT'S OWN STDOUT IS NOT SWALLOWED. `globalEmitProblems` above wraps its call in
 * `swallowStdout` and this deliberately does not: `_validate_only` has no `redirect_stdout`,
 * so the ~200 lines of emit summary ARE part of what a dry run shows the operator.
 *
 * NO CELL CAN REACH THIS. `golden.py`'s `_argv` never emitted `--validate-only`, so the flag
 * was ungated across implementations for the whole port; the gate is the corpus in
 * `tests/test_maintainer_tools_parity.py`, which runs the reference and this side over the
 * same flags and compares stdout, stderr and the exit code.
 */
export function cmdValidate(args) {
  const problems = [];
  const scan = withTempDir((tmpRaw) => {
    // `.resolve()` mirrors `_check_build`'s: on Windows a temp dir can come back in 8.3
    // short form (`RUNNER~1`) while every link TARGET below is resolved long-form, and
    // `within` then rejects every relative link rather than only the escaping ones.
    const tmp = pyResolve(tmpRaw);
    // With a distinct `--root` the per-repo emits split their output — the bundle under
    // `out`, the native layer under `root` — so the sandbox bundle nests INSIDE the sandbox
    // root and the scan covers both layers.
    const root = args.root ? path.join(tmp, 'root') : path.join(tmp, 'out');
    const sandbox = args.root ? path.join(root, 'bundle') : root;
    const cfgDir = path.join(tmp, 'cfg');
    const emit = args.emit;
    const opts = { theme: args.theme, footprint: args.footprint };
    let scanDirs;
    try {
      if (emit.endsWith('-global')) {
        emitGlobalInto(emit.slice(0, -'-global'.length), { ...opts, out: sandbox, cfgDir });
        scanDirs = [cfgDir];
      } else if (emit === 'files') {
        buildInto({ ...opts, out: sandbox });
        scanDirs = [sandbox];
      } else {
        emitProjectInto(emit, { ...opts, out: sandbox, root });
        scanDirs = [root];
      }
    } catch (e) {
      // `except SystemExit as e` — a DELIBERATE refusal from the render (an unknown theme,
      // an incomplete source), interpolated as `{e}`.
      //
      // THE EXIT CODE AND NOT THE MESSAGE, measured rather than assumed: the reference's
      // render half is ALREADY this port. `_build_render.build` calls `_build_core.run_node`,
      // which ends `raise SystemExit(res.get("exit", 1))` — an INTEGER — so every refusal
      // that crosses the seam arrives here as `SystemExit(1)` and `str(e)` is `'1'`, not the
      // sentence `load_theme` wrote on stderr on the way out. A port that printed `e.message`
      // says `unknown theme 'x'` where the reference says `1`. The corpus in
      // `tests/test_maintainer_tools_parity.py` is what found it; nothing else could.
      if (e && e.exitCode !== undefined) {
        pyPrint(`[validate-only] render/emit FAILED for theme '${args.theme}' `
          + `emit '${emit}': ${e.exitCode}\n`);
        return null;
      }
      throw e;
    }

    const written = scanDirs.filter(isDir).flatMap((d) => rglob(d)).filter(isFile)
      .sort(comparePaths);
    pyPrint(`[validate-only] theme=${args.theme} emit=${emit} `
      + `footprint=${args.footprint}\n`);
    pyPrint(`[validate-only] would write ${written.length} file(s) under ${args.out}`
      + (args.root ? ` (root ${args.root})` : '')
      + ' — nothing was actually written (sandboxed).\n');
    if (args.verbose) {
      let base = scanDirs[0];
      for (const p of written) {
        for (const d of scanDirs) {
          if (within(p, d)) { base = d; break; }
        }
        pyPrint(`  would write: ${path.relative(base, p)}\n`);
      }
    }
    for (const d of scanDirs) {
      for (const p of validateSandboxProblems(d)) problems.push(`[${emit}] ${p}`);
    }
    return scanDirs;
  }, 'geneseed-validate-');
  if (scan === null) return 1;

  // The source-tree-wide checks (theme parity, authoring gates, AGENT.md table parity,
  // colour themes) do not depend on --out/--root/--emit at all and already live fully tested
  // in the doctor, so they run through it rather than being re-derived. The reference SHELLS
  // to `harness.py doctor --theme T --no-bundle`; one process is what this port has.
  const doctor = captureStreams(() => cmdDoctor({ theme: args.theme, noBundle: true }));
  if (pyStripSpace(doctor.out)) pyPrint(`${pyStripSpace(doctor.out)}\n`);
  if (pyStripSpace(doctor.err)) pyPrintErr(`${pyStripSpace(doctor.err)}\n`);
  if (doctor.code !== 0) {
    problems.push(`[doctor] source-tree validation failed for theme '${args.theme}' `
      + '(see output above)');
  }

  if (problems.length) {
    pyPrint(`[validate-only] ${problems.length} problem(s):\n`);
    for (const p of problems) pyPrint(`  - ${p}\n`);
    return 1;
  }
  pyPrint('[validate-only] ok — would render and emit cleanly, no problems found.\n');
  return 0;
}
