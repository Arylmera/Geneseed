#!/usr/bin/env node
/**
 * THE OPENCODE HOST CANARY: install the real OpenCode builds from npm, point each at a throwaway
 * home that holds this checkout's plugins, start it, and read its own log for the verdict.
 *
 *   node tests/host_canary.mjs                 # opencode-ai@latest (V1) and @opencode/cli@latest (V2)
 *   node tests/host_canary.mjs --v1 1.18.33 --v2 2.0.27
 *   node tests/host_canary.mjs --plugins <dir> # load another plugin dir (the mutation proof)
 *   node tests/host_canary.mjs --keep          # keep each throwaway home, to read the host's log
 *
 * WHY THIS EXISTS. OpenCode 2 rewrote the plugin API, refused all seven plugins (the guard
 * included), and carried on without a word to the user (4.0.2, c6a17d9). Nothing in this repo
 * could have seen it: every other gate compares the code with itself or with a mock written from
 * the same understanding, and a refactor pass reads the code, not the host. A host's loader
 * contract is only observable by running the host. So this does that, weekly and on any change to
 * `adapters/opencode/plugins/` (.github/workflows/host-canary.yml), against whatever npm ships as
 * `latest` — the next breaking major turns it red within a week instead of reaching a user.
 *
 * THE VERDICT IS THE HOST'S OWN LOG LINE. Both majors log `failed to load plugin` for a module
 * they refuse AND for one whose setup throws (measured 2026-10-12: V2 2.0.27 with a bare-factory
 * default and with a throwing `setup`, V1 1.18.33 with a throwing `server`). So a run passes when
 * that line names none of our plugins, and — because a check that finds nothing to look at also
 * finds nothing wrong — when there is positive evidence each one was reached:
 *   V2: a `loading plugin` line per plugin file.
 *   V1: its log names no plugin it loads, so the evidence is the workflow plugin's load banner,
 *       printed from `.server` — proof V1 reads the `{ id, server }` default. ponytail: one
 *       plugin's banner stands for all seven; the failure line still covers each of them.
 *
 * WHAT IT CANNOT SEE: behaviour after load. A hook V2 accepts but never calls (a renamed event, a
 * tool id the guard does not match) loads cleanly. That needs a model, and this repo never wires
 * an API key — the live guard check stays a manual step (docs/reference/opencode-plugins.md).
 *
 * Spawns npm and the host binaries, so it lives beside golden.mjs, outside the unit glob: it
 * downloads ~200 MB per major and needs the network.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { homeOverrides, makeSandbox, RELOCATION_VARS } from './helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PLUGINS = path.resolve(opt('--plugins', path.join(ROOT, 'adapters', 'opencode', 'plugins')));
const IDS = fs.readdirSync(PLUGINS).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
if (IDS.length === 0) {
  console.error(`no plugin files in ${PLUGINS}`);
  process.exit(2);
}

const MAJORS = [
  { name: 'V1', pkg: 'opencode-ai', platformPrefix: 'opencode-', spec: opt('--v1', 'latest') },
  { name: 'V2', pkg: '@opencode/cli', platformPrefix: '@opencode/cli-', spec: opt('--v2', 'latest') },
];

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function run(cmd, args, { cwd, env, timeout = 180_000 } = {}) {
  // npm is a .cmd shim on Windows, which spawn cannot start without a shell.
  const r = spawnSync(cmd, args, {
    cwd, env, timeout, encoding: 'utf8', windowsHide: true, shell: WIN && cmd === 'npm',
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error };
}

// The platform package's binary, not the wrapper's `bin`: the wrapper is filled in by a
// postinstall script, which a newer npm skips until the script is approved (seen 2026-10-12).
// The platform package is there either way.
function findBinary(prefixDir, platformPrefix) {
  const plat = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const nm = path.join(prefixDir, 'node_modules');
  const scope = platformPrefix.includes('/') ? platformPrefix.split('/')[0] : '';
  const stem = platformPrefix.includes('/') ? platformPrefix.split('/')[1] : platformPrefix;
  const dir = path.join(nm, scope);
  const want = `${stem}${plat}-${process.arch}`;
  // Exact first, then the -baseline / -musl variants npm may have picked instead.
  const pkgs = fs.readdirSync(dir).filter((d) => d.startsWith(want)).sort((a, b) => a.length - b.length);
  for (const p of pkgs) {
    const bin = path.join(dir, p, 'bin', WIN ? 'opencode.exe' : 'opencode');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

function v2Diagnostics(home, listed, logFile) {
  const files = fs.readdirSync(home, { recursive: true }).map(String)
    .filter((f) => !f.includes('bun') && !/plugins[\\/]/.test(f)).slice(0, 60);
  const logs = files.filter((f) => f.endsWith('.log'))
    .map((f) => `--- ${f}\n${fs.readFileSync(path.join(home, f), 'utf8').split('\n').slice(-15).join('\n')}`);
  return [`diagnostics: plugin list said: ${listed.trim() || '(nothing)'}`, `expected log: ${logFile}`,
    `files under the throwaway home:\n    ${files.join('\n    ')}`, ...logs].join('\n');
}

function canary(major, work) {
  const problems = [];
  const prefix = path.join(work, 'pkg');
  fs.mkdirSync(prefix, { recursive: true });
  const inst = run('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--loglevel=error',
    `${major.pkg}@${major.spec}`], { timeout: 600_000 });
  if (inst.status !== 0) return { problems: [`npm install ${major.pkg}@${major.spec} failed:\n${inst.out}`] };
  const version = JSON.parse(fs.readFileSync(
    path.join(prefix, 'node_modules', ...major.pkg.split('/'), 'package.json'), 'utf8')).version;
  const bin = findBinary(prefix, major.platformPrefix);
  if (!bin) return { version, problems: [`no ${major.pkg} binary for ${process.platform}-${process.arch}`] };

  // A throwaway home: the host must not read the user's real config (and its real plugins),
  // and the plugins must not write into the user's real activity/memory dirs.
  const home = path.join(work, 'home');
  const project = path.join(work, 'project');
  const config = path.join(home, '.config');
  fs.mkdirSync(path.join(config, 'opencode', 'plugins'), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  for (const id of IDS) fs.copyFileSync(path.join(PLUGINS, `${id}.js`), path.join(config, 'opencode', 'plugins', `${id}.js`));
  const env = {
    ...process.env, ...homeOverrides(home),
    XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'), GENESEED_NOTIFY: 'off',
  };
  for (const v of RELOCATION_VARS) delete env[v];

  let log;
  if (major.name === 'V2') {
    // `plugin list` boots the background service, which loads every plugin and writes the log.
    // Measured on 2.0.27: the CLI returns BEFORE the service has loaded anything, and on a fresh
    // home the first call may not boot it at all — so poll the log, re-asking every 10 s, and
    // after the last `loading plugin` line wait a little longer, because a setup that throws is
    // logged a few hundred ms after its load line. Stopped in `finally`: it outlives the CLI.
    const logFile = path.join(env.XDG_DATA_HOME, 'opencode', 'log', 'opencode.log');
    const readLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
    const loaded = (id) => new RegExp(`msg="loading plugin" id="[^"]*[\\\\/]${id}\\.js"`).test(log);
    let listed = '';
    try {
      for (let tick = 0; tick < 60; tick++) {
        if (tick % 20 === 0) {
          const r = run(bin, ['plugin', 'list'], { cwd: project, env });
          listed = r.out;
          if (r.status !== 0) problems.push(`\`opencode plugin list\` exited ${r.status}:\n${r.out}`);
        }
        log = readLog();
        if (IDS.every(loaded)) break;
        sleep(500);
      }
      sleep(3000);
      log = readLog();
    } finally {
      run(bin, ['service', 'stop'], { cwd: project, env, timeout: 30_000 });
    }
    const missing = IDS.filter((id) => !loaded(id));
    for (const id of missing) problems.push(`${id}: never loaded (no "loading plugin" line)`);
    // Nothing loaded at all is a harness question before it is a plugin one (where did the
    // service log, did it start?) — so say what the host left behind.
    if (missing.length === IDS.length) problems.push(v2Diagnostics(home, listed, logFile));
  } else {
    const r = run(bin, ['debug', 'config', '--print-logs', '--log-level', 'DEBUG'], { cwd: project, env });
    log = r.out;
    if (r.status !== 0) problems.push(`\`opencode debug config\` exited ${r.status}`);
    if (IDS.includes('geneseed-workflow') && !log.includes('[geneseed-workflow] loaded')) {
      problems.push('geneseed-workflow: no load banner — V1 did not call `.server`');
    }
  }
  for (const line of log.split(/\r?\n/).filter((l) => l.includes('failed to load plugin'))) {
    const id = IDS.find((i) => line.includes(`${i}.js`) || line.includes(`plugin.id=${i} `));
    if (id) problems.push(`${id}: ${(line.match(/(cause|error)=.*$/)?.[0] ?? line).slice(0, 300)}`);
  }
  return { version, problems };
}

let failed = false;
for (const major of MAJORS) {
  const box = makeSandbox(`gs-canary-${major.name}-`);
  const work = box.path;
  let res;
  try { res = canary(major, work); }
  catch (e) { res = { problems: [`canary crashed: ${e?.stack || e}`] }; }
  const label = `${major.pkg}@${res.version ?? major.spec} (${major.name})`;
  if (res.problems.length === 0) {
    console.log(`ok   ${label}: ${IDS.length} plugin(s) loaded`);
  } else {
    failed = true;
    console.error(`FAIL ${label}:`);
    for (const p of res.problems) console.error(`  ${p}`);
  }
  // Best effort: a service that is still shutting down holds its database open on Windows.
  if (argv.includes('--keep')) console.error(`  kept ${work}`);
  else box.cleanup();
}
process.exit(failed ? 1 : 0);
