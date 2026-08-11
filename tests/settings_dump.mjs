/**
 * Node's half of the settings-wiring parity gate. Driven by
 * tests/test_settings_parity.py.
 *
 * Each job is a SCENARIO — a scripted sequence of the unit's entry points in the order a
 * real caller runs them — not a single function call. That is deliberate: the defects this
 * unit can have are sequence defects (a migration that unwires the wrong file, a prior
 * claim set that resurrects a stale hook group, a teardown that bails and leaves hooks
 * firing), and a gate that called each function once in isolation would reach none of them.
 * `_run_python` in the test file runs the same seven scripts against the Python.
 *
 * Everything printed here goes to the real streams and the test compares them byte for
 * byte. That matters more in this module than anywhere else in the port: these functions
 * write the hooks whose verdict channel IS stdout.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  autostartPaths, autostartStale, hookPrefix, hookShimBody, hookShimPath, managedBlockRead,
  managedBlockRemove, managedBlockWrite, mergeClaudeSettings, mergeOpencodeJson,
  migrateShape, opencodeTarget, readJsonc,
  settingsIntegrityCheck, shimHome, unwireClaudeExcludes, unwireClaudeSettings,
  wireClaudeExcludes, writeHookShim,
} from '../js/settings.mjs';
import { jsonDumpsIndent, parseJson } from '../js/lib/pyfs.mjs';

const jobs = parseJson(readFileSync(process.argv[2], 'utf8'));

/** Canonical rendering for a value that has to be compared across the two languages. */
const canon = (v) => jsonDumpsIndent(v === undefined ? null : v);

function jsonc(job) {
  return job.corpus.map((text) => {
    const [data, hadComments] = readJsonc(text);
    return { data: canon(data), hadComments };
  });
}

function shim(job) {
  const out = {
    bodies: job.platforms.map((p) => hookShimBody(job.runner, job.entry, p)),
    home: shimHome(),
    shimPath: hookShimPath(),
  };
  const body = hookShimBody(job.runner, job.entry);
  out.first = writeHookShim(out.shimPath, body);
  // Second write, same body: the unchanged-content fast path. On Windows a shim a hook is
  // executing right now cannot be replaced, so this branch is the one that keeps a rebuild
  // mid-session from raising a sharing violation into the build.
  out.again = writeHookShim(out.shimPath, body);
  // A CHANGED body must actually land, or a moved checkout is never repaired.
  out.changed = writeHookShim(out.shimPath, hookShimBody(job.runner, job.entryMoved));
  out.prefix = hookPrefix({ runner: job.runner, entry: job.entry });
  return out;
}

function opencodeWire(job) {
  // Resolved directly as well as through the merge: `opencodeTarget` has eight runtime
  // call sites, more than any other name in the unit, and the merge only shows its answer
  // indirectly.
  const picked = path.basename(opencodeTarget(path.join(job.dir, 'opencode.json')));
  const target = mergeOpencodeJson(path.join(job.dir, 'opencode.json'), job.agentPath);
  return { picked, target: path.basename(target) };
}

/**
 * `_emit_claude_core`'s settings stage, in its own order — including the migration branch
 * where the recorded `settings_file` is not the one this scope writes.
 */
function claudeEmit(job) {
  const cfg = job.dir;
  const hookOpts = { runner: job.runner, entry: job.entry };
  const managed = {};
  const priorHooks = job.priorHooks || [];
  const priorExcl = job.priorExcludes || [];
  if (job.oldSf !== job.settingsName) {
    unwireClaudeSettings(path.join(cfg, job.oldSf), priorHooks);
    unwireClaudeExcludes(path.join(cfg, job.oldSf), priorExcl);
  }
  const settingsPath = path.join(cfg, job.settingsName);
  managed.settings_file = job.settingsName;
  const [, managedHooks] = mergeClaudeSettings(
    settingsPath, job.scope, job.oldSf === job.settingsName ? priorHooks : null, hookOpts);
  managed.settings_hooks = managedHooks;
  let added = [];
  if (job.wantExcludes && job.wantExcludes.length) {
    if (job.stackGlobal) {
      unwireClaudeExcludes(settingsPath, job.wantExcludes);
      managed.settings_excludes = [];
    } else {
      added = wireClaudeExcludes(settingsPath, job.wantExcludes);
      managed.settings_excludes = [...new Set([...priorExcl, ...added])].sort();
    }
  } else if (priorExcl.length) {
    managed.settings_excludes = priorExcl;
  }
  const problems = settingsIntegrityCheck(settingsPath, managed, 'present');
  return { managed: canon(managed), added, problems };
}

/** The runtime's teardown half: uninstall/deactivate, then verify it actually landed. */
function teardown(job) {
  const cfg = job.dir;
  const settingsPath = path.join(cfg, job.settingsName);
  const unwired = unwireClaudeSettings(settingsPath, job.priorHooks || []);
  unwireClaudeExcludes(settingsPath, job.priorExcludes || []);
  const stashed = managedBlockRead(path.join(cfg, 'CLAUDE.md'));
  managedBlockRemove(path.join(cfg, 'CLAUDE.md'), 'GENESEED', Boolean(job.whole));
  const managed = {
    settings_hooks: job.priorHooks || [],
    settings_excludes: job.priorExcludes || [],
  };
  const problems = settingsIntegrityCheck(settingsPath, managed, 'absent');
  return { unwired, stashed, problems };
}

function managedBlock(job) {
  const p = path.join(job.dir, 'CLAUDE.md');
  const statuses = job.contents.map((c) => managedBlockWrite(p, c, job.blockId || 'GENESEED'));
  const read = managedBlockRead(p, job.blockId || 'GENESEED');
  // A block id nothing wrote must read as absent, not as the other block's content.
  const missing = managedBlockRead(p, 'NOT-A-BLOCK');
  managedBlockRemove(p, job.blockId || 'GENESEED', Boolean(job.whole));
  return { statuses, read, missing };
}

function integrity(job) {
  const p = path.join(job.dir, job.settingsName);
  return {
    present: settingsIntegrityCheck(p, job.managed, 'present'),
    absent: settingsIntegrityCheck(p, job.managed, 'absent'),
  };
}

/**
 * P10d — `migrateShape` and `autostartStale` over a corpus of REAL config text.
 *
 * A CELL RUNS THE PROGRAM; A CORPUS RUNS THE FUNCTION, and these two need the corpus for
 * different reasons. `migrateShape`'s hardest case is shape 2 vs shape 3, which differ ONLY
 * inside the shim body — and `golden._snapshot` excludes every `geneseed-hook*` file, because
 * its body legitimately differs between the two implementations, so no cell can vary it and
 * compare the result. `autostartStale` reads files this repository has never written, so
 * every input to it is one a fixture must invent.
 */
function migrate(job) {
  return {
    shapes: job.corpus.map(([commands, body]) => migrateShape(commands, body)),
    autostart: job.autostart.map(([text, root]) => autostartStale(text, root)),
    // RELATIVE TO HOME, because the absolute answer embeds the machine's own home directory
    // and the two sides would differ on nothing that matters. What the function actually
    // decides IS the pair of relative locations, and comparing them this way also states
    // that BOTH platforms' paths come back on ONE platform — which is what makes the macOS
    // arm reachable from the Windows machine these gates run on.
    paths: autostartPaths().map((p) => path.relative(os.homedir(), p).replaceAll('\\', '/')),
  };
}

const KINDS = {
  jsonc, shim, 'opencode-wire': opencodeWire, 'claude-emit': claudeEmit, teardown,
  'managed-block': managedBlock, integrity, migrate,
};

for (const job of jobs) {
  if (job.geneseedHome) process.env.GENESEED_HOME = job.geneseedHome;
  else delete process.env.GENESEED_HOME;
  if (job.dir) mkdirSync(job.dir, { recursive: true });
  const run = KINDS[job.kind];
  if (!run) throw new Error(`unknown job kind ${job.kind}`);
  writeFileSync(job.resultFile, JSON.stringify(run(job)), 'utf8');
}
