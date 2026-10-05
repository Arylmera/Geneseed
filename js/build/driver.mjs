/**
 * The generator driver — the nine emit targets and the per-host emit orchestration (flag parsing
 * is `args.mjs`).
 * `bin/build-driver.mjs` (`geneseed-build`) is only its entry; this module is what the CLI verbs
 * (`build`, `setup`, `migrate`, `doctor`, `diff`, `validate`, the web console) import. It lived in
 * `bin/` until 2026-09, which made nine `js/` modules import upward from a binary.
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
 * A KEY IS DELIBERATELY ABSENT FROM `cfg`, and its absence is load-bearing.
 * `js_cfg()` (_build_core.py:199) always sent `structure` and `capabilityLinkRe`, because
 * the Python originals were module-level names that TESTS MUTATE — `_OWNED` membership
 * asked one level out. This driver has no Python module to mutate, so it sends neither;
 * `js/build/render.mjs:215`'s `cfg.structure ?? STRUCTURE` takes its right-hand branch for
 * that reason — a fallback that was dead code until P4, always overridden by the driver
 * that always supplies it. `capabilityLinkRe`'s equivalent fallback in
 * `js/build/emit-common.mjs`'s `stripCapabilityLinks` was P4's other one made live, and the
 * over-engineering cleanup then deleted the override branch outright: nothing had ever
 * supplied one, so there was no longer a `cfg` left to be absent from.
 *
 * THE FOOTPRINT DEFAULT IS THE FLAG'S, NOT THE FUNCTION'S. `--footprint` defaults to
 * `lean` (build.py:354); every `emit_*`/`build` SIGNATURE defaults to `full`. A driver
 * that reproduced the signature default would emit a different harness in every cell while
 * every gate that calls the functions directly stayed green.
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { build, phaseLog } from './bundle.mjs';
import { emitClaudeRender } from './emit-claude.mjs';
import { emitOpencodeRender, emitOpencodeGlobalRender } from './emit-opencode.mjs';
import { settingsIntegrityCheck } from '../hosts/settings.mjs';
import { hookRunnerEntry } from '../hosts/shim.mjs';
import { writeText, withPlatformNewlines, isFile } from '../lib/fs.mjs';
import { parseJson, jsonDumpsIndent } from '../lib/json.mjs';
import { relPosix } from '../lib/text.mjs';
// P5c moved these out of this file: `bin/geneseed-cli.mjs` needs the same four resolvers to
// find a global install, and a resolver that decides WHERE a driver writes is the last thing
// that should exist twice. golden.py's 259 cells are what made the move safe to attempt.
import {
  GLOBAL_MANIFEST, resolvePath, opencodeConfigDir, claudeConfigDir, bobConfigDir,
  openclaudeConfigDir, hostCatalogsNatively,
} from '../hosts/hosts.mjs';

// P5d moved these out of this file for the reason P5c moved the host resolvers: `harness
// status` renders to count, so `bin/geneseed-cli.mjs` needs the same checkout paths and the
// same cfg. golden.py's 259 cells all build one, which is what made the move safe.
import {
  ROOT, makeCfg,
} from './source.mjs';

// P5f moved these, for the same arithmetic a third time: `harness rebuild-all` reads the
// registry to find every install it must re-emit, and a CLI verb may not reach into a driver
// for a reader. See js/inspect/registry.mjs.
import { registryRecord, registryRoots } from '../inspect/registry.mjs';

// P2. `--sync-themes` crossed into its own module rather than into this file: it is 90 lines
// of textual surgery over committed files with a corpus of its own, and it is the half of the
// maintainer pair that needs nothing this driver is banned from having.
import { syncThemes } from './themes.mjs';
import { configDefaults, die, parseArgs } from './args.mjs';

export { parseDriverArgs } from './args.mjs';


/** `_build_emit.PRIMARY_AGENT_SRC`. */
const PRIMARY_AGENT_SRC = path.join(ROOT, 'adapters', 'opencode', 'agents', 'orchestrator.md');

/** `_build_render.resolve_out` — absolute, or relative to the CURRENT WORKING DIRECTORY
 *  (not to ROOT), so the harness renders straight into any repository.
 *
 *  EXPORTED IN P5i because `js/maintain/setup.mjs` became its second caller: `_setup_summary_lines`
 *  names the AGENT.md a bundle emit just wrote, and it names it by the same resolution the
 *  emit used. Copying the one line would be a second owner of the rule that a bare `Harness`
 *  follows the invocation and not the checkout — which is what
 *  `build/the-bundle-follows-cwd-not-the-checkout` exists to gate.
 *
 *  `resolvePath` AND NOT `path.resolve`, and the difference is the whole reason `resolvePath`
 *  exists: the reference ends in `.resolve()`, which canonicalises — 8.3 short names expanded
 *  on Windows, symlinks followed on POSIX, the filesystem's own casing — where `path.resolve`
 *  only normalises `.`/`..`. Nine `resolvePath` call sites had the rule and this one did not.
 *  It is invisible on a machine whose paths are already canonical, which is every machine
 *  this ran on until GitHub's Windows runner handed it a `C:\\Users\\RUNNER~1\\...` and the
 *  two CLIs printed the same directory under two different names — a 70-byte difference in a
 *  line the former Python suite compared BYTE for byte; `tests/unit/resolve_out.test.mjs` pins
 *  it now. The
 *  argument to `resolvePath` is made absolute first so its `expanduser` cannot fire: the
 *  reference does not expand `~` here, and a bare `~` is a legal directory name. */
export function resolveOut(raw) {
  return resolvePath(path.resolve(process.cwd(), raw));
}

/**
 * `_build_global._preamble_exclude` — the `claudeMdExcludes` entry a PROJECT install writes
 * to suppress the GLOBAL preamble of the same host, or null for a host that gets none.
 *
 * `_PREAMBLE_CONFIG_DIR` has exactly one key, so only a `CLAUDE.md` carrier resolves to a
 * value: Bob's `AGENTS.md` gets null.
 *
 * Computed HERE and not in the render child, and that is the inverted boundary rule doing
 * real work rather than being restated. P3b's note on the Python original: it resolves
 * through `_build_core._claude_config_dir`, an `_OWNED` name precisely because the suite
 * redirects it at a sandbox, and a redirect that stops at a subprocess half-works in
 * silence. The child must therefore never derive it — but this file is the PARENT, so
 * deriving it is exactly this file's job, and `the host emit` receives the answer.
 *
 * POSIX spelling, per the original: `claudeMdExcludes` entries are glob patterns, where a
 * backslash is an escape, so the Windows-native form risks never matching.
 */
function preambleExclude(claudeMd, host) {
  if (path.basename(claudeMd) !== 'CLAUDE.md') return null;
  // OpenClaude inherited `claudeMdExcludes` from Claude Code; its global preamble is its own.
  const globalDir = host === 'openclaude' ? openclaudeConfigDir() : claudeConfigDir();
  return resolvePath(path.join(globalDir, 'CLAUDE.md')).split(path.sep).join('/');
}

/**
 * `_build_global._warn_bob_global_over_project` — informational, never auto-removes.
 *
 * The text hedges on purpose: Bob's workspace rules may or may not shadow the global copy,
 * depending on a precedence nothing can verify at emit time.
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
  const rel = relPosix(root, out);
  if (rel === '' || rel === '.') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return rel;
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
 * The manifest PRE-read all three emit bodies performed inline: does a manifest already
 * exist at `manifestPath`, and if so, what does it parse to. `existed` is what
 * `emitOpencode` alone needs (as `manifestExisted`, threaded into the render job); every
 * caller reads `doc.owned`, and `emitClaudeCore` also reads `doc.managed` — `doc` is `null`
 * on a missing OR a corrupt manifest, so `(doc && doc.owned) || []` covers both the same way
 * the three inline try/catches did.
 */
function readManifest(manifestPath) {
  const existed = existsSync(manifestPath);
  let doc = null;
  if (existed) {
    try { doc = parseJson(readFileSync(manifestPath, 'utf8')); } catch { doc = null; }
  }
  return { existed, doc };
}

/** The "+ primary agent, N command(s)" tail both OpenCode summary lines share. */
function extrasTail(stats) {
  const extras = [...(stats.primary ? ['primary agent'] : []),
    ...(stats.nCommands ? [`${stats.nCommands} command(s)`] : [])];
  return extras.length ? ` + ${extras.join(', ')}` : '';
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
 * `_build_emit.emit_opencode` — the driver body, which is what this phase actually ports.
 *
 * RENDER and WIRE already ran in Node before P4; what lived only in Python was the stage
 * either side of them: reading the previous manifest (PRE), pruning what this layer no
 * longer owns, writing the manifest atomically, and the summary line. All five stages now
 * run in one process, in the order `tests/unit/emit_phase_order.test.mjs` pins:
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
  const { existed: manifestExisted, doc } = readManifest(manifestPath);
  const oldOwned = (doc && doc.owned) || [];

  const agentPathRel = relUnder(out, root);
  const agentPath = agentPathRel ? `${agentPathRel}/AGENT.md` : 'AGENT.md';

  // RENDER + WIRE, one call. `primaryAgentSrc` lives in `_build_emit` and only this job
  // needs it, so the caller adds it rather than `makeCfg` reaching across.
  const rendered = emitOpencodeRender(
    { ...cfg, primaryAgentSrc: PRIMARY_AGENT_SRC },
    {
      theme: args.theme, out, root, footprint: args.footprint,
      nativeCatalog: hostCatalogsNatively('opencode'), oldOwned, manifestExisted, agentPath,
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

  const extra = extrasTail(stats);
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

  const { doc } = readManifest(manifestPath);
  const oldOwned = (doc && doc.owned) || [];

  const agentPath = path.join(cfgDir, 'AGENT.md').split(path.sep).join('/');

  const rendered = emitOpencodeGlobalRender(
    { ...cfg, primaryAgentSrc: PRIMARY_AGENT_SRC },
    {
      theme: args.theme, cfgDir, out,
      footprint: args.footprint, nativeCatalog: hostCatalogsNatively('opencode'),
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

  const extra = extrasTail(stats);
  process.stdout.write(`[geneseed] opencode-global -> ${cfgDir}: ${stats.nAgents} subagents, `
    + `${stats.nSkills} skills, ${stats.nPlugins} plugin(s), `
    + `${stats.nWorkflows} workflow file(s), AGENT.md, ${memStatus}, ${nbStatus}, `
    + `${cfgName} (no context.json)${extra}. `
    + 'The learn plugin now finds <cfg>/memory automatically; set GENESEED_HARNESS only to '
    + 'override.\n');
  return cfgDir;
}

/**
 * `_build_global._emit_claude_core` — the shared engine behind six emits (Claude, Bob and
 * OpenClaude, each per-repo and global).
 *
 * Every caller passes a real `hookOpts` pair from `hookRunnerEntry()`, which cannot fail to
 * produce one — `process.execPath` is the node already running. Were it ever omitted,
 * `hookPrefix()` would receive `undefined`, hit its own default and throw the error it was
 * built to throw — where `null` would raise an unrelated TypeError and `{}` would bake the
 * literal string `"undefined"` into the shim and silently kill every hook in the install.
 */
function emitClaudeCore(cfg, args, { cfgDir, claudeMd, scope, host, out, hookOpts }) {
  const manifestPath = path.join(cfgDir, GLOBAL_MANIFEST);
  const { doc } = readManifest(manifestPath);
  const oldOwned = (doc && doc.owned) || [];
  const oldManaged = (doc && doc.managed && typeof doc.managed === 'object'
    && !Array.isArray(doc.managed)) ? doc.managed : {};

  // RENDER + WIRE in one child's worth of work. `preambleExclude` is null for every
  // carrier but `CLAUDE.md` — `_PREAMBLE_CONFIG_DIR` has exactly one key — so Bob's
  // `AGENTS.md` does not resolve to one. Spelling it as a call rather than a literal is what makes that a
  // measured `null` instead of an assumed one.
  const rendered = emitClaudeRender(cfg, {
    theme: args.theme, cfgDir, claudeMd, scope, host,
    out,
    footprint: args.footprint, nativeCatalog: hostCatalogsNatively(host),
    oldOwned, oldManaged, preambleExclude: preambleExclude(claudeMd, host),
    hookOpts,
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
  // quietly never fire.
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
  phaseLog('VERIFY');
  settingsIntegrityCheck(
    path.join(cfgDir, managed.settings_file || 'settings.json'), managed, 'present');
  return {
    nAgents: stats.nAgents,
    nSkills: stats.nSkills,
    nHooks: (managed.settings_hooks || []).length,
    memStatus,
    nbStatus,
  };
}

/**
 * The six Claude-shaped emits — Claude, Bob and OpenClaude, each per-repo and global — as one
 * body and a table. They differ only in where the config dir is, what the instruction carrier
 * is called and where it sits, and the one summary line each prints; everything else is
 * `emitClaudeCore`.
 *
 * `configDir` set = a GLOBAL emit: the target is `args.cfgDir` (the `--config-dir` / `diff`
 * override) or the host's resolved dir, the carrier lives inside it, and the dir is returned
 * for the caller to record. Unset = PER-REPO: the target is `<root>/<layer>`, and the carrier
 * sits at the root unless `carrierInLayer` says otherwise.
 *
 * `hookRunnerEntry()` is still called BEFORE the engine, though it can no longer refuse: the
 * shape stayed after P5b deleted the refusal so that a future value which CAN fail is decided
 * while nothing has been written, rather than behind a half-rendered config dir. `before` runs
 * after it and before the emit — Bob's global warning is about a state this emit is at the
 * point of creating, so printing it afterwards would describe it as already chosen.
 */
const CLAUDE_SHAPED = {
  'claude-global': {
    host: 'claude', configDir: claudeConfigDir, carrier: 'CLAUDE.md',
    // "Hooks call the harness by absolute path": the hooks bake `<node> bin/geneseed-hook.mjs`.
    summary: (at, r) => `[geneseed] claude-global -> ${at}: ${r.nAgents} subagents, `
      + `${r.nSkills} skills, CLAUDE.md, ${r.nHooks} hook group(s), settings.json, `
      + `${r.memStatus}, ${r.nbStatus}. No plugins/workflows/themes (no Claude analogue); `
      + '~/.claude/plugins is never touched. Hooks call the harness by absolute path; set '
      + 'GENESEED_HARNESS only to relocate memory.\n',
  },
  // Per-repo: CLAUDE.md at the root + a `.claude/` layer.
  claude: {
    host: 'claude', layer: '.claude', carrier: 'CLAUDE.md',
    summary: (at, r) => `[geneseed] claude (folder) -> ${at}: CLAUDE.md + .claude/ `
      + `(${r.nAgents} subagents, ${r.nSkills} skills, ${r.nHooks} hook group(s), `
      + `settings.json), ${r.memStatus}, ${r.nbStatus}.\n`,
  },
  // `~/.openclaude` (or `$OPENCLAUDE_CONFIG_DIR`). OpenClaude is a Claude Code fork that reads
  // neither `~/.claude` nor `CLAUDE_CONFIG_DIR`, so a Claude install is invisible to it.
  'openclaude-global': {
    host: 'openclaude', configDir: openclaudeConfigDir, carrier: 'CLAUDE.md',
    summary: (at, r) => `[geneseed] openclaude-global -> ${at}: ${r.nAgents} subagents, `
      + `${r.nSkills} skills, CLAUDE.md, ${r.nHooks} hook group(s), settings.json, `
      + `${r.memStatus}, ${r.nbStatus}. MCP servers go in .openclaude.json.\n`,
  },
  // Everything under `.openclaude/`, the preamble included. OpenClaude reads the root CLAUDE.md
  // only when the repo has no AGENTS.md, but `.openclaude/CLAUDE.md` always; keeping the root
  // untouched also lets a Claude Code install share the repo.
  openclaude: {
    host: 'openclaude', layer: '.openclaude', carrier: 'CLAUDE.md', carrierInLayer: true,
    summary: (at, r) => `[geneseed] openclaude (folder) -> ${at}: .openclaude/ `
      + `(CLAUDE.md, ${r.nAgents} subagents, ${r.nSkills} skills, ${r.nHooks} hook group(s), `
      + `settings.local.json), ${r.memStatus}, ${r.nbStatus}.\n`,
  },
  'bob-global': {
    host: 'bob', configDir: bobConfigDir, carrier: 'AGENTS.md', before: warnBobGlobalOverProject,
    summary: (at, r) => `[geneseed] bob-global -> ${at}: ${r.nAgents} subagents, `
      + `${r.nSkills} skills, rules/geneseed.md (Bob's always-injected channel; a global `
      + 'AGENTS.md is not auto-loaded, so none is written), '
      + `${r.nHooks} hook group(s), settings.json, ${r.memStatus}, ${r.nbStatus}.\n`,
  },
  // Per-repo: AGENTS.md at the root + a `.bob/` layer.
  bob: {
    host: 'bob', layer: '.bob', carrier: 'AGENTS.md',
    summary: (at, r) => `[geneseed] bob (folder) -> ${at}: AGENTS.md + .bob/ `
      + `(${r.nAgents} subagents, ${r.nSkills} skills, rules/geneseed.md shadow stub, `
      + `${r.nHooks} hook group(s), settings.json), ${r.memStatus}, ${r.nbStatus}.\n`,
  },
};

/** One row of `CLAUDE_SHAPED` as an emit — the `(cfg, args, out)` shape every dispatch takes. */
const claudeShaped = (name) => (cfg, args, out) => {
  const { host, configDir, layer, carrier, carrierInLayer, before, summary } = CLAUDE_SHAPED[name];
  const root = configDir ? null : (args.root ? resolveOut(args.root) : out);
  const cfgDir = configDir ? (args.cfgDir ?? configDir()) : path.join(root, layer);
  const claudeMd = path.join(configDir || carrierInLayer ? cfgDir : root, carrier);
  const hookOpts = hookRunnerEntry();
  before?.();
  const r = emitClaudeCore(cfg, args, {
    cfgDir, claudeMd, scope: configDir ? 'global' : 'project', host, out, hookOpts,
  });
  process.stdout.write(summary(root ?? cfgDir, r));
  return configDir ? cfgDir : undefined;
};

/**
 * build.py:437-466 — the POST stage, which writes markers and records the install and
 * wires NOTHING. `tests/unit/emit_phase_order.test.mjs`'s 'the post-emit marker stage wires
 * nothing' classifies it, and that is why it stays after the dispatch.
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
    // the claude/bob/openclaude PROJECT installs never call build(), so this is their only
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
 * the `emit*Global` bodies. The same key is also `--config-dir` on the command line: a global
 * emit never writes to `--out` (there `out` is the legacy bundle a memory store migrates FROM,
 * and `update` passes it for exactly that), so without the flag there was no way to preview a
 * global install anywhere but over the live one.
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
  claude: claudeShaped('claude-global'),
  bob: claudeShaped('bob-global'),
  openclaude: claudeShaped('openclaude-global'),
};

/**
 * The PER-REPO half of the same idea, and `doctor` is its only caller.
 *
 * `_claude_bob_emit_problems` renders `emit_claude`, `emit_bob` and `emit_openclaude` into
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
  claude: claudeShaped('claude'), bob: claudeShaped('bob'), openclaude: claudeShaped('openclaude'),
  // P2. `opencode` joins the three for `cmdValidate`, which has to be able to render EVERY
  // `--emit` choice into its sandbox and not only the three doctor already scans. Its call
  // shape is the Claude-shaped emits' exactly — `(cfg, args, out)` — so the row is the whole change.
  opencode: emitOpencode,
};

/**
 * The five render axes every `*Into` takes, folded into one `cfg` — the drift readers pass what
 * the deployment says, `validate` passes its flags.
 *
 * EACH IS OMITTED WHEN NULL, never passed through, because `null` is "no opinion" and only
 * `makeCfg`'s own defaults are the fail-closed answers: `peer`/`direct`/the default preset, ALL
 * packs (`doctrinesOfDir` answers `null` for "no marker", which must not render as `[]`), and
 * NO exclusions (a list of rules taken away defaults to taking nothing away). The posture and
 * mode readers return `null` for "undetectable" too, which an explicit `posture: null` would
 * carry straight past the parameter default.
 */
function axesCfg({ posture, mode, trust, doctrines, excludeRules }) {
  return makeCfg({
    ...(posture ? { posture } : {}), ...(mode ? { mode } : {}), ...(trust ? { trust } : {}),
    ...(doctrines ? { doctrines } : {}), ...(excludeRules ? { excludeRules } : {}),
  });
}

export function emitProjectInto(host, {
  theme, out, root, footprint = 'full', posture = null, mode = null, trust = null,
  doctrines = null, excludeRules = null,
}) {
  const emit = PROJECT_EMITS[host];
  // The axes ride the same rail into every `*Into`, and for the same reason: a drift reader
  // that renders `expected` at the DEFAULT pack set reports the whole doctrines section as
  // edited on every narrowed install, and `validate --doctrines craft` that ignored its flag
  // checked an all-packs render nobody asked for.
  return withPlatformNewlines(() => emit(
    axesCfg({ posture, mode, trust, doctrines, excludeRules }), { theme, footprint, root }, out,
  ));
}

/**
 * The ninth `--emit` choice — a plain `files` bundle — for the same caller and the same
 * reason: `_validate_only`'s `else` branch is `build(args.theme, sandbox, args.footprint)`,
 * a DIRECT call that reaches neither `writeMarkers` nor `registryRecord`.
 *
 * `nativeCatalog: false` is that three-positional call's signature default, inherited here
 * exactly as `run` inherits it below.
 */
export function buildInto({
  theme, out, footprint = 'lean', posture = null, mode = null, trust = null, doctrines = null,
  excludeRules = null,
}) {
  return withPlatformNewlines(() => build(axesCfg({ posture, mode, trust, doctrines, excludeRules }),
    theme, out, { footprint, nativeCatalog: false }));
}

export function emitGlobalInto(host, {
  theme, out, cfgDir, footprint, posture = null, mode = null, doctrines = null, trust = null,
  excludeRules = null,
}) {
  // `build.HOSTS.get(host, build.HOSTS["opencode"])` — an unknown host falls back rather than
  // raising, because the host comes from a marker file a user can edit.
  const emit = GLOBAL_EMITS[host] ?? GLOBAL_EMITS.opencode;
  // The same funnel `main` installs, for the same reason and not because `diff` asked: this
  // runs the whole render tree, whose ~25 print sites write raw `\n`. `diff` swallows the
  // emit's STDOUT and lets its stderr through (the Python's `redirect_stdout` does exactly
  // that), so an untranslated WARN from `warnBobGlobalOverProject` would reach the user's
  // terminal with the wrong bytes on the one stream the caller deliberately does not hide.
  // ALL FIVE AXES TRAVEL WITH THE RENDER (see `axesCfg`). Callers that pass nothing keep the
  // reference's behaviour of rendering at `peer`/`direct`; the drift readers pass what the
  // deployment actually says, because rendering `expected` at the defaults reports AGENT.md as
  // edited on every install that chose a register, narrowed its packs or excluded a rule —
  // the same scar the footprint left in `diffCollect`, one axis over each time.
  return withPlatformNewlines(() => emit(
    axesCfg({ posture, mode, trust, doctrines, excludeRules }),
    { theme, footprint, root: null, cfgDir }, out,
  ));
}

/**
 * EXPORTED because `harness build` is a passthrough to this program.
 *
 * `_harness_build.cmd_build` is `run([sys.executable, BUILD, *extra]).returncode` — Python
 * needs a second process because `build.py` is a different PROGRAM. Here it is a module in
 * the same one, and `bin/geneseed-cli.mjs` is under a transitive `child_process` ban, so
 * `js/build/generate.mjs` calls this directly. The export is what makes the auto-run below need a
 * guard: without one, importing this file to reach `main` would RUN the generator with the
 * CLI's argv.
 */
export function main(argv) {
  // `withPlatformNewlines` is what makes this driver's bytes Python's bytes on Windows, for every
  // print site in the whole render tree at once — see its docblock for why a funnel and not
  // 25 calls to `printOut`. It wraps the `catch` as well as `run`, because `die` writes its
  // line on the way out.
  return withPlatformNewlines(() => {
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
  // `themes/`, rewrites the files textually, and prints. `js/build/themes.mjs` carries it.
  // Non-zero when files were CHANGED (0 == already in sync), so CI can run it as a drift
  // check — build.py:393-397's mapping, and a refusal (exit 2) if the template is unreadable.
  if (args.syncThemes) return syncThemes() ? 1 : 0;
  // `--validate-only` is NOT, and cannot be: its source-tree half is the doctor, and
  // `js/inspect/checks-authoring.mjs` starts a process (`node --check` over the OpenCode plugins). This driver
  // is under a transitive ban on reaching any such module, gated by an import walk in
  // `tests/unit/hook_cli.test.mjs` ("the generator driver still reaches no child-process module").
  // So the tool crossed onto the CLI binary, which already carries the doctor, and this flag
  // points at it rather than silently building for real into the caller's `--out`.
  if (args.validateOnly) {
    die(2, '--validate-only lives on the CLI entry point, because it runs the doctor and '
      + 'this generator may not start a process. Run: geneseed validate '
      + '[--theme T] [--emit E] [--out O] [--root R] [--footprint F] [-v]');
  }

  const out = resolveOut(args.out);
  // Refused rather than ignored on a per-repo emit: an ignored target flag is how a preview
  // lands on a live install, which is the bug this flag exists to close.
  if (args.cfgDir !== undefined) {
    if (!args.emit.endsWith('-global')) {
      die(2, `argument --config-dir: only applies to a -global emit (got --emit ${args.emit}); `
        + 'a per-repo emit writes under --out/--root');
    }
    args.cfgDir = resolveOut(args.cfgDir);
  }
  const cfg = makeCfg(args);

  // The marker directory is the emit's TARGET, which for a global emit is the config dir it
  // just rendered into and not `--out` at all — so the emit returns it rather than the
  // caller guessing (build.py:427-436 re-resolves; returning it keeps one resolution).
  //
  // NINE ARMS, TWO TABLES ALREADY ON FILE: `GLOBAL_EMITS` and `PROJECT_EMITS` above are
  // exactly this dispatch's `-global` and per-repo halves, keyed by host rather than by
  // `--emit` name, so splitting the suffix reaches both without a third map.
  let markerDir = out;
  if (args.emit.endsWith('-global')) {
    markerDir = GLOBAL_EMITS[args.emit.slice(0, -'-global'.length)](cfg, args, out);
  } else if (args.emit !== 'files') {
    // The PROJECT emits keep their markers in `out`, not in the host config dir the emit
    // wrote to (build.py:435-436) — `.claude/` is the layer, `out` is the install.
    PROJECT_EMITS[args.emit](cfg, args, out);
  } else {
    // The ninth choice, a plain bundle: `nativeCatalog: false` is build.py:421's
    // three-positional-argument call reproduced — `build(args.theme, out, args.footprint)`
    // leaves `native_catalog` at its signature default. It is the one signature default
    // this driver DOES inherit, and it is inherited because the Python CLI inherits it too.
    build(cfg, args.theme, out, { footprint: args.footprint, nativeCatalog: false });
  }

  writeMarkers(markerDir, args.emit, args.footprint);
  // build() drops a .geneseed-theme in `out` for the emits that call it; the global emits
  // render into the config dir WITHOUT calling build(), so the theme is recorded here.
  // Deliberately not written for the claude/bob/openclaude PROJECT emits — they carry none,
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
  if (['opencode', 'claude', 'bob', 'openclaude'].includes(args.emit)) {
    registryRecord(markerDir);
  }
  return 0;
}
