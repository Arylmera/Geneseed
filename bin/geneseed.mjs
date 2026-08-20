#!/usr/bin/env node
/**
 * The Node driver — `build.py`'s `main()`, as a second CLI beside it.
 *
 * P4 adds a driver; it does not replace one. `build.py` is ALSO the `import build` facade
 * that 19 `rituals/` modules read 55 distinct names from, and ~11 sites spawn
 * `[sys.executable, build.py, ...]`. None of those flip here: the Python CLI has to
 * survive this phase intact, and every gate that drives it keeps driving it.
 *
 * WHAT THIS FILE ORIGINATES, AND WHY THAT IS THE PHASE'S WHOLE POINT.
 * Every phase since P2d has asked one question at the process boundary: which values does
 * the CHILD resolve, and which does the parent decide and send? P3c's answer for `cfgDir`
 * was "the child must never resolve it — a child that did would render 135 files into the
 * developer's real ~/.config/opencode". P4 inverts that rule rather than repeating it:
 * this file IS the parent now, so the values a child must never resolve are exactly the
 * values this file must originate. `ROOT` and the seven paths under it come from this
 * script's own location, not from an inherited `cfg`.
 *
 * TWO KEYS ARE DELIBERATELY ABSENT FROM `cfg`, and their absence is load-bearing.
 * `js_cfg()` (_build_core.py:199) always sends `structure` and `capabilityLinkRe`, because
 * the Python originals are module-level names that TESTS MUTATE — `_OWNED` membership
 * asked one level out. This driver has no Python module to mutate, so it sends neither and
 * `js/render.mjs:215`'s `cfg.structure ?? STRUCTURE` and `js/emit.mjs:680`'s
 * `cfg.capabilityLinkRe ? ... : <default>` take their right-hand branches for the first
 * time. Those two fallbacks have been dead code since they were written — always
 * overridden by the driver that always supplies them. P4 is what makes them live.
 *
 * THE FOOTPRINT DEFAULT IS THE FLAG'S, NOT THE FUNCTION'S. `--footprint` defaults to
 * `lean` (build.py:354); every `emit_*`/`build` SIGNATURE defaults to `full`. A driver
 * that reproduced the signature default would emit a different harness in every cell while
 * every gate that calls the functions directly stayed green.
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync,
  statSync, unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  build, emitOpencodeRender, emitOpencodeGlobalRender, emitClaudeRender, phaseLog,
} from '../js/emit.mjs';
import { settingsIntegrityCheck } from '../js/settings.mjs';
import { writeText, parseJson, jsonDumpsIndent, withPyNewlines } from '../js/lib/fs.mjs';
// P5c moved these out of this file: `bin/geneseed-cli.mjs` needs the same four resolvers to
// find a global install, and a resolver that decides WHERE a driver writes is the last thing
// that should exist twice. golden.py's 259 cells are what made the move safe to attempt.
import {
  GLOBAL_MANIFEST, pyResolve, opencodeConfigDir, claudeConfigDir, bobConfigDir,
  copilotConfigDir,
} from '../js/hosts.mjs';

// P5d moved these out of this file for the reason P5c moved the host resolvers: `harness
// status` renders to count, so `bin/geneseed-cli.mjs` needs the same checkout paths and the
// same cfg. golden.py's 259 cells all build one, which is what made the move safe.
import { ROOT, CONFIG, THEMES, discoverNames, makeCfg, PACK_ORDER } from '../js/checkout.mjs';

// P5f moved these, for the same arithmetic a third time: `harness rebuild-all` reads the
// registry to find every install it must re-emit, and a CLI verb may not reach into a driver
// for a reader. See js/registry.mjs.
import { registryRecord, registryRoots } from '../js/registry.mjs';

// P2. `--sync-themes` crossed into its own module rather than into this file: it is 90 lines
// of textual surgery over committed files with a corpus of its own, and it is the half of the
// maintainer pair that needs nothing this driver is banned from having.
import { syncThemes } from '../js/themes.mjs';

/** The nine `--emit` choices, in build.py:337-338's order. */
const EMITS = ['files', 'opencode', 'opencode-global', 'claude', 'claude-global',
  'bob', 'bob-global', 'copilot', 'copilot-global'];

/**
 * The emits this driver can run end to end — all nine, as of P4e.
 *
 * The set is kept (rather than deleted along with the refusal branch) because it is the
 * thing `test_the_node_driver_classifies_every_emit` reads to assert the PARTITION: every
 * `--emit` choice is either here or refused with exit 3, so a tenth emit added to `EMITS`
 * without crossing is a failure rather than an oversight. It is also what
 * `test_every_relocation_var_moves_its_global_target` cross-checks its host table against.
 */
const PORTED = new Set(EMITS);

/** `_build_emit.PRIMARY_AGENT_SRC`. */
const PRIMARY_AGENT_SRC = path.join(ROOT, 'adapters', 'opencode', 'agents', 'orchestrator.md');
/**
 * `_build_global.HOSTS[host]['native_catalog']` — does the host catalogue skills and agents
 * to the model itself? A DECISION the driver takes and sends, never something the render
 * half re-derives: `emit_opencode` passes `host_catalogs_natively('opencode')`, which is
 * `true`, where the plain `files` bundle passes `false`. Getting this wrong collapses (or
 * fails to collapse) AGENT.md's capability tables in every cell.
 */
const NATIVE_CATALOG = { opencode: true, claude: true, bob: false, copilot: false };

/** `_build_render.resolve_out` — absolute, or relative to the CURRENT WORKING DIRECTORY
 *  (not to ROOT), so the harness renders straight into any repository.
 *
 *  EXPORTED IN P5i because `js/setup.mjs` became its second caller: `_setup_summary_lines`
 *  names the AGENT.md a bundle emit just wrote, and it names it by the same resolution the
 *  emit used. Copying the one line would be a second owner of the rule that a bare `Harness`
 *  follows the invocation and not the checkout — which is what
 *  `build/the-bundle-follows-cwd-not-the-checkout` exists to gate.
 *
 *  `pyResolve` AND NOT `path.resolve`, and the difference is the whole reason `pyResolve`
 *  exists: the reference ends in `.resolve()`, which canonicalises — 8.3 short names expanded
 *  on Windows, symlinks followed on POSIX, the filesystem's own casing — where `path.resolve`
 *  only normalises `.`/`..`. Nine `pyResolve` call sites had the rule and this one did not.
 *  It is invisible on a machine whose paths are already canonical, which is every machine
 *  this ran on until GitHub's Windows runner handed it a `C:\\Users\\RUNNER~1\\...` and the
 *  two CLIs printed the same directory under two different names — a 70-byte difference in a
 *  line compared BYTE for byte by `test_the_two_entry_points_agree_on_stdout_BYTES`. The
 *  argument to `pyResolve` is made absolute first so its `expanduser` cannot fire: the
 *  reference does not expand `~` here, and a bare `~` is a legal directory name. */
export function resolveOut(raw) {
  return pyResolve(path.resolve(process.cwd(), raw));
}

/**
 * build.py:307-321 — the three defaults that come from `harness.config.json`.
 *
 * The corrupt-file branch is reproduced including its imprecision: the warning says only
 * "using theme 'neutral'", but the branch also resets posture and mode. Matching the
 * Python text matters more than fixing it here, because the two CLIs' stderr is compared
 * byte-for-byte by `tests/golden.py` (:316).
 */
function configDefaults() {
  const d = {
    theme: 'neutral', posture: 'peer', mode: 'direct', doctrines: [...PACK_ORDER],
  };
  if (!existsSync(CONFIG)) return d;
  try {
    const data = JSON.parse(readFileSync(CONFIG, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.theme !== undefined) d.theme = data.theme;
      if (data.posture !== undefined) d.posture = data.posture;
      if (data.mode !== undefined) d.mode = data.mode;
      // `doctrines` is the only config key that is a LIST, so it is the only one that can be
      // the right type and still nonsense. A bad value warns and falls back to all packs
      // rather than dying: this file is hand-editable, and a typo here must not brick every
      // rebuild of an install whose AGENT.md is otherwise fine. `[]` is a legitimate value
      // (no packs) and must survive the check — hence an explicit Array test, not truthiness.
      if (data.doctrines !== undefined) {
        const known = discoverNames('doctrines', PACK_ORDER[0]);
        if (Array.isArray(data.doctrines) && data.doctrines.every((x) => known.includes(x))) {
          d.doctrines = PACK_ORDER.filter((p) => data.doctrines.includes(p));
        } else {
          process.stderr.write(`[geneseed] WARN: ${path.basename(CONFIG)} "doctrines" is not a `
            + 'list of known pack names — using all packs.\n');
        }
      }
    }
  } catch {
    process.stderr.write(`[geneseed] WARN: ${path.basename(CONFIG)} is unreadable — `
      + "using theme 'neutral'.\n");
  }
  return d;
}

/**
 * The parser's tables, at MODULE scope so `usage` reads the same two objects the loop below
 * dispatches on. They were local to `parseArgs` until `-h` arrived; a help text listing its
 * own private copy of the flags is a second source that drifts silently the first time a
 * flag is added to one and not the other, and nothing downstream would say so.
 */
const VALUED = {
  '--theme': 'theme', '--posture': 'posture', '--mode': 'mode',
  '--doctrines': 'doctrines',
  '--out': 'out', '--target': 'out', '--emit': 'emit',
  '--footprint': 'footprint', '--root': 'root',
};
const FLAGS = {
  '--sync-themes': 'syncThemes', '--validate-only': 'validateOnly',
  '-v': 'verbose', '--verbose': 'verbose',
};

/**
 * The four flags `choice` validates, as ONE table for the same anti-drift reason.
 *
 * A function and not a constant because two of the four read the checkout: `discoverNames`
 * scans `postures/` and `modes/`, so the answer depends on the source tree this driver is
 * standing in and cannot be frozen at import.
 *
 * `--doctrines` is DELIBERATELY not a fifth row. Every consumer of this table treats an
 * entry as one value drawn from a closed list — `choice` refuses anything else, and
 * `usage`'s metavar prints the list as the whole legal surface. `--doctrines` takes a comma
 * LIST plus the sentinel `none`, so a row here would have refused `craft,rigor` outright and
 * advertised a metavar that lies. It is validated by `parseDoctrines` instead and prints the
 * plain `DOCTRINES` metavar, exactly as `--theme` (also open-ended) already does.
 */
function choicesFor() {
  return {
    '--emit': EMITS,
    '--footprint': ['lean', 'full'],
    '--posture': discoverNames('postures', 'peer'),
    '--mode': discoverNames('modes', 'direct'),
  };
}

/**
 * `--doctrines craft,rigor` / `--doctrines none` -> the cfg's pack array.
 *
 * Normalised into `PACK_ORDER` rather than kept in the order typed, which also dedupes: the
 * rendered `Active packs:` line is a MARKER a later reader parses back out of a deployed
 * carrier, and a marker whose contents depend on argument order is one that compares unequal
 * to itself. Validation is against DISCOVERY, not `PACK_ORDER`, so the refusal names the
 * packs the checkout actually has; a discovered pack missing from `PACK_ORDER` is a
 * different fault and `js/render.mjs` refuses the whole build for it.
 */
function parseDoctrines(value) {
  const s = value.trim();
  const known = discoverNames('doctrines', PACK_ORDER[0]);
  if (s === 'none') return [];
  const names = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (!names.length) {
    die(2, "argument --doctrines: expected a comma-separated list of packs, or 'none'");
  }
  for (const n of names) {
    if (!known.includes(n)) {
      die(2, `argument --doctrines: invalid choice: '${n}' (choose from `
        + `${known.map((c) => `'${c}'`).join(', ')}, or 'none')`);
    }
  }
  return PACK_ORDER.filter((p) => names.includes(p));
}

/**
 * `-h/--help` — the flag argparse handed the reference for free and this hand-rolled parser
 * did not, so the two entry points disagreed: the reference printed usage and exited 0 while
 * `geneseed-build --help` died with `unrecognized arguments: --help` and exit 2.
 *
 * NO CELL COULD SEE IT. `golden.py`'s `_argv` builds every cell out of the render flags and
 * never emits `--help`, so the byte comparison only ever ran inputs both implementations
 * were built for — a flag missing from one side is invisible to a gate that never passes it.
 * `test_the_help_text_names_every_flag_the_reference_takes` is the gate, and it reads
 * `build.py`'s `add_argument` calls rather than this file, so it fails on drift from EITHER
 * side rather than agreeing with whichever one it was copied from.
 *
 * The text is deliberately NOT argparse's byte-for-byte. Reproducing its wrapping would put
 * a hand-written copy of the reference's output in a file no gate compares, which is the
 * drift this whole docblock is about; the surface here is the npx one, in the same class as
 * the `--sync-themes` and `--validate-only` refusals that already answer differently.
 */
function usage() {
  const choices = choicesFor();
  const metavar = (flag) => (choices[flag]
    ? `{${choices[flag].join(',')}}`
    : VALUED[flag].toUpperCase());
  const valued = Object.keys(VALUED);
  const bare = Object.keys(FLAGS);
  return [
    `usage: geneseed-build [-h] ${[...valued.map((f) => `[${f} ${metavar(f)}]`),
      ...bare.map((f) => `[${f}]`)].join(' ')}`,
    '',
    'Render the Geneseed harness for a theme.',
    '',
    'options:',
    '  -h, --help',
    ...valued.map((f) => `  ${f} ${metavar(f)}`),
    ...bare.map((f) => `  ${f}`),
    '',
  ].join('\n');
}

/** argparse's `--flag value` and `--flag=value`, plus the `--target` alias for `--out`. */
function parseArgs(argv, defaults) {
  const args = {
    theme: defaults.theme, posture: defaults.posture, mode: defaults.mode,
    doctrines: defaults.doctrines,
    out: 'Harness', emit: 'files', footprint: 'lean', root: null,
    syncThemes: false, validateOnly: false, verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    const eq = tok.indexOf('=');
    const name = eq > 0 ? tok.slice(0, eq) : tok;
    if (tok === '-h' || tok === '--help') {
      process.stdout.write(usage());
      // The same marker `die` throws, with a SUCCESS code: help is not a refusal, and
      // `main`'s catch is what turns either into this process's exit status. A bare
      // `process.exit(0)` here would be the P5f bug in reverse — it takes `rebuild-all`'s
      // loop with it, and skips the stdout flush the text was just written to.
      const e = new Error('help');
      e.exitCode = 0;
      throw e;
    }
    if (VALUED[name]) {
      const val = eq > 0 ? tok.slice(eq + 1) : argv[i += 1];
      if (val === undefined) die(2, `argument ${name}: expected one argument`);
      args[VALUED[name]] = val;
    } else if (FLAGS[tok]) {
      args[FLAGS[tok]] = true;
    } else {
      die(2, `unrecognized arguments: ${tok}`);
    }
  }
  const choices = choicesFor();
  for (const flag of Object.keys(choices)) choice(flag, args[VALUED[flag]], choices[flag]);
  // Only when the flag was actually PASSED is this a string; left at its default it is
  // already the array `configDefaults` built, and re-parsing an array would stringify it.
  if (typeof args.doctrines === 'string') args.doctrines = parseDoctrines(args.doctrines);
  return args;
}

/**
 * The generator's OWN flag surface, for the one consumer that is not this driver.
 *
 * `geneseed validate` takes `--theme/--emit/--out/--root/--footprint/-v` — the reference's
 * `--validate-only` reads exactly the flags `build.py`'s parser already produced, so the port
 * hands the CLI this parser rather than a second one beside it. That is not tidiness: a
 * hand-rolled copy would have its own `--target` alias, its own `choices` lists and its own
 * `-h`, and `test_the_help_text_names_every_flag_the_reference_takes` gates only this one.
 *
 * `withPyNewlines` because the refusal and `-h` paths WRITE: called from `bin/geneseed.mjs`
 * they sit inside `main`'s funnel, and called from the CLI binary they would not.
 */
export function parseDriverArgs(argv) {
  return withPyNewlines(() => parseArgs(argv, configDefaults()));
}

function choice(flag, value, allowed) {
  if (!allowed.includes(value)) {
    die(2, `argument ${flag}: invalid choice: '${value}' `
      + `(choose from ${allowed.map((c) => `'${c}'`).join(', ')})`);
  }
}

/**
 * argparse's error exit — a THROW since P5f, where it used to be `process.exit(code)`.
 *
 * `harness rebuild-all` re-emits every active install and its whole contract is "continue
 * past a failure so one broken install never blocks the rest". The Python gets that for free:
 * each rebuild is a SUBPROCESS, and a child that exits 2 hands back a return code. Here the
 * driver is a module in the same process, so `process.exit` would take the loop, the CLI and
 * every remaining install with it — the one place where importing rather than spawning is not
 * transparent, and it turns a per-install failure into a total one.
 *
 * The marker is `exitCode`, the SAME one `assertSourceComplete` and `effectiveTheme` already
 * use, and the first draft of this used a second name so that only `die` would be converted
 * — on the argument that an incomplete source should keep its stack. That draft was wrong,
 * and `rebuild-all/one-broken-install-does-not-stop-the-rest` is what said so: a
 * `.geneseed-theme` naming a theme that does not exist makes `effectiveTheme` refuse, and
 * with only `die` converted the refusal propagated out of the loop and the remaining
 * installs were never rebuilt. `main` is standing in for a PROCESS, and a process boundary
 * turns every deliberate refusal into an exit code — the narrower rule was a distinction
 * with no principle behind it.
 *
 * One behaviour improves as a side effect, and it is worth naming rather than discovering
 * later: `process.exit` terminates without flushing a pending stdout write, so a refusal on
 * a slow pipe could lose output it had already produced. Returning through `main` lets Node
 * drain normally.
 */
function die(code, msg) {
  process.stderr.write(`geneseed: error: ${msg}\n`);
  const e = new Error(msg);
  e.exitCode = code;
  throw e;
}

/**
 * `_build_settings._hook_runner_entry()`'s two values — this driver's answer, which since
 * P5b is NOT Python's.
 *
 * The Python original returns `sys.executable` and `<checkout>/rituals/harness.py`: the
 * interpreter running `build.py`, and the harness it will hand `%*` to. This driver returns
 * `process.execPath` and `<checkout>/bin/geneseed-hook.mjs`, because the four verbs the
 * emitted hooks invoke — context, git-gate, rule-gate, learn — are now Node, and an install
 * this driver emits therefore needs no Python at all for its hooks.
 *
 * WHAT THIS RETIRED, AND WHY IT IS A DELETION. Until this phase the function was
 * `hookOptsOrDie`: it scanned PATH for an interpreter and refused the four Claude-shaped
 * emits with exit 4 when it found none, because writing a shim that names a nonexistent
 * interpreter silently disables every hook in the install. Both halves are gone. `runner` is
 * `process.execPath` — the node already running this file, which by construction exists —
 * so there is nothing left to discover and no way for discovery to fail. P4e kept the
 * unreachable exit-3 branch because `test_the_node_driver_classifies_every_emit` asserts a
 * partition it belongs to; nothing asserts a partition over this one, so keeping it would
 * be keeping code no test can reach for no stated reason.
 *
 * THE SHIM IS MACHINE-WIDE, AND THAT IS THE DECISION THIS PHASE ACTUALLY TOOK.
 * `hookShimPath()` is `$GENESEED_HOME`-or-`~/.geneseed` + `bin/geneseed-hook[.cmd]`, with no
 * per-install component: every emit of every install on the machine rewrites the same file,
 * and every install's hooks execute it. While both drivers baked Python that was invisible,
 * because last-writer-wins wrote the same thing. It is observable now — a machine whose last
 * emit ran through this file has EVERY install's hooks running under Node, including
 * installs the Python driver wrote, and the reverse.
 *
 * That is correct exactly while the two entry points answer the same verbs the same way, so
 * the gate that used to be a formality is now load-bearing:
 * `test_the_entry_carries_exactly_the_verbs_the_emitter_wires` reads the emitter's wiring
 * and `bin/geneseed-hook.mjs`'s VERBS table and requires them EQUAL — a wired verb the entry
 * lacks is a dead hook on every install on the machine, not just this one. The alternative
 * considered and rejected was a per-driver shim path: the path is baked into every already
 * emitted hook command, so changing it makes every existing install's hooks stale until
 * re-emit, which is P10's migration arriving five phases early.
 *
 * EXPORTED SINCE P6i, because the emitter is no longer its only caller.
 * `js/uninstall.mjs`'s `remergeClaudeHooks` re-merges the canonical hooks when a disabled
 * Claude install is turned back on, and `mergeClaudeSettings` refuses to guess the pair —
 * correctly. There is exactly one right answer on this side and it is this function, so the
 * second caller imports it rather than restating two lines that must never drift: a
 * reactivate whose shim path differed from the emitter's would wire hooks pointing at a file
 * the emitter never writes.
 */
export function hookRunnerEntry() {
  return { runner: process.execPath, entry: path.join(ROOT, 'bin', 'geneseed-hook.mjs') };
}

/**
 * `_build_global._preamble_exclude` — the `claudeMdExcludes` entry a PROJECT install writes
 * to suppress the GLOBAL preamble of the same host, or null for a host that gets none.
 *
 * `_PREAMBLE_CONFIG_DIR` has exactly one key, so only a `CLAUDE.md` carrier resolves to a
 * value: Bob's and Copilot's `AGENTS.md`, and Copilot's `copilot-instructions.md`, get null.
 *
 * Computed HERE and not in the render child, and that is the inverted boundary rule doing
 * real work rather than being restated. P3b's note on the Python original: it resolves
 * through `_build_core._claude_config_dir`, an `_OWNED` name precisely because the suite
 * redirects it at a sandbox, and a redirect that stops at a subprocess half-works in
 * silence. The child must therefore never derive it — but this file is the PARENT, so
 * deriving it is exactly this file's job, and `js/emit.mjs` receives the answer.
 *
 * POSIX spelling, per the original: `claudeMdExcludes` entries are glob patterns, where a
 * backslash is an escape, so the Windows-native form risks never matching.
 */
function preambleExclude(claudeMd) {
  if (path.basename(claudeMd) !== 'CLAUDE.md') return null;
  return pyResolve(path.join(claudeConfigDir(), 'CLAUDE.md')).split(path.sep).join('/');
}

/**
 * `_build_global._warn_bob_global_over_project` — informational, never auto-removes.
 *
 * Same shape as `warnCopilotGlobalOverProject` and a DIFFERENT message, because the two
 * hosts differ in what they can promise: Copilot simply stacks both preambles, while Bob's
 * workspace rules may or may not shadow the global copy depending on precedence nothing can
 * verify at emit time — so this text hedges where Copilot's asserts.
 */
function warnBobGlobalOverProject() {
  const survivors = projectSurvivors('bob');
  if (!survivors.length) return;
  process.stderr.write(
    `[geneseed] WARN: ${survivors.length} project Bob install(s) already exist — `
    + 'emitting GLOBAL now means BOTH may auto-load together in those repos '
    + "(doubled context) unless Bob's workspace rules truly shadow the global "
    + "one there. Review and remove what you don't want:\n");
  for (const root of survivors) {
    process.stderr.write(`  - ${root}  ->  geneseed uninstall --target "${root}"\n`);
  }
}

/**
 * `_build_render._rel_under` — POSIX path of `out` relative to `root`, or '' when they are
 * the same directory OR when `out` is not under `root` at all.
 *
 * `Path.relative_to` RAISES for a non-descendant; `path.relative` happily walks up with
 * `..`. Reproducing the raise is the whole content of this function: a `..` prefix here
 * would be written into `opencode.json`'s instruction path.
 */
function relUnder(out, root) {
  const rel = path.relative(root, out);
  if (rel === '' || rel === '.') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return rel.split(path.sep).join('/');
}

/**
 * `_build_global._write_manifest_atomic` — temp + rename, so a torn manifest can never make
 * the next emit treat every owned file as the user's own.
 *
 * `writeText`, not `writeFileSync`: Python writes this through `Path.write_text`, so the
 * whole document is CRLF on Windows.
 *
 * `jsonDumpsIndent`, not `JSON.stringify`: `json.dumps` defaults to `ensure_ascii=True` and
 * escapes every non-ASCII character, where `JSON.stringify` emits it raw. This was
 * `JSON.stringify` for a whole phase and nothing caught it, because the only manifest being
 * written was the per-repo OpenCode one and its `_comment` is pure ASCII. The
 * `opencode-global` comment contains an em dash, and that is the character that finally
 * made the difference observable — a helper that is wrong everywhere but tellable in only
 * one place.
 */
function writeManifestAtomic(file, data) {
  const tmp = `${file}.tmp`;
  writeText(tmp, `${jsonDumpsIndent(data)}\n`);
  renameSync(tmp, file);
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/**
 * Write-before-delete: remove only what this layer owned before and no longer produces.
 *
 * Runs AFTER the whole current set is on disk, so a live file is never momentarily absent
 * part-way through an emit. A pre-existing file that was never in the manifest is the
 * user's and is not reachable from here at all.
 */
function pruneOwned(oc, oldOwned, owned) {
  const now = new Set(owned);
  const failed = [];
  for (const rel of [...new Set(oldOwned)].filter((r) => !now.has(r)).sort()) {
    const victim = path.join(oc, rel);
    try {
      if (isFile(victim)) {
        unlinkSync(victim);
        const parent = path.dirname(victim);
        if (parent !== oc && readdirSync(parent).length === 0) rmdirSync(parent);
      }
    } catch (e) {
      // Deliberately divergent and deliberately unreachable in the gates: `str(OSError)`
      // ("[Errno 13] Permission denied: ...") and a Node error message ("EACCES: ...") can
      // never agree, and no cell drives a real filesystem failure through this text.
      failed.push(`${rel} (${e.message})`);
    }
  }
  if (failed.length) {
    process.stderr.write('[geneseed] WARN: could not remove stale owned file(s): '
      + `${failed.join(', ')}\n`);
  }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/**
 * `_build_global._project_survivors` — registered per-repo PROJECT installs of `emitName`.
 *
 * Each candidate root's own `.geneseed-emit` marker is read and compared to the literal
 * emit name; an unreadable marker is skipped, never raised.
 */
function projectSurvivors(emitName) {
  const out = [];
  for (const root of registryRoots()) {
    let marker;
    try {
      marker = readFileSync(path.join(root, '.geneseed-emit'), 'utf8').trim();
    } catch { continue; }
    if (marker === emitName) out.push(root);
  }
  return out;
}

/**
 * `_build_global._warn_copilot_global_over_project` — purely informational.
 *
 * Copilot documents no exclude or shadow mechanism, so a global preamble and a project
 * one simply stack. UNREACHABLE from every golden cell: each emits into a fresh sandbox
 * whose registry is empty, so `projectSurvivors` is always `[]` and this never prints.
 * Reaching it needs a project emit registered BEFORE a global one in the same sandbox.
 */
function warnCopilotGlobalOverProject() {
  const survivors = projectSurvivors('copilot');
  if (!survivors.length) return;
  process.stderr.write(
    `[geneseed] WARN: ${survivors.length} project Copilot install(s) already exist — `
    + 'emitting GLOBAL now means BOTH preambles load together in those repos '
    + '(doubled context): Copilot stacks ~/.copilot/copilot-instructions.md on top '
    + "of a repo's own AGENTS.md. Review and remove what you don't want:\n");
  for (const root of survivors) {
    process.stderr.write(`  - ${root}  ->  geneseed uninstall --target "${root}"\n`);
  }
}

/**
 * `_build_emit.emit_opencode` — the driver body, which is what this phase actually ports.
 *
 * RENDER and WIRE already ran in Node before P4; what lived only in Python was the stage
 * either side of them: reading the previous manifest (PRE), pruning what this layer no
 * longer owns, writing the manifest atomically, and the summary line. All five stages now
 * run in one process, in the order `test_emit_phase_order.py` pins for the Python twin:
 * RENDER -> WIRE -> PRUNE -> MANIFEST -> VERIFY (opencode has no VERIFY; it writes no
 * settings file of its own).
 */
function emitOpencode(cfg, args, out) {
  const root = args.root ? resolveOut(args.root) : out;
  const oc = path.join(root, '.opencode');
  const manifestPath = path.join(oc, GLOBAL_MANIFEST);

  // PRE. A missing manifest reads as "owned nothing before", which is what makes the first
  // re-emit after an upgrade treat already-existing files as the user's (claim-on-create)
  // rather than deleting them. The prune set is then empty by construction.
  const manifestExisted = existsSync(manifestPath);
  let oldOwned = [];
  if (manifestExisted) {
    try {
      const m = parseJson(readFileSync(manifestPath, 'utf8'));
      oldOwned = (m && m.owned) || [];
    } catch { oldOwned = []; }
  }

  const agentPathRel = relUnder(out, root);
  const agentPath = agentPathRel ? `${agentPathRel}/AGENT.md` : 'AGENT.md';

  // RENDER + WIRE, one call. `primaryAgentSrc` lives in `_build_emit` and only this job
  // needs it, so the caller adds it rather than `makeCfg` reaching across.
  const rendered = emitOpencodeRender(
    { ...cfg, primaryAgentSrc: PRIMARY_AGENT_SRC },
    {
      theme: args.theme, out, root, footprint: args.footprint,
      nativeCatalog: NATIVE_CATALOG.opencode, oldOwned, manifestExisted, agentPath,
    });
  const { owned, stats, cfgName } = rendered;

  phaseLog('PRUNE');
  pruneOwned(oc, oldOwned, owned);

  phaseLog('MANIFEST');
  writeManifestAtomic(manifestPath, {
    _comment: 'Files owned by Geneseed\'s per-repo OpenCode emit (--emit opencode). '
      + 'Do not edit; removed on re-emit. A pre-existing file not in this '
      + 'list is yours and is never touched.',
    owned: [...owned].sort(),
    scope: 'project',
  });

  const extras = [...(stats.primary ? ['primary agent'] : []),
    ...(stats.nCommands ? [`${stats.nCommands} command(s)`] : [])];
  const extra = extras.length ? ` + ${extras.join(', ')}` : '';
  process.stdout.write(`[geneseed] opencode layer: ${stats.nAgents} subagents, `
    + `${stats.nSkills} skills, ${stats.nPlugins} plugin(s), `
    + `${stats.nWorkflows} workflow file(s), ${cfgName} (instructions: ${agentPath})`
    + `${extra}\n`);
}

/**
 * `_build_global.emit_opencode_global` — the driver body for the "everything global, zero
 * per-repo" deployment.
 *
 * Shaped like `emitOpencode` and differing in four measured ways, each of which is a value
 * this driver decides rather than the child re-deriving it:
 *   - the target is the RESOLVED config dir, not `--out`;
 *   - `out` is passed through unchanged and is the LEGACY BUNDLE a memory store is migrated
 *     from — not the target, not the config dir's parent, not derivable from anything the
 *     child holds;
 *   - `agentPath` is ABSOLUTE here (`<cfg>/AGENT.md` as POSIX), where the per-repo emit
 *     sends a path relative to the project root;
 *   - the manifest carries no `scope` and no `managed` claim set, because the one file this
 *     emit wires is never unwired by any teardown — so there is nothing to record and no
 *     VERIFY stage to re-read it.
 */
function emitOpencodeGlobal(cfg, args, out) {
  const cfgDir = args.cfgDir ?? opencodeConfigDir();
  const manifestPath = path.join(cfgDir, GLOBAL_MANIFEST);

  let oldOwned = [];
  if (existsSync(manifestPath)) {
    try {
      const m = parseJson(readFileSync(manifestPath, 'utf8'));
      oldOwned = (m && m.owned) || [];
    } catch { oldOwned = []; }
  }

  const agentPath = path.join(cfgDir, 'AGENT.md').split(path.sep).join('/');

  const rendered = emitOpencodeGlobalRender(
    { ...cfg, primaryAgentSrc: PRIMARY_AGENT_SRC },
    {
      theme: args.theme, cfgDir, out: out === null ? null : out,
      footprint: args.footprint, nativeCatalog: NATIVE_CATALOG.opencode,
      oldOwned, agentPath,
    });
  const { owned, stats, memStatus, nbStatus, cfgName } = rendered;

  phaseLog('PRUNE');
  pruneOwned(cfgDir, oldOwned, owned);

  phaseLog('MANIFEST');
  writeManifestAtomic(manifestPath, {
    _comment: 'Files owned by Geneseed\'s --emit opencode-global. '
      + 'Do not edit; removed on re-emit. The memory and notebook '
      + 'stores are NOT listed — they are never deleted.',
    owned: [...owned].sort(),
  });

  const extras = [...(stats.primary ? ['primary agent'] : []),
    ...(stats.nCommands ? [`${stats.nCommands} command(s)`] : [])];
  const extra = extras.length ? ` + ${extras.join(', ')}` : '';
  process.stdout.write(`[geneseed] opencode-global -> ${cfgDir}: ${stats.nAgents} subagents, `
    + `${stats.nSkills} skills, ${stats.nPlugins} plugin(s), `
    + `${stats.nWorkflows} workflow file(s), AGENT.md, ${memStatus}, ${nbStatus}, `
    + `${cfgName} (no context.json)${extra}. `
    + 'The learn plugin now finds <cfg>/memory automatically; set GENESEED_HARNESS only to '
    + 'override.\n');
  return cfgDir;
}

/**
 * `_build_global._emit_claude_core` — the shared engine behind six emits.
 *
 * Only the two Copilot ones run through it so far, and that is a deliberate split rather
 * than an arbitrary stopping point: `js/emit.mjs:1166` gates the entire settings/hook path
 * behind `if (!isCopilot)`, so a Copilot emit never reaches `hookPrefix` and therefore never
 * needs `hookOpts` — the pair of machine-absolute values (`sys.executable` and the harness
 * entry point) that a Node driver has no way to produce. Copilot crossing first isolates
 * this driver body from that question entirely.
 *
 * `hookOpts` is OMITTED for a host that does not wire hooks, rather than passed as `{}` or
 * `null`. If a future change ever routed a Copilot emit into the hook path, `hookPrefix()`
 * would receive `undefined`, hit its own default and throw the error it was built to throw
 * — where `null` would raise an unrelated TypeError and `{}` would bake the literal string
 * `"undefined"` into the shim and silently kill every hook in the install. Fail loud, on
 * purpose. The four hook-writing hosts pass a real pair from `hookRunnerEntry()`, which
 * cannot fail to produce one — `process.execPath` is the node already running.
 */
function emitClaudeCore(cfg, args, { cfgDir, claudeMd, scope, host, out, hookOpts }) {
  const manifestPath = path.join(cfgDir, GLOBAL_MANIFEST);
  let oldOwned = [];
  let oldManaged = {};
  if (existsSync(manifestPath)) {
    try {
      const data = parseJson(readFileSync(manifestPath, 'utf8'));
      oldOwned = data.owned || [];
      oldManaged = (data.managed && typeof data.managed === 'object'
        && !Array.isArray(data.managed)) ? data.managed : {};
    } catch { oldOwned = []; oldManaged = {}; }
  }
  const isCopilot = host === 'copilot';

  // RENDER + WIRE in one child's worth of work. `preambleExclude` is null for every host
  // but Claude — `_PREAMBLE_CONFIG_DIR` has exactly one key, `CLAUDE.md` — so neither
  // Copilot carrier filename (copilot-instructions.md, AGENTS.md) resolves to one, and
  // neither does Bob's. Spelling it as a call rather than a literal is what makes that a
  // measured `null` instead of an assumed one.
  const rendered = emitClaudeRender(cfg, {
    theme: args.theme, cfgDir, claudeMd, scope, host,
    out: out === null ? null : out,
    footprint: args.footprint, nativeCatalog: NATIVE_CATALOG[host] ?? false,
    oldOwned, oldManaged, preambleExclude: preambleExclude(claudeMd),
    ...(hookOpts ? { hookOpts } : {}),
  });
  const { owned, stats, memStatus, nbStatus, managed } = rendered;

  phaseLog('PRUNE');
  pruneOwned(cfgDir, oldOwned, owned);

  phaseLog('MANIFEST');
  writeManifestAtomic(manifestPath, {
    _comment: "Files owned by Geneseed's Claude emit. Do not edit; removed on "
      + 're-emit. The memory and notebook stores are NOT listed — never '
      + 'deleted. `managed` records the CLAUDE.md block + settings.json '
      + 'hooks so uninstall removes exactly those.',
    owned: [...owned].sort(),
    managed,
    scope,
  });

  // VERIFY — re-read the settings file just written and match it against the claims just
  // recorded, so a merge that silently did not stick (a commented file, a mid-flight
  // external edit, a bug in the merge) is loud now instead of surfacing as hooks that
  // quietly never fire. Skipped for Copilot, which writes no settings file at all
  // (`_emit_claude_core:827`) — the other half of why Copilot could cross first.
  //
  // On the Python driver this stage runs in Python AFTER a Node child did the wiring, which
  // makes it a live cross-implementation check on every build. Here both halves are Node, so
  // that particular property is gone and only the self-check remains — worth stating,
  // because it is a real reduction in what a Claude emit proves about itself, and the thing
  // that replaces it is the acceptance matrix rather than anything at runtime.
  //
  // SILENT ON SUCCESS, which is its own coverage hazard: a clean emit prints nothing, so
  // deleting this call is byte-identical in all 259 cells. `test_verify_reports_an_orphaned
  // _geneseed_hook` plants the fault that makes it speak.
  if (!isCopilot) {
    phaseLog('VERIFY');
    settingsIntegrityCheck(
      path.join(cfgDir, managed.settings_file || 'settings.json'), managed, 'present');
  }
  return {
    nAgents: stats.nAgents,
    nSkills: stats.nSkills,
    nHooks: (managed.settings_hooks || []).length,
    memStatus,
    nbStatus,
  };
}

/** `_build_global.emit_copilot` — per-repo: AGENTS.md at the repo root + a `.github/` layer. */
function emitCopilot(cfg, args, out) {
  const root = args.root ? resolveOut(args.root) : out;
  const cfgDir = path.join(root, '.github');
  const r = emitClaudeCore(cfg, args, {
    cfgDir, claudeMd: path.join(root, 'AGENTS.md'), scope: 'project', host: 'copilot', out,
  });
  process.stdout.write(`[geneseed] copilot (folder) -> ${root}: AGENTS.md + .github/ `
    + `(${r.nAgents} agents (.agent.md), ${r.nSkills} skills), ${r.memStatus}, `
    + `${r.nbStatus}. No settings.json/hooks (Copilot has none).\n`);
  return cfgDir;
}

/** `_build_global.emit_copilot_global` — into Copilot's personal config dir (~/.copilot). */
function emitCopilotGlobal(cfg, args, out) {
  const cfgDir = args.cfgDir ?? copilotConfigDir();
  warnCopilotGlobalOverProject();
  const r = emitClaudeCore(cfg, args, {
    cfgDir, claudeMd: path.join(cfgDir, 'copilot-instructions.md'),
    scope: 'global', host: 'copilot', out,
  });
  process.stdout.write(`[geneseed] copilot-global -> ${cfgDir}: ${r.nAgents} agents (.agent.md), `
    + `${r.nSkills} skills, copilot-instructions.md, ${r.memStatus}, ${r.nbStatus}. `
    + 'No settings.json/hooks (Copilot has no hook mechanism — memory rides the '
    + "preamble's instructions); MCP servers go in mcp-config.json.\n");
  return cfgDir;
}

/**
 * `_build_global.emit_claude_global` — into Claude Code's global config dir (~/.claude).
 *
 * `hookRunnerEntry()` is still called BEFORE the engine, though it can no longer refuse:
 * the shape stayed after P5b deleted the refusal so that a future value which CAN fail is
 * decided while nothing has been written, rather than behind a half-rendered config dir.
 */
function emitClaudeGlobal(cfg, args, out) {
  const cfgDir = args.cfgDir ?? claudeConfigDir();
  const hookOpts = hookRunnerEntry();
  const r = emitClaudeCore(cfg, args, {
    cfgDir, claudeMd: path.join(cfgDir, 'CLAUDE.md'), scope: 'global', host: 'claude', out,
    hookOpts,
  });
  // "Hooks call the harness by absolute path", not `harness.py` — and this one was already
  // WRONG on this side rather than merely about to be: P5b made this driver bake `<node>
  // bin/geneseed-hook.mjs` into the hooks it writes, so the sentence named a file its own
  // emit does not use. The two drivers bake different entries and printed the same claim;
  // the neutral wording is true of both, and stays true when only one is left. It is frozen
  // in the `claude-global` cells' recorded stdout, which is why it moves here rather than in
  // the deletion phase, which may not move a recorded byte.
  process.stdout.write(`[geneseed] claude-global -> ${cfgDir}: ${r.nAgents} subagents, `
    + `${r.nSkills} skills, CLAUDE.md, ${r.nHooks} hook group(s), settings.json, `
    + `${r.memStatus}, ${r.nbStatus}. No plugins/workflows/themes (no Claude analogue); `
    + '~/.claude/plugins is never touched. Hooks call the harness by absolute path; set '
    + 'GENESEED_HARNESS only to relocate memory.\n');
  return cfgDir;
}

/** `_build_global.emit_claude` — per-repo: CLAUDE.md at the root + a `.claude/` layer. */
function emitClaude(cfg, args, out) {
  const root = args.root ? resolveOut(args.root) : out;
  const hookOpts = hookRunnerEntry();
  const r = emitClaudeCore(cfg, args, {
    cfgDir: path.join(root, '.claude'), claudeMd: path.join(root, 'CLAUDE.md'),
    scope: 'project', host: 'claude', out, hookOpts,
  });
  process.stdout.write(`[geneseed] claude (folder) -> ${root}: CLAUDE.md + .claude/ `
    + `(${r.nAgents} subagents, ${r.nSkills} skills, ${r.nHooks} hook group(s), `
    + `settings.json), ${r.memStatus}, ${r.nbStatus}.\n`);
}

/**
 * `_build_global.emit_bob_global` — into Bob's global config dir (~/.bob).
 *
 * The warning fires BEFORE the emit, matching the Python order: it is about a state this
 * emit is at the point of creating, so printing it afterwards would describe the situation
 * as though the operator had already chosen it.
 */
function emitBobGlobal(cfg, args, out) {
  const cfgDir = args.cfgDir ?? bobConfigDir();
  const hookOpts = hookRunnerEntry();
  warnBobGlobalOverProject();
  const r = emitClaudeCore(cfg, args, {
    cfgDir, claudeMd: path.join(cfgDir, 'AGENTS.md'), scope: 'global', host: 'bob', out,
    hookOpts,
  });
  process.stdout.write(`[geneseed] bob-global -> ${cfgDir}: ${r.nAgents} subagents, `
    + `${r.nSkills} skills, rules/geneseed.md (Bob's always-injected channel; a global `
    + 'AGENTS.md is not auto-loaded, so none is written), '
    + `${r.nHooks} hook group(s), settings.json, ${r.memStatus}, ${r.nbStatus}.\n`);
  return cfgDir;
}

/** `_build_global.emit_bob` — per-repo: AGENTS.md at the root + a `.bob/` layer. */
function emitBob(cfg, args, out) {
  const root = args.root ? resolveOut(args.root) : out;
  const hookOpts = hookRunnerEntry();
  const r = emitClaudeCore(cfg, args, {
    cfgDir: path.join(root, '.bob'), claudeMd: path.join(root, 'AGENTS.md'),
    scope: 'project', host: 'bob', out, hookOpts,
  });
  process.stdout.write(`[geneseed] bob (folder) -> ${root}: AGENTS.md + .bob/ `
    + `(${r.nAgents} subagents, ${r.nSkills} skills, rules/geneseed.md shadow stub, `
    + `${r.nHooks} hook group(s), settings.json), ${r.memStatus}, ${r.nbStatus}.\n`);
}

/**
 * build.py:437-466 — the POST stage, which writes markers and records the install and
 * wires NOTHING. `test_the_post_emit_stage_wires_nothing` classifies that stage on the
 * Python side; this is the same stage on this side, and it stays after the dispatch for
 * the same reason.
 *
 * `writeText`, never `writeFileSync`: Python's `Path.write_text` opens in text mode with
 * `newline=None` and translates the trailing `\n` to CRLF on Windows. A marker written
 * with a bare LF differs from Python's in every cell on this platform.
 */
function writeMarkers(markerDir, emit, footprint) {
  try {
    mkdirSync(markerDir, { recursive: true });
    writeText(path.join(markerDir, '.geneseed-emit'), `${emit}\n`);
    // Written for EVERY emit (build.py:443, unconditional), unlike the theme marker:
    // the claude/bob/copilot PROJECT installs never call build(), so this is their only
    // footprint record. Read by harness._footprint_of_dir, which defaults to 'full'.
    writeText(path.join(markerDir, '.geneseed-footprint'), `${footprint}\n`);
  } catch { /* best-effort, exactly as build.py:444-445 — a marker hiccup never fails a build */ }
}

/**
 * `_build_global.HOSTS[host]['emit_global']` — the one column a CALLER outside the dispatch
 * needs, and the reason it is a named export rather than a fifth branch in `main`.
 *
 * `harness diff` renders an 'expected' copy of a deployed install into a temp dir and
 * compares it file by file. The Python spells that `HOSTS[host]["emit_global"](theme,
 * out=..., cfg=<tmp>, footprint=...)`, where `cfg` overrides the target the emit would
 * otherwise resolve. This is that call, and the override is threaded as `args.cfgDir` through
 * the four `emit*Global` bodies rather than added to `parseArgs`: `build.py` has no
 * `--cfg-dir` flag, and a flag on one driver and not the other is a divergence
 * `tests/golden.py` compares 259 times and could never see, because it drives both from the
 * same argv.
 *
 * WHICH SIDE OF THE BOUNDARY THIS SITS ON. P3c's rule was that a render CHILD must never
 * resolve a config dir, because a child that did would write 135 files into the developer's
 * real `~/.config/opencode`; P4a inverted it for the driver, which is the parent and must
 * ORIGINATE what the child may not resolve. `diff` is a third position: it is a parent that
 * needs the target to be somewhere other than where the resolver would put it, so it sends
 * the value and the resolver is skipped entirely. An emit whose `cfgDir` came from anywhere
 * but this argument would overwrite the live install `diff` is only reading.
 */
const GLOBAL_EMITS = {
  opencode: emitOpencodeGlobal,
  claude: emitClaudeGlobal,
  bob: emitBobGlobal,
  copilot: emitCopilotGlobal,
};

/**
 * The PER-REPO half of the same idea, and `doctor` is its only caller.
 *
 * `_claude_bob_emit_problems` renders `emit_claude`, `emit_bob` and `emit_copilot` into
 * throwaway sandboxes and scans each — the three emits that write CLAUDE.md/AGENTS.md
 * straight into a repo, and the ones outside doctor's sweep when the skill-table dead links
 * shipped.
 *
 * IT CALLS THE EMIT, NOT `main`, AND THAT IS THE WHOLE POINT OF THE EXPORT. Routing this
 * through `driverMain(['--emit', 'claude', …])` would look like less code and would run two
 * stages the Python's direct call never reaches: `writeMarkers` drops `.geneseed-emit` and
 * `.geneseed-footprint` into the sandbox, and `registryRecord` writes a row into the USER'S
 * install registry for a temp directory that is deleted a millisecond later. A validation
 * pass must not register an install.
 *
 * `footprint: 'full'` is the Python signature default that `_claude_bob_emit_problems`'s
 * three-positional call leaves in place, inherited here rather than re-decided.
 */
const PROJECT_EMITS = {
  claude: emitClaude, bob: emitBob, copilot: emitCopilot,
  // P2. `opencode` joins the three for `cmdValidate`, which has to be able to render EVERY
  // `--emit` choice into its sandbox and not only the three doctor already scans. Its call
  // shape is `emitClaude`'s exactly — `(cfg, args, out)` — so the row is the whole change.
  opencode: emitOpencode,
};

export function emitProjectInto(host, { theme, out, root, footprint = 'full', doctrines = null }) {
  const emit = PROJECT_EMITS[host];
  // `doctrines` rides the same rail posture and mode ride into `emitGlobalInto`, and for the
  // same reason: a drift reader that renders `expected` at the DEFAULT pack set reports the
  // whole doctrines section as edited on every narrowed install. `null` means "no opinion" and
  // `makeCfg` renders all four, which is what every validation caller wants.
  return withPyNewlines(() => emit(makeCfg(doctrines ? { doctrines } : {}),
    { theme, footprint, root }, out));
}

/**
 * The ninth `--emit` choice — a plain `files` bundle — for the same caller and the same
 * reason: `_validate_only`'s `else` branch is `build(args.theme, sandbox, args.footprint)`,
 * a DIRECT call that reaches neither `writeMarkers` nor `registryRecord`.
 *
 * `nativeCatalog: false` is that three-positional call's signature default, inherited here
 * exactly as `run` inherits it below.
 */
export function buildInto({ theme, out, footprint = 'lean' }) {
  return withPyNewlines(
    () => build(makeCfg(), theme, out, { footprint, nativeCatalog: false }),
  );
}

export function emitGlobalInto(host, {
  theme, out, cfgDir, footprint, posture = null, mode = null, doctrines = null,
}) {
  // `build.HOSTS.get(host, build.HOSTS["opencode"])` — an unknown host falls back rather than
  // raising, because the host comes from a marker file a user can edit.
  const emit = GLOBAL_EMITS[host] ?? GLOBAL_EMITS.opencode;
  // The same funnel `main` installs, for the same reason and not because `diff` asked: this
  // runs the whole render tree, whose ~25 print sites write raw `\n`. `diff` swallows the
  // emit's STDOUT and lets its stderr through (the Python's `redirect_stdout` does exactly
  // that), so an untranslated WARN from `warnBobGlobalOverProject` would reach the user's
  // terminal with the wrong bytes on the one stream the caller deliberately does not hide.
  // POSTURE AND MODE TRAVEL WITH THE RENDER, and the `|| default` is load-bearing:
  // `postureOfDir` returns null for "no install / undetectable", which `makeCfg`'s parameter
  // default would NOT catch. Callers that pass nothing keep the reference's behaviour of
  // rendering at `peer`/`direct`; the drift readers pass what the deployment actually says,
  // because rendering `expected` at the defaults reports AGENT.md as edited on every install
  // that chose a register — the same scar the footprint left in `diffCollect`, one axis over.
  return withPyNewlines(
    () => emit(
      // THE PACK SELECTION RIDES THE SAME RAIL, with one difference: `doctrinesOfDir` answers
      // `null` for "no marker / undetectable", and that must render at ALL packs rather than
      // at `[]`, so the key is OMITTED instead of passed through — `makeCfg`'s own default is
      // the fail-closed answer and an explicit `doctrines: null` would not reach it.
      makeCfg({
        posture: posture || 'peer', mode: mode || 'direct', ...(doctrines ? { doctrines } : {}),
      }),
      { theme, footprint, root: null, cfgDir }, out,
    ),
  );
}

/**
 * EXPORTED because `harness build` is a passthrough to this program.
 *
 * `_harness_build.cmd_build` is `run([sys.executable, BUILD, *extra]).returncode` — Python
 * needs a second process because `build.py` is a different PROGRAM. Here it is a module in
 * the same one, and `bin/geneseed-cli.mjs` is under a transitive `child_process` ban, so
 * `js/generate.mjs` calls this directly. The export is what makes the auto-run below need a
 * guard: without one, importing this file to reach `main` would RUN the generator with the
 * CLI's argv.
 */
export function main(argv) {
  // `withPyNewlines` is what makes this driver's bytes Python's bytes on Windows, for every
  // print site in the whole render tree at once — see its docblock for why a funnel and not
  // 25 calls to `pyPrint`. It wraps the `catch` as well as `run`, because `die` writes its
  // line on the way out.
  return withPyNewlines(() => {
    try {
      return run(argv);
    } catch (e) {
      // Every DELIBERATE refusal becomes this process's exit code — `die`'s, and equally
      // `assertSourceComplete`'s and `effectiveTheme`'s, which have already explained
      // themselves on stderr. An unmarked throw is a crash and keeps its stack, because
      // Python prints a traceback for one and dressing it as a tidy refusal would hide a bug.
      if (e && e.exitCode !== undefined) return e.exitCode;
      throw e;
    }
  });
}

function run(argv) {
  const args = parseArgs(argv, configDefaults());

  // P2 crossed both of the flags this branch used to refuse, and they landed in two
  // different places because the transitive `child_process` ban splits them.
  //
  // `--sync-themes` is HERE, because it needs nothing this driver may not have: it reads
  // `themes/`, rewrites the files textually, and prints. `js/themes.mjs` carries it.
  // Non-zero when files were CHANGED (0 == already in sync), so CI can run it as a drift
  // check — build.py:393-397's mapping, and a refusal (exit 2) if the template is unreadable.
  if (args.syncThemes) return syncThemes() ? 1 : 0;
  // `--validate-only` is NOT, and cannot be: its source-tree half is the doctor, and
  // `js/doctor.mjs` starts a process (`node --check` over the OpenCode plugins). This driver
  // is under a transitive ban on reaching any such module, gated twice — by a source grep in
  // `tests/test_node_cli_parity.py` and by an import walk in `tests/test_hook_cli_parity.py`.
  // So the tool crossed onto the CLI binary, which already carries the doctor, and this flag
  // points at it rather than silently building for real into the caller's `--out`.
  if (args.validateOnly) {
    die(2, '--validate-only lives on the CLI entry point, because it runs the doctor and '
      + 'this generator may not start a process. Run: geneseed validate '
      + '[--theme T] [--emit E] [--out O] [--root R] [--footprint F] [-v]');
  }

  // Every `--emit` choice has crossed as of P4e, so this branch is now unreachable — and it
  // stays, because it is the partition `test_the_node_driver_classifies_every_emit` asserts:
  // a tenth emit added to `EMITS` and not to `PORTED` refuses loudly here instead of falling
  // through the dispatch's `else` and silently building a plain bundle.
  if (!PORTED.has(args.emit)) {
    // The `Run: …` tail naming the Python driver is gone. It named the fallback for an emit
    // this driver could not do, and there is no longer a second driver to fall back TO — the
    // partition is now "known" vs "not a thing", and only the refusal is left to say so.
    die(3, `--emit ${args.emit} is not one this driver builds (only `
      + `${[...PORTED].join(', ')} are).`);
  }

  const out = resolveOut(args.out);
  const cfg = makeCfg(args);

  // The marker directory is the emit's TARGET, which for a global emit is the config dir it
  // just rendered into and not `--out` at all — so the emit returns it rather than the
  // caller guessing (build.py:427-436 re-resolves; returning it keeps one resolution).
  let markerDir = out;
  if (args.emit === 'opencode') {
    emitOpencode(cfg, args, out);
  } else if (args.emit === 'opencode-global') {
    markerDir = emitOpencodeGlobal(cfg, args, out);
  } else if (args.emit === 'copilot') {
    // The PROJECT emits keep their markers in `out`, not in the host config dir the emit
    // wrote to (build.py:435-436) — `.github/` is the layer, `out` is the install.
    emitCopilot(cfg, args, out);
  } else if (args.emit === 'copilot-global') {
    markerDir = emitCopilotGlobal(cfg, args, out);
  } else if (args.emit === 'claude') {
    emitClaude(cfg, args, out);
  } else if (args.emit === 'claude-global') {
    markerDir = emitClaudeGlobal(cfg, args, out);
  } else if (args.emit === 'bob') {
    emitBob(cfg, args, out);
  } else if (args.emit === 'bob-global') {
    markerDir = emitBobGlobal(cfg, args, out);
  } else {
    // `nativeCatalog: false` is build.py:421's three-positional-argument call reproduced:
    // `build(args.theme, out, args.footprint)` leaves `native_catalog` at its signature
    // default. It is the one signature default this driver DOES inherit, and it is
    // inherited because the Python CLI inherits it too.
    build(cfg, args.theme, out, { footprint: args.footprint, nativeCatalog: false });
  }

  writeMarkers(markerDir, args.emit, args.footprint);
  // build() drops a .geneseed-theme in `out` for the emits that call it; the global emits
  // render into the config dir WITHOUT calling build(), so the theme is recorded here.
  // Deliberately not written for the claude/bob/copilot PROJECT emits — they carry none,
  // and `_harness_setup._installed_defaults` detects those by an AGENT.md sigil scan
  // instead. Writing one for them would change the emitted tree.
  if (args.emit.endsWith('-global')) {
    try {
      writeText(path.join(markerDir, '.geneseed-theme'), `${args.theme}\n`);
    } catch { /* best-effort, as build.py:449-452 */ }
  }
  // An ALLOW-LIST, not "everything that is not global": a plain `--emit files` dev build —
  // the default — must never pollute the registry, and only the four per-repo host emits
  // are ones `_EMIT_HOST_SCOPE` can map back to a row. Records `out`, where the marker is.
  if (['opencode', 'claude', 'bob', 'copilot'].includes(args.emit)) registryRecord(markerDir);
  return 0;
}

/**
 * Run only when this file IS the entry point, not when `js/generate.mjs` imports it.
 *
 * `import.meta.main` would say this in one word and is Node 24; the spec's `engines` floor
 * is still open and this machine runs v22, the same reason `js/emit.mjs` avoids it. So the
 * check is the manual one, through `realpathSync` because `process.argv[1]` is whatever the
 * caller typed and `import.meta.url` is always the resolved file — an `npx`-generated shim
 * or a `geneseed link` symlink makes those differ as strings while naming the same file.
 *
 * BOTH ways of getting this wrong are gated, which is why it is a guard and not a comment,
 * and both were measured rather than argued:
 *
 *   * stuck FALSE — `node bin/geneseed.mjs` becomes a silent no-op: 259 golden cells.
 *   * stuck TRUE — importing this file runs the generator on the IMPORTER's argv, so it is
 *     not only `build` that breaks. `bin/geneseed-cli.mjs` reaches `js/generate.mjs` at
 *     module load, so every CLI verb dies in the driver's flag parser: **62 of the 166
 *     acceptance cells**, `exclude` and `status` and `version` among them.
 */
const entry = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
})();

if (entry) process.exitCode = main(process.argv.slice(2));
