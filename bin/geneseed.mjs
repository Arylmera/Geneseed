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
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  build, emitOpencodeRender, emitOpencodeGlobalRender, emitClaudeRender,
} from '../js/emit.mjs';
import { writeText, parseJson, jsonDumpsIndent } from '../js/lib/pyfs.mjs';

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
 * An emit that is NOT here refuses with exit 3 rather than silently producing a partial
 * tree, and `tests/golden.py --emits` narrows the acceptance matrix to this set — deleting
 * that flag is how the phase ends.
 *
 * The four still missing are `claude`, `claude-global`, `bob` and `bob-global`, and they
 * are missing for one shared reason rather than for want of typing. All four write
 * `settings.json` hooks, so they reach `hookPrefix`, which needs the two machine-absolute
 * values `_build_settings._hook_runner_entry()` returns: `sys.executable` and the harness
 * entry point. **A Node driver has no `sys.executable`** — the hooks it would be wiring are
 * Python, and `process.execPath` is node. That is the one place the port's "no Python
 * needed" promise meets the fact that the runtime it wires has not crossed, and it is a
 * decision rather than a translation. The two Copilot emits ride the same shared engine and
 * do NOT reach it (`js/emit.mjs:1166` gates the whole settings path behind `!isCopilot`),
 * which is exactly why they could cross first and isolate that question.
 */
const PORTED = new Set(['files', 'opencode', 'opencode-global', 'copilot', 'copilot-global']);

/** `_build_global.GLOBAL_MANIFEST`. */
const GLOBAL_MANIFEST = '.geneseed-manifest.json';
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
 * `Path.expanduser()` — a LEADING `~` only, and `~` alone counts.
 *
 * Deliberately not a general tilde expansion: Python does not expand `~user` on Windows the
 * way a shell would, and every caller here feeds it a config-dir env var.
 */
function expanduser(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
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
function pyResolve(p) {
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
 * `_build_core._opencode_config_dir` — and the four resolvers like it are the reason this
 * driver exists rather than a child doing the work.
 *
 * P3c's rule was "the child must never resolve this": a render child that did would write
 * 135 files into the developer's real `~/.config/opencode`. This file is the PARENT, so the
 * rule inverts — resolving it here is exactly the job. Precedence is the env var (which
 * relocates the whole dir), then `$XDG_CONFIG_HOME/opencode`, then `~/.config/opencode`.
 */
function opencodeConfigDir() {
  const env = process.env.OPENCODE_CONFIG_DIR;
  if (env) return pyResolve(env);
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? expanduser(xdg) : path.join(os.homedir(), '.config');
  return pyResolve(path.join(base, 'opencode'));
}

/**
 * `_build_core._copilot_config_dir` — `~/.copilot`, relocatable via `$COPILOT_CONFIG_DIR`.
 *
 * Geneseed's own knob, mirroring `$BOB_CONFIG_DIR`: Copilot documents no such variable, but
 * tests, doctor and locked-down setups still need to re-point the target. Like every
 * relocation variable it is CLEARED by `golden.cell_env`, so no cell can observe whether
 * this driver honours it — see `test_the_relocation_var_moves_the_global_target`.
 */
function copilotConfigDir() {
  const env = process.env.COPILOT_CONFIG_DIR;
  if (env) return pyResolve(env);
  return pyResolve(path.join(os.homedir(), '.copilot'));
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

/**
 * `_install_registry.record` — idempotent, best-effort, and it must NEVER raise into a build.
 *
 * `realpathSync` rather than `path.resolve`, because Python's `Path.resolve()` returns the
 * filesystem's own casing and follows links; `path.resolve` only makes a path absolute. The
 * registry is compared byte-for-byte by `tests/golden.py` (XDG is redirected into the
 * sandbox), so a differently-cased entry is a failing cell.
 */
function registryPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'geneseed', 'installs.json');
}

function registryLoad() {
  try {
    const data = parseJson(readFileSync(registryPath(), 'utf8'));
    return Array.isArray(data) ? data.map(String) : [];
  } catch { return []; }
}

function registrySave(items) {
  try {
    const file = registryPath();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    // `jsonDumpsIndent` for the same reason as the manifest: these are absolute paths, and
    // a machine whose username carries an accent writes one here.
    writeText(tmp, `${jsonDumpsIndent(items)}\n`);
    renameSync(tmp, file);
  } catch { /* best-effort: a registry hiccup must never break a deploy */ }
}

function registryRecord(dir) {
  try {
    let root;
    try { root = realpathSync.native(dir); } catch { root = path.resolve(dir); }
    const cur = registryLoad();
    if (!cur.includes(root)) registrySave([...cur, root]);
  } catch { /* a registry hiccup must never fail a build */ }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/**
 * `_install_registry.roots()` — live registered deploy roots, pruning the file as it reads.
 *
 * The prune is a WRITE, and reproducing it matters: `installs.json` is compared byte-for-byte,
 * so a read that failed to drop a dead row would leave the two implementations holding
 * different registries. The snapshot is taken once on purpose (its own comment says why):
 * comparing `kept` against a SECOND read could clobber a root a concurrent `record()`
 * appended between the two.
 */
function registryRoots() {
  const original = registryLoad();
  const out = [];
  const kept = [];
  const seen = new Set();
  for (const s of original) {
    const root = expanduser(s);
    let key;
    try { key = existsSync(root) ? realpathSync.native(root) : root; } catch { key = root; }
    if (seen.has(key)) continue;
    if (isDir(root) && isFile(path.join(root, '.geneseed-emit'))) {
      seen.add(key);
      kept.push(root);
      out.push(root);
    }
  }
  if (kept.length !== original.length || kept.some((v, i) => v !== original[i])) {
    registrySave(kept);
  }
  return out;
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
    process.stderr.write(`  - ${root}  ->  harness uninstall --target "${root}"\n`);
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

  pruneOwned(oc, oldOwned, owned);

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
  const cfgDir = opencodeConfigDir();
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

  pruneOwned(cfgDir, oldOwned, owned);

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
 * `hookOpts` is consequently OMITTED rather than passed as `{}` or `null`. If a future
 * change ever routed a Copilot emit into the hook path, `hookPrefix()` would receive
 * `undefined`, hit its own default and throw the error it was built to throw — where `null`
 * would raise an unrelated TypeError and `{}` would bake the literal string `"undefined"`
 * into the shim and silently kill every hook in the install. Fail loud, on purpose.
 */
function emitClaudeCore(cfg, args, { cfgDir, claudeMd, scope, host, out }) {
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
  // Copilot carrier filename (copilot-instructions.md, AGENTS.md) resolves to one.
  const rendered = emitClaudeRender(cfg, {
    theme: args.theme, cfgDir, claudeMd, scope, host,
    out: out === null ? null : out,
    footprint: args.footprint, nativeCatalog: NATIVE_CATALOG[host] ?? false,
    oldOwned, oldManaged, preambleExclude: null,
  });
  const { owned, stats, memStatus, nbStatus, managed } = rendered;

  pruneOwned(cfgDir, oldOwned, owned);

  writeManifestAtomic(manifestPath, {
    _comment: "Files owned by Geneseed's Claude emit. Do not edit; removed on "
      + 're-emit. The memory and notebook stores are NOT listed — never '
      + 'deleted. `managed` records the CLAUDE.md block + settings.json '
      + 'hooks so uninstall removes exactly those.',
    owned: [...owned].sort(),
    managed,
    scope,
  });

  // VERIFY — Python re-reads the settings file and matches it against the recorded claims.
  // Skipped for Copilot, which writes no settings file (`_emit_claude_core:827`), which is
  // the other half of why Copilot is the pair that could cross first.
  if (!isCopilot) {
    throw new Error('the VERIFY stage has not crossed to the Node driver: '
      + `--emit for host '${host}' must stay on python build.py`);
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
  const cfgDir = copilotConfigDir();
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

process.exitCode = main(process.argv.slice(2));
