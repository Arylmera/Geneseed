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
import {
  build, emitOpencodeRender, emitOpencodeGlobalRender, emitClaudeRender,
} from '../js/emit.mjs';
import { settingsIntegrityCheck } from '../js/settings.mjs';
import { writeText, parseJson, jsonDumpsIndent } from '../js/lib/pyfs.mjs';
// P5c moved these out of this file: `bin/geneseed-cli.mjs` needs the same four resolvers to
// find a global install, and a resolver that decides WHERE a driver writes is the last thing
// that should exist twice. golden.py's 259 cells are what made the move safe to attempt.
import {
  GLOBAL_MANIFEST, expanduser, pyResolve, opencodeConfigDir, claudeConfigDir, bobConfigDir,
  copilotConfigDir,
} from '../js/hosts.mjs';

// P5d moved these out of this file for the reason P5c moved the host resolvers: `harness
// status` renders to count, so `bin/geneseed-cli.mjs` needs the same checkout paths and the
// same cfg. golden.py's 259 cells all build one, which is what made the move safe.
import { ROOT, SRC, CONFIG, THEMES, makeCfg } from '../js/checkout.mjs';

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
 * installs `python build.py` wrote, and the reverse.
 *
 * That is correct exactly while the two entry points answer the same verbs the same way, so
 * the gate that used to be a formality is now load-bearing:
 * `test_the_entry_carries_exactly_the_verbs_the_emitter_wires` reads the emitter's wiring
 * and `bin/geneseed-hook.mjs`'s VERBS table and requires them EQUAL — a wired verb the entry
 * lacks is a dead hook on every install on the machine, not just this one. The alternative
 * considered and rejected was a per-driver shim path: the path is baked into every already
 * emitted hook command, so changing it makes every existing install's hooks stale until
 * re-emit, which is P10's migration arriving five phases early.
 */
function hookRunnerEntry() {
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
    process.stderr.write(`  - ${root}  ->  harness uninstall --target "${root}"\n`);
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
 * `_build_global.emit_claude_global` — into Claude Code's global config dir (~/.claude).
 *
 * `hookRunnerEntry()` is still called BEFORE the engine, though it can no longer refuse:
 * the shape stayed after P5b deleted the refusal so that a future value which CAN fail is
 * decided while nothing has been written, rather than behind a half-rendered config dir.
 */
function emitClaudeGlobal(cfg, args, out) {
  const cfgDir = claudeConfigDir();
  const hookOpts = hookRunnerEntry();
  const r = emitClaudeCore(cfg, args, {
    cfgDir, claudeMd: path.join(cfgDir, 'CLAUDE.md'), scope: 'global', host: 'claude', out,
    hookOpts,
  });
  process.stdout.write(`[geneseed] claude-global -> ${cfgDir}: ${r.nAgents} subagents, `
    + `${r.nSkills} skills, CLAUDE.md, ${r.nHooks} hook group(s), settings.json, `
    + `${r.memStatus}, ${r.nbStatus}. No plugins/workflows/themes (no Claude analogue); `
    + '~/.claude/plugins is never touched. Hooks call harness.py by absolute path; set '
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
  const cfgDir = bobConfigDir();
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

  // Every `--emit` choice has crossed as of P4e, so this branch is now unreachable — and it
  // stays, because it is the partition `test_the_node_driver_classifies_every_emit` asserts:
  // a tenth emit added to `EMITS` and not to `PORTED` refuses loudly here instead of falling
  // through the dispatch's `else` and silently building a plain bundle.
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

process.exitCode = main(process.argv.slice(2));
