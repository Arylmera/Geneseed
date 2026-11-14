// `geneseed setup --profile <name>` (`setupProfile`, js/maintain/setup.mjs): the orchestration
// with every side effect injected, then real builds of the four global emits in a sandboxed home.
//
// NOTHING HERE MAY REACH THE MACHINE. The default `link` writes the real user PATH (PowerShell,
// HKCU) or a shell rc file, the default login item writes the real Startup folder or a
// LaunchAgent, the default console spawns a daemon. Every test passes a fake for all three, and
// the real-build test runs in a child process whose home is a sandbox (`cellEnv`).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loginItem, setupProfile } from '../../js/maintain/setup.mjs';
import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STARTER = {
  description: 'test', hosts: ['opencode', 'bob', 'claude', 'openclaude'], theme: 'neutral',
  footprint: 'lean', posture: 'peer', mode: 'direct', trust: 'balanced', doctrines: 'all',
  kits: [], gates: { ownershipGate: false }, login: true,
};

/** `hostTools` rows in its order (opencode, claude, bob, openclaude) with `present` set per host. */
const tools = (...present) => ['opencode', 'claude', 'bob', 'openclaude']
  .map((h) => ['x', present.includes(h), 'https://example.test/', null]);

/** Run `setupProfile` with every side effect faked; returns `{ rc, out, calls }`. */
async function run(profile, present, over = {}) {
  const calls = { build: [], link: 0, autostart: 0, console: 0, doctor: [], export: [] };
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let rc;
  try {
    rc = await setupProfile('p', {
      load: () => ({ ok: true, profile: profile }),
      tools: tools(...present),
      build: (argv) => { calls.build.push(argv); return 0; },
      exportDrift: (dir) => { calls.export.push(dir); return [null, null]; },
      changes: () => [],
      configDir: (host) => `/cfg/${host}`,
      link: () => { calls.link += 1; return 0; },
      autostart: () => { calls.autostart += 1; return { ok: true, text: 'login item written: /x' }; },
      startConsole: async () => { calls.console += 1; return { ok: true, url: 'http://127.0.0.1:4747' }; },
      doctor: (theme) => { calls.doctor.push(theme); return 0; },
      platform: 'win32',
      transient: false,
      ...over,
    });
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { rc, out: lines.join('').replaceAll('\r\n', '\n'), calls };
}

const emitsOf = (calls) => calls.build.map((a) => a[a.indexOf('--emit') + 1]);

test('no listed host on the machine: nothing built, every install link printed, exit 1 (D3)', async () => {
  const { rc, out, calls } = await run(STARTER, []);
  assert.equal(rc, 1);
  assert.deepEqual(calls.build, []);
  assert.equal(calls.link + calls.autostart + calls.console + calls.doctor.length, 0);
  assert.match(out, /None of the AI coding tools this profile installs into was found/);
  for (const label of ['OpenCode', 'Claude Code', 'IBM Bob', 'OpenClaude']) {
    assert.ok(out.includes(`--  ${label} - install: https://`), label);
  }
});

test('one host: built once, then link, login item, console and a doctor on the profile theme', async () => {
  const { rc, out, calls } = await run(STARTER, ['claude']);
  assert.equal(rc, 0, out);
  assert.deepEqual(emitsOf(calls), ['claude-global']);
  assert.deepEqual(calls.export, ['/cfg/claude']);
  assert.deepEqual([calls.link, calls.autostart, calls.console], [1, 1, 1]);
  assert.deepEqual(calls.doctor, ['neutral']);
  assert.match(out, / {2}ok {4}Claude Code: installed \(claude-global\)/);
  // The install link is the host table's own, not the row's.
  assert.match(out, / {2}-- {4}OpenCode: not found - install: https:\/\/opencode\.ai\/docs\//);
  assert.match(out, /ok {4}web console: http:\/\/127\.0\.0\.1:4747/);
  // ASCII only: the install scripts print through cmd.exe's codepage.
  const summary = out.slice(out.indexOf('Summary'));
  assert.ok(/^[\x20-\x7e\n]*$/.test(summary), `non-ASCII in the summary:\n${summary}`);
});

test('all four hosts are built, in HOSTS order', async () => {
  const { rc, calls } = await run(STARTER, ['opencode', 'claude', 'bob', 'openclaude']);
  assert.equal(rc, 0);
  assert.deepEqual(emitsOf(calls), ['opencode-global', 'claude-global', 'bob-global', 'openclaude-global']);
});

test('a host found but not listed by the profile is not built, and the summary says so (D27)', async () => {
  const { rc, out, calls } = await run({ ...STARTER, hosts: ['claude'] }, ['claude', 'bob']);
  assert.equal(rc, 0);
  assert.deepEqual(emitsOf(calls), ['claude-global']);
  assert.match(out, /IBM Bob: found, not in this profile - left as it is/);
  assert.doesNotMatch(out, /OpenCode: not found/);
});

test('one failing host does not stop the others; the run ends non-zero with the forced command (D16, D25)', async () => {
  const { rc, out, calls } = await run(STARTER, ['opencode', 'claude', 'bob'], {
    build: (argv) => (argv.includes('claude-global') ? 1 : 0),
  });
  assert.equal(rc, 1);
  assert.match(out, /FAIL {2}Claude Code: build failed \(exit 1\)/);
  assert.match(out, /geneseed build --theme neutral --emit claude-global .* --reset --force/);
  assert.match(out, /ok {4}OpenCode: installed/);
  assert.match(out, /ok {4}IBM Bob: installed/);
  assert.equal(calls.link, 1);
});

test('a build that throws is a failure of that host only', async () => {
  const { rc, out } = await run(STARTER, ['opencode', 'claude'], {
    build: (argv) => { if (argv.includes('opencode-global')) throw Object.assign(new Error('boom'), { exitCode: 2 }); return 0; },
  });
  assert.equal(rc, 1);
  assert.match(out, /FAIL {2}OpenCode: build failed \(exit 2\)/);
  assert.match(out, /ok {4}Claude Code: installed/);
});

test('link, login item and console failures are warnings, not failures (D16)', async () => {
  const { rc, out } = await run(STARTER, ['claude'], {
    link: (report) => { report.foreign = '/usr/local/bin/geneseed'; return 1; },
    autostart: () => ({ ok: false, text: 'login item not written: x was not written by Geneseed' }),
    startConsole: async () => { throw new Error('port'); },
  });
  assert.equal(rc, 0);
  assert.match(out, /! {5}geneseed on PATH: \/usr\/local\/bin\/geneseed is not a launcher Geneseed wrote/);
  assert.match(out, /! {5}login item not written/);
  assert.match(out, /! {5}web console did not start - run: geneseed web start/);
});

test('a link that exits 0 but could not reach PATH is a warning with the manual step', async () => {
  const { rc, out } = await run(STARTER, ['claude'], {
    link: (report) => { Object.assign(report, { onPath: false, pathDir: 'C:\\Users\\u\\AppData\\Local\\Geneseed\\bin' }); return 0; },
  });
  assert.equal(rc, 0);
  assert.match(out, /! {5}geneseed is not on PATH yet: add C:\\Users\\u\\AppData\\Local\\Geneseed\\bin to your PATH by hand/);
  assert.doesNotMatch(out, /ok {4}geneseed on PATH/);
});

test('a temporary copy gets neither the PATH launcher nor the login item, and says so', async () => {
  const { rc, out, calls } = await run(STARTER, ['claude'], { transient: true });
  assert.equal(rc, 0);
  assert.deepEqual([calls.link, calls.autostart, calls.console], [0, 0, 1]);
  assert.match(out, /! {5}geneseed not put on PATH: .* is a temporary copy - run this from a lasting clone/);
  assert.match(out, /! {5}login item not written: .* is a temporary copy/);
});

test('a failed build lists no settings as changed back (it changed nothing)', async () => {
  const { out } = await run(STARTER, ['claude'], {
    build: () => 1,
    changes: () => [{ name: 'theme', from: 'pirate', to: 'neutral' }],
  });
  assert.match(out, /FAIL {2}Claude Code: build failed/);
  assert.doesNotMatch(out, /changed back to the profile/);
});

// The login item per launcher state, through `loginItem`'s seams: written only when absent or
// stale (D7), a hand-written one left alone, a failed write a warning.
const LOGIN_ROWS = [
  ['ours', true, { ok: true, text: 'login item already set: /S/geneseed-web.vbs' }, 0],
  ['absent', true, { ok: true, text: 'login item written: /S/geneseed-web.vbs' }, 1],
  ['stale', true, { ok: true, text: 'login item written: /S/geneseed-web.vbs' }, 1],
  ['hand', true, { ok: false, text: 'login item not written: /S/geneseed-web.vbs was not written by Geneseed, so it is left alone' }, 0],
  ['absent', false, { ok: false, text: 'login item not written: the path x has a % (see docs/guides/autostart.md)' }, 1],
];
for (const [state, writes, want, installs] of LOGIN_ROWS) {
  test(`login item: state ${state}${writes ? '' : ', write refused'}`, () => {
    let n = 0;
    const got = loginItem({
      state: () => ({ file: '/S/geneseed-web.vbs', state }),
      install: () => { n += 1; return writes ? { ok: true } : { ok: false, error: 'the path x has a %' }; },
    });
    assert.deepEqual(got, want);
    assert.equal(n, installs);
  });
}

test('login item: a platform with no launcher gives no line', () => {
  assert.equal(loginItem({ state: () => null, install: () => { throw new Error('called'); } }), null);
});

test('the shell rc file the link changed is named (D26)', async () => {
  const { out } = await run(STARTER, ['claude'], {
    link: (report) => { report.rcFile = '/home/u/.zshrc'; return 0; },
  });
  assert.match(out, /added the PATH block to \/home\/u\/\.zshrc/);
});

test('a failing doctor makes the exit non-zero; the harness stays (D22)', async () => {
  const { rc, out } = await run(STARTER, ['claude'], { doctor: () => 1 });
  assert.equal(rc, 1);
  assert.match(out, /FAIL {2}doctor reported problems/);
});

test('login false skips the login item and the console', async () => {
  const { rc, calls } = await run({ ...STARTER, login: false }, ['claude']);
  assert.equal(rc, 0);
  assert.deepEqual([calls.autostart, calls.console], [0, 0]);
});

test('on Linux there is no login item, and the console still starts (D24)', async () => {
  const { out, calls } = await run(STARTER, ['claude'], { platform: 'linux' });
  assert.equal(calls.autostart, 0);
  assert.equal(calls.console, 1);
  assert.match(out, /no login item exists for this platform/);
});

test('the settings a re-run changes back, and exported local edits, are named per host (D14, D19)', async () => {
  const { out } = await run(STARTER, ['claude'], {
    changes: () => [{ name: 'theme', from: 'pirate', to: 'neutral' }, { name: 'mode', from: 'foreman', to: 'direct' }],
    exportDrift: () => ['/cfg/claude/improvements/x.md', []],
  });
  assert.match(out, /changed back to the profile: theme pirate -> neutral, mode foreman -> direct/);
  assert.match(out, /local edits saved to \/cfg\/claude\/improvements\/x\.md/);
});

test('an unknown profile refuses before anything runs', async () => {
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let rc;
  try {
    rc = await setupProfile('nope', { tools: tools('claude'), build: () => { throw new Error('built'); } });
  } finally { process.stderr.write = orig; }
  assert.equal(rc, 1);
  assert.match(lines.join(''), /\[setup\] no profile 'nope' — shipped profiles: guillaume-claude-global, starter/);
});

// ---------------------------------------------------------------------------------------------
// Real builds, sandboxed home, child process. Every host's global emit renders from `starter`;
// a second run changes no file and reports nothing changed back; a run over an install moved off
// the profile names what it puts back.
// ---------------------------------------------------------------------------------------------

/** sha256 of every file under `dir`, by relative path. */
function treeHash(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) out[path.relative(dir, f)] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

const PROBE = `
import { setupProfile } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'js', 'maintain', 'setup.mjs')).href)};
const rc = await setupProfile('starter', {
  tools: ['opencode', 'claude', 'bob', 'openclaude'].map(() => ['x', true, 'u', null]),
  link: () => 0,
  autostart: () => ({ ok: true, text: 'fake login item' }),
  startConsole: async () => ({ ok: true, url: 'http://fake' }),
  doctor: () => 0,
  platform: 'win32',
  transient: false,
});
process.exitCode = rc;
`;

test('starter renders into every global emit, and a re-run is idempotent', { timeout: 600_000 }, () => {
  const sb = makeSandbox('gs-profile-run-');
  try {
    const env = cellEnv(sb.path);
    const probe = () => spawnSync(process.execPath, ['--input-type=module', '-e', PROBE],
      { cwd: sb.path, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const first = probe();
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    for (const label of ['OpenCode', 'Claude Code', 'IBM Bob', 'OpenClaude']) {
      assert.match(first.stdout, new RegExp(`ok {4}${label}: installed`), label);
    }
    const before = treeHash(sb.path);
    assert.ok(Object.keys(before).length > 50, 'the builds wrote almost nothing');
    const second = probe();
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.doesNotMatch(second.stdout, /changed back to the profile/);
    assert.deepEqual(treeHash(sb.path), before, 'a second profile run changed files');

    // Move the Claude install off the profile, then run again: the theme comes back, named.
    const moved = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'),
      '--theme', 'pirate', '--emit', 'claude-global', '--footprint', 'lean', '--doctrines',
      'craft,rigor,ops,process,comms', '--exclude-rules', 'none', '--no-ownership-gate'],
    { cwd: sb.path, env, encoding: 'utf8', windowsHide: true });
    assert.equal(moved.status, 0, moved.stderr);
    const third = probe();
    assert.equal(third.status, 0, third.stderr);
    assert.match(third.stdout, /changed back to the profile: theme pirate -> neutral/);
    assert.deepEqual(treeHash(sb.path), before, 'the profile run did not put the install back');
  } finally { sb.cleanup(); }
});
