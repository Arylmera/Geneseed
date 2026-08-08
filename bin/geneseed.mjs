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
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from '../js/emit.mjs';
import { writeText } from '../js/lib/pyfs.mjs';

/** `_build_core.ROOT` — the checkout, from this script's own location (bin/..). */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'src');
const CONFIG = path.join(ROOT, 'harness.config.json');
const THEMES = path.join(ROOT, 'themes');

/** The nine `--emit` choices, in build.py:337-338's order. */
const EMITS = ['files', 'opencode', 'opencode-global', 'claude', 'claude-global',
  'bob', 'bob-global', 'copilot', 'copilot-global'];

/**
 * The emits this driver can run end to end.
 *
 * `files` is the only one whose Python dispatcher hands the WHOLE emit to Node and
 * returns (`_build_render.py:821-825`). The other eight keep PRE (the manifest read),
 * PRUNE, the atomic MANIFEST write and their summary line in the Python driver body —
 * ~460 LOC across four entry points — and cross only RENDER and WIRE. Porting those
 * bodies is the rest of P4, not a hidden branch of this one: an emit that is not here
 * REFUSES rather than silently producing a partial tree.
 */
const PORTED = new Set(['files']);

/** `_build_render.posture_names()` / `mode_names()` — discovered, never hardcoded, so a
 *  new posture file appears in both CLIs' choices with no code change. */
function discoverNames(dir, first) {
  let names = [];
  try {
    names = readdirSync(path.join(SRC, dir))
      .filter((f) => f.endsWith('.md') && path.basename(f, '.md').toLowerCase() !== 'readme')
      .map((f) => path.basename(f, '.md'))
      .sort();
  } catch { /* missing dir — fall through to the single default below */ }
  names.sort((a, b) => (a !== first) - (b !== first) || (a < b ? -1 : a > b ? 1 : 0));
  return names.length ? names : [first];
}

/** `_build_render.resolve_out` — absolute, or relative to the CURRENT WORKING DIRECTORY
 *  (not to ROOT), so the harness renders straight into any repository. */
function resolveOut(raw) {
  return path.resolve(process.cwd(), raw);
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
  const d = { theme: 'neutral', posture: 'peer', mode: 'direct' };
  if (!existsSync(CONFIG)) return d;
  try {
    const data = JSON.parse(readFileSync(CONFIG, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.theme !== undefined) d.theme = data.theme;
      if (data.posture !== undefined) d.posture = data.posture;
      if (data.mode !== undefined) d.mode = data.mode;
    }
  } catch {
    process.stderr.write(`[geneseed] WARN: ${path.basename(CONFIG)} is unreadable — `
      + "using theme 'neutral'.\n");
  }
  return d;
}

/** argparse's `--flag value` and `--flag=value`, plus the `--target` alias for `--out`. */
function parseArgs(argv, defaults) {
  const args = {
    theme: defaults.theme, posture: defaults.posture, mode: defaults.mode,
    out: 'Harness', emit: 'files', footprint: 'lean', root: null,
    syncThemes: false, validateOnly: false, verbose: false,
  };
  const VALUED = {
    '--theme': 'theme', '--posture': 'posture', '--mode': 'mode',
    '--out': 'out', '--target': 'out', '--emit': 'emit',
    '--footprint': 'footprint', '--root': 'root',
  };
  const FLAGS = {
    '--sync-themes': 'syncThemes', '--validate-only': 'validateOnly',
    '-v': 'verbose', '--verbose': 'verbose',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    const eq = tok.indexOf('=');
    const name = eq > 0 ? tok.slice(0, eq) : tok;
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
  choice('--emit', args.emit, EMITS);
  choice('--footprint', args.footprint, ['lean', 'full']);
  choice('--posture', args.posture, discoverNames('postures', 'peer'));
  choice('--mode', args.mode, discoverNames('modes', 'direct'));
  return args;
}

function choice(flag, value, allowed) {
  if (!allowed.includes(value)) {
    die(2, `argument ${flag}: invalid choice: '${value}' `
      + `(choose from ${allowed.map((c) => `'${c}'`).join(', ')})`);
  }
}

function die(code, msg) {
  process.stderr.write(`geneseed: error: ${msg}\n`);
  process.exit(code);
}

/**
 * `_build_core.js_cfg()`, originated rather than received — see the module header for the
 * two keys it deliberately omits.
 */
function makeCfg(args) {
  return {
    root: ROOT,
    src: SRC,
    themes: THEMES,
    config: CONFIG,
    colorThemes: path.join(THEMES, 'opencode'),
    pluginSrc: path.join(ROOT, 'adapters', 'opencode', 'plugins'),
    workflowSrc: path.join(ROOT, 'adapters', 'opencode', 'workflows'),
    posture: args.posture,
    mode: args.mode,
  };
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

function main(argv) {
  const args = parseArgs(argv, configDefaults());

  // Both refuse rather than silently doing something else. See docs/specs' P4 entry:
  // --sync-themes WRITES to themes/*.json in the checkout's own source tree — maintainer
  // tooling like golden.py and the pytest rig, which npx does not ship either. And
  // --validate-only's second half shells to `harness.py doctor`, which itself re-spawns
  // build.py, so porting it here would make a four-deep node -> python -> python -> node
  // chain to reach a check that has no cross-implementation gate in the first place
  // (golden.py's `_argv` never emits either flag).
  if (args.syncThemes) {
    die(2, '--sync-themes is a maintainer tool that rewrites this checkout\'s themes/*.json '
      + 'and is not part of the npx surface. Run: python build.py --sync-themes');
  }
  if (args.validateOnly) {
    die(2, '--validate-only is not ported: its source-tree half runs `harness.py doctor`, '
      + 'which is still Python. Run: python build.py --validate-only');
  }

  if (!PORTED.has(args.emit)) {
    die(3, `--emit ${args.emit} has not crossed to the Node driver yet (only `
      + `${[...PORTED].join(', ')} has). Run: python build.py --emit ${args.emit}`);
  }

  const out = resolveOut(args.out);
  const cfg = makeCfg(args);

  // `nativeCatalog: false` is build.py:421's three-positional-argument call reproduced:
  // `build(args.theme, out, args.footprint)` leaves `native_catalog` at its signature
  // default. It is the one signature default this driver DOES inherit, and it is inherited
  // because the Python CLI inherits it too.
  build(cfg, args.theme, out, { footprint: args.footprint, nativeCatalog: false });

  // `files` is not one of the four per-repo HOST emits, so no install-registry row — the
  // allow-list at build.py:461 exists precisely so a plain `--emit files` dev build never
  // pollutes the registry.
  writeMarkers(out, args.emit, args.footprint);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
