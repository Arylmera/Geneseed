#!/usr/bin/env node
/**
 * THE HOST CANARY: install each host Geneseed targets from npm, point it at a throwaway home holding
 * what this checkout installs, start it, and read the host's own output for the verdict.
 *
 *   node tests/host_canary.mjs                     # every host, at npm `latest`
 *   node tests/host_canary.mjs --only claude-code  # one host (comma-separated for several)
 *   node tests/host_canary.mjs --opencode-v2 2.0.27 --claude-code 2.1.296   # pin a version
 *   node tests/host_canary.mjs --plugins <dir>     # OpenCode: load another plugin dir
 *   node tests/host_canary.mjs --break             # Claude engines: emit, then corrupt one hook
 *   node tests/host_canary.mjs --keep              # keep each throwaway home, to read its logs
 *   node tests/host_canary.mjs --kits spring-boot  # Claude engines: emit with these kits on (spec T3)
 *
 * `--plugins` and `--break` are the mutation proofs: each must turn its hosts red.
 *
 * WHY THIS EXISTS. OpenCode 2 rewrote the plugin API, refused all seven plugins (the guard
 * included), and carried on without a word to the user (4.0.2, c6a17d9). Nothing in this repo
 * could have seen it: every other gate compares the code with itself or with a mock written from
 * the same understanding, and a refactor pass reads the code, not the host. A host's contract is
 * only observable by running the host. So this does that, weekly and on any change to what it
 * installs (.github/workflows/host-canary.yml), against whatever npm ships as `latest`.
 *
 * WHAT EACH HOST IS ASKED, and why that question:
 *   opencode V1/V2  Both majors log `failed to load plugin` for a module they refuse AND for one
 *                   whose setup throws (measured 2026-10-12). A run passes when that line names
 *                   none of ours AND there is positive evidence each was reached — a check that
 *                   finds nothing to look at also finds nothing wrong: V2 logs `loading plugin` per
 *                   file; V1 names none, so its evidence is the workflow plugin's banner, printed
 *                   from `.server`. ponytail: one banner stands for seven on V1.
 *   claude-code     `claude-global` is emitted into the sandbox. `claude doctor` reads settings
 *                   offline and lists every `Invalid settings` entry (an unknown hook type, a bad
 *                   matcher) — Claude then IGNORES that entry silently, so this is the only place a
 *                   schema change says so. And a logged-out `claude -p` still runs SessionStart
 *                   before refusing the prompt, so its debug log shows our context hook succeed.
 *   openclaude      The same emit and the same SessionStart line. Its `doctor` checks only the
 *                   auto-updater, so there is no settings check to ask it.
 *   bob             Not checked: IBM does not publish Bob Shell on npm (`@ibm/bob` is an empty
 *                   0.0.2 placeholder), so there is nothing to install here or in CI. Reported as
 *                   `skip`, never as a pass. Live check on a machine with Bob: `/hooks` in Bob Shell.
 *
 * NO MODEL IS EVER CALLED. The Claude engines run with no credentials in a sandboxed home AND with
 * every provider base URL pointed at a closed local port, so even a machine whose OS keychain
 * holds a login cannot spend it. That is also the ceiling: hooks that need a model turn
 * (PreToolUse, the guard's deny) load but are not exercised.
 *
 * Spawns npm and the host binaries, so it lives beside golden.mjs, outside the unit glob: it
 * downloads ~600 MB and needs the network.
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
const ONLY = opt('--only', '').split(',').filter(Boolean);
const BREAK = argv.includes('--break');
const KITS = opt('--kits', '');
const PLUGINS = path.resolve(opt('--plugins', path.join(ROOT, 'adapters', 'opencode', 'plugins')));
const IDS = fs.readdirSync(PLUGINS).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
if (IDS.length === 0) {
  console.error(`no plugin files in ${PLUGINS}`);
  process.exit(2);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function run(cmd, args, { cwd, env, timeout = 180_000 } = {}) {
  // npm is a .cmd shim on Windows, which spawn cannot start without a shell. stdin is closed:
  // OpenClaude otherwise waits 3 s for piped input before it starts.
  const r = spawnSync(cmd, args, {
    cwd, env, timeout, encoding: 'utf8', windowsHide: true, shell: WIN && cmd === 'npm', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error };
}

// A platform package's binary, not the wrapper's `bin`: the wrapper is filled in by a
// postinstall script, which a newer npm skips until the script is approved (seen 2026-10-12).
// The platform package is there either way. Exact name first, then the -baseline / -musl
// variants npm may have picked instead.
function platformBinary(prefixDir, pkgPrefix, platName, file) {
  const [scope, stem] = pkgPrefix.includes('/') ? pkgPrefix.split('/') : ['', pkgPrefix];
  const dir = path.join(prefixDir, 'node_modules', scope);
  const want = `${stem}${platName}-${process.arch}`;
  const pkgs = fs.readdirSync(dir).filter((d) => d.startsWith(want)).sort((a, b) => a.length - b.length);
  for (const p of pkgs) {
    const bin = path.join(dir, p, file);
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}
const OPENCODE_PLAT = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
const EXE = WIN ? '.exe' : '';

// ---- OpenCode -------------------------------------------------------------------------------

function v2Diagnostics(home, listed, logFile) {
  const files = fs.readdirSync(home, { recursive: true }).map(String)
    .filter((f) => !f.includes('bun') && !/plugins[\\/]/.test(f)).slice(0, 60);
  const logs = files.filter((f) => f.endsWith('.log'))
    .map((f) => `--- ${f}\n${fs.readFileSync(path.join(home, f), 'utf8').split('\n').slice(-15).join('\n')}`);
  return [`diagnostics: plugin list said: ${listed.trim() || '(nothing)'}`, `expected log: ${logFile}`,
    `files under the throwaway home:\n    ${files.join('\n    ')}`, ...logs].join('\n');
}

function checkOpencode(major) {
  return ({ exec, home, project, env }) => {
    const problems = [];
    const pluginDir = path.join(home, '.config', 'opencode', 'plugins');
    fs.mkdirSync(pluginDir, { recursive: true });
    for (const id of IDS) fs.copyFileSync(path.join(PLUGINS, `${id}.js`), path.join(pluginDir, `${id}.js`));
    env.GENESEED_NOTIFY = 'off';

    let log;
    if (major === 'V2') {
      // `plugin list` boots the background service, which loads every plugin and writes the log.
      // Measured on 2.0.27: the CLI returns BEFORE the service has loaded anything, and on a fresh
      // home the first call may not boot it at all — so poll the log, re-asking every 10 s, and
      // after the last `loading plugin` line wait a little longer, because a setup that throws is
      // logged a few hundred ms after its load line. Stopped in `finally`: it outlives the CLI.
      const logFile = path.join(env.XDG_DATA_HOME, 'opencode', 'log', 'opencode.log');
      const readLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
      // logfmt quotes a value only when it must: a Windows path (backslashes) is quoted, a Linux
      // `/tmp/...` path is not — the first CI run missed every line by requiring the quotes.
      const loaded = (id) => new RegExp(`msg="loading plugin" id="?[^"\\s]*[\\\\/]${id}\\.js[" ]`).test(log);
      let listed = '';
      try {
        for (let tick = 0; tick < 60; tick++) {
          if (tick % 20 === 0) {
            const r = exec(['plugin', 'list'], { cwd: project, env });
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
        exec(['service', 'stop'], { cwd: project, env, timeout: 30_000 });
      }
      const missing = IDS.filter((id) => !loaded(id));
      for (const id of missing) problems.push(`${id}: never loaded (no "loading plugin" line)`);
      // Nothing loaded at all is a harness question before it is a plugin one (where did the
      // service log, did it start?) — so say what the host left behind.
      if (missing.length === IDS.length) problems.push(v2Diagnostics(home, listed, logFile));
    } else {
      const r = exec(['debug', 'config', '--print-logs', '--log-level', 'DEBUG'], { cwd: project, env });
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
    return { problems, summary: `${IDS.length} plugin(s) loaded` };
  };
}

// ---- Claude engines (Claude Code, OpenClaude) ------------------------------------------------

// The debug log's record of SessionStart running our context hook. Claude Code writes the hook's
// output inside a quoted string (`\n` escaped), OpenClaude writes it raw: allow both. Claude
// 2.1.296 also labels the stream (`stderr:`), 2.1.283 did not.
const SESSION_START_OK = /Hook SessionStart:startup \(SessionStart\) success:(?:\\n|\s)*(?:std(?:out|err):(?:\\n|\s)*)?\[context\]/;
const SESSION_START_BAD = /Hook SessionStart:startup \(SessionStart\) (?:error|failed|non-blocking error)[^\n]{0,300}/;

function checkClaudeEngine({ emit, configVar, configDir, doctor }) {
  return ({ exec, home, project, env, work }) => {
    const problems = [];
    const cfg = path.join(home, configDir);
    env[configVar] = cfg;
    // Credentials are absent by construction (sandboxed home); the dead base URLs make sure a
    // login found anywhere else (an OS keychain) still cannot reach a model.
    for (const v of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']) delete env[v];
    Object.assign(env, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', OPENAI_BASE_URL: 'http://127.0.0.1:9' });

    const e = run(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', emit, '--config-dir', cfg, ...(KITS ? ['--kits', KITS] : [])], { env });
    if (e.status !== 0) return { problems: [`\`geneseed-build --emit ${emit}\` exited ${e.status}:\n${e.out}`] };
    const settingsFile = path.join(cfg, 'settings.json');
    if (BREAK) {
      const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      s.hooks.SessionStart[0].hooks[0].type = 'not-a-hook-type';
      fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
    }

    if (doctor) {
      const d = exec(['doctor'], { cwd: project, env, timeout: 90_000 });
      const block = d.out.match(/Invalid settings[\s\S]*?(?:\n\s*\n|$)/)?.[0] ?? '';
      const ours = block.split(/\r?\n/).filter((l) => l.includes(settingsFile));
      for (const l of ours) problems.push(`doctor: ${l.trim().slice(0, 300)}`);
    }

    // Times out by design on OpenClaude, which keeps retrying the dead URL: only the log counts.
    const dbg = path.join(work, `${emit}-debug.txt`);
    exec(['-p', 'hi', '--debug-file', dbg], { cwd: project, env, timeout: 60_000 });
    const log = fs.existsSync(dbg) ? fs.readFileSync(dbg, 'utf8') : '';
    const bad = log.match(SESSION_START_BAD)?.[0];
    if (bad) problems.push(`SessionStart hook failed: ${bad}`);
    else if (!SESSION_START_OK.test(log)) {
      problems.push(`SessionStart never ran our context hook (no "SessionStart ... success: [context]" in ${log ? 'the debug log' : 'an empty debug log'})`);
    }
    return { problems, summary: `settings accepted, SessionStart ran the context hook${doctor ? ', doctor clean' : ''}` };
  };
}

// ---- the hosts --------------------------------------------------------------------------------

const HOSTS = [
  { id: 'opencode-v1', pkg: 'opencode-ai',
    bin: (p) => platformBinary(p, 'opencode-', OPENCODE_PLAT, path.join('bin', `opencode${EXE}`)), check: checkOpencode('V1') },
  { id: 'opencode-v2', pkg: '@opencode/cli',
    bin: (p) => platformBinary(p, '@opencode/cli-', OPENCODE_PLAT, path.join('bin', `opencode${EXE}`)), check: checkOpencode('V2') },
  { id: 'claude-code', pkg: '@anthropic-ai/claude-code',
    bin: (p) => platformBinary(p, '@anthropic-ai/claude-code-', process.platform, `claude${EXE}`),
    check: checkClaudeEngine({ emit: 'claude-global', configVar: 'CLAUDE_CONFIG_DIR', configDir: '.claude', doctor: true }) },
  // A Node script, run by this Node: its own shebang would not start on Windows.
  { id: 'openclaude', pkg: '@gitlawb/openclaude', node: true,
    bin: (p) => path.join(p, 'node_modules', '@gitlawb', 'openclaude', 'bin', 'openclaude'),
    check: checkClaudeEngine({ emit: 'openclaude-global', configVar: 'OPENCLAUDE_CONFIG_DIR', configDir: '.openclaude', doctor: false }) },
];

function canary(host, work) {
  const spec = opt(`--${host.id}`, 'latest');
  const prefix = path.join(work, 'pkg');
  fs.mkdirSync(prefix, { recursive: true });
  const inst = run('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--loglevel=error',
    `${host.pkg}@${spec}`], { timeout: 600_000 });
  if (inst.status !== 0) return { spec, problems: [`npm install ${host.pkg}@${spec} failed:\n${inst.out}`] };
  const version = JSON.parse(fs.readFileSync(
    path.join(prefix, 'node_modules', ...host.pkg.split('/'), 'package.json'), 'utf8')).version;
  const found = host.bin(prefix);
  if (!found || !fs.existsSync(found)) return { version, problems: [`no ${host.pkg} binary for ${process.platform}-${process.arch}`] };

  // A throwaway home: the host must not read the user's real config, the emit must not touch the
  // real install or the machine-wide hook shim (GENESEED_HOME is in homeOverrides), and nothing
  // the hooks or plugins write may land in the user's real dirs.
  const home = path.join(work, 'home');
  const project = path.join(work, 'project');
  fs.mkdirSync(project, { recursive: true });
  const env = {
    ...process.env, ...homeOverrides(home),
    XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  };
  for (const v of RELOCATION_VARS) delete env[v];
  // homeOverrides pins Claude's hook shell to a STUB bash for byte-stable unit tests; a real host
  // run through it fails every hook with EFTYPE. The real shell, whatever this machine has.
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) env.CLAUDE_CODE_GIT_BASH_PATH = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  else delete env.CLAUDE_CODE_GIT_BASH_PATH;
  // A node-script host runs as `node <script>`.
  const exec = (args, o) => (host.node ? run(process.execPath, [found, ...args], o) : run(found, args, o));
  return { version, ...host.check({ exec, home, project, env, work }) };
}

console.log('skip bob: IBM does not publish Bob Shell on npm — nothing to install (see the header)');
let failed = false;
for (const host of HOSTS.filter((h) => ONLY.length === 0 || ONLY.includes(h.id))) {
  const box = makeSandbox(`gs-canary-${host.id}-`);
  let res;
  try { res = canary(host, box.path); }
  catch (e) { res = { problems: [`canary crashed: ${e?.stack || e}`] }; }
  const label = `${host.id} (${host.pkg}@${res.version ?? res.spec ?? 'latest'})`;
  if (res.problems.length === 0) {
    console.log(`ok   ${label}: ${res.summary}`);
  } else {
    failed = true;
    console.error(`FAIL ${label}:`);
    for (const p of res.problems) console.error(`  ${p}`);
  }
  // Best effort: a service that is still shutting down holds its database open on Windows.
  if (argv.includes('--keep')) console.error(`  kept ${box.path}`);
  else box.cleanup();
}
process.exit(failed ? 1 : 0);
