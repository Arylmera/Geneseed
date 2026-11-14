// `geneseed profile apply <name> [--project <dir>] [--hosts a,b]` (`cmdProfileApply`,
// js/maintain/setup.mjs): the orchestration with every side effect injected, then real builds in a
// child process whose home is a sandbox.
//
// NOTHING HERE MAY REACH THE MACHINE. `apply` writes no PATH, login item or console by design
// (spec D33), but its builds do: the in-process tests inject `build`, and the real-build test runs
// the CLI in a child process with a sandboxed home (`cellEnv`), Personal profiles included.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { cmdProfileApply } from '../../js/maintain/setup.mjs';
import { resolvePath } from '../../js/hosts/hosts.mjs';
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

/** Run `cmdProfileApply` with every side effect faked; returns `{ rc, out, calls }`. */
function run(args, present, over = {}, profile = STARTER) {
  const calls = { build: [], export: [], layering: [] };
  const lines = [];
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let rc;
  try {
    rc = cmdProfileApply({ name: 'p', ...args }, {}, {
      load: () => ({ ok: true, profile, source: 'personal' }),
      tools: tools(...present),
      build: (argv) => { calls.build.push(argv); return 0; },
      exportDrift: (dir) => { calls.export.push(dir); return [null, null]; },
      changes: () => [],
      configDir: (host) => `/cfg/${host}`,
      layering: (host) => { calls.layering.push(host); return null; },
      ...over,
    });
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
  return { rc, out: lines.join('').replaceAll('\r\n', '\n'), calls };
}

const emitsOf = (calls) => calls.build.map((a) => a[a.indexOf('--emit') + 1]);

test('global: each profile host this machine has, and nothing else (D41)', () => {
  const { rc, out, calls } = run({}, ['claude', 'opencode']);
  assert.equal(rc, 0, out);
  assert.deepEqual(emitsOf(calls), ['opencode-global', 'claude-global']);
  // D19: the drift export runs per global install, as in `setup --profile`.
  assert.deepEqual(calls.export, ['/cfg/opencode', '/cfg/claude']);
  assert.match(out, /Geneseed profile apply - 'p' \(personal\) - global/);
  for (const line of ['  ok    OpenCode: installed (opencode-global)', '  ok    Claude Code: installed (claude-global)',
    '  --    IBM Bob: not found - install: https://bob.ibm.com/', '  --    OpenClaude: not found - install: https://openclaude.gitlawb.com/']) {
    assert.ok(out.includes(line), line);
  }
  // D33: no onboarding — no PATH, no login item, no console, no doctor.
  assert.doesNotMatch(out, /PATH|login item|web console|doctor/);
});

test('--hosts narrows to the profile hosts it names; a host the profile lacks is refused', () => {
  const r = run({ hosts: 'claude' }, ['claude', 'opencode']);
  assert.equal(r.rc, 0, r.out);
  assert.deepEqual(emitsOf(r.calls), ['claude-global']);
  assert.ok(r.out.includes('  --    OpenCode: not picked - left as it is'), r.out);
  const narrow = { ...STARTER, hosts: ['claude'] };
  const lacks = run({ hosts: 'claude,opencode' }, ['claude', 'opencode'], {}, narrow);
  assert.equal(lacks.rc, 2);
  assert.match(lacks.out, /--hosts: not in this profile: 'opencode' \(profile 'p' lists: claude\)/);
  assert.deepEqual(lacks.calls.build, []);
  const unknown = run({ hosts: 'vim' }, ['claude']);
  assert.equal(unknown.rc, 2);
  assert.match(unknown.out, /--hosts: not a host: 'vim' \(hosts: opencode, claude, bob, openclaude\)/);
  // Both mistakes at once are named apart: a word that is no host, and a host the profile lacks.
  const both = run({ hosts: 'vim,opencode' }, ['claude', 'opencode'], {}, narrow);
  assert.equal(both.rc, 2);
  assert.match(both.out, /--hosts: not a host: 'vim' \(hosts: [^)]*\); not in this profile: 'opencode' \(profile 'p' lists: claude\)/);
  // A host the profile does not list stays out of a default run, with its line.
  const other = run({}, ['claude', 'opencode'], {}, narrow);
  assert.ok(other.out.includes('  --    OpenCode: not in this profile - left as it is'), other.out);
});

test('project: each host builds its project emit into the folder, with no drift export (D32)', () => {
  const sb = makeSandbox('gs-apply-');
  try {
    const dir = resolvePath(sb.path);
    const { rc, out, calls } = run({ project: sb.path }, ['claude', 'bob'], {}, { ...STARTER, sharedTier: true });
    assert.equal(rc, 0, out);
    assert.deepEqual(emitsOf(calls), ['claude', 'bob']);
    for (const argv of calls.build) {
      assert.deepEqual(argv.slice(argv.indexOf('--out'), argv.indexOf('--out') + 4), ['--out', dir, '--root', dir]);
      // D37: the profile's shared tier counts in project scope.
      assert.ok(argv.join(' ').includes('--shared-tier on'), argv.join(' '));
    }
    assert.deepEqual(calls.export, []);
    assert.deepEqual(calls.layering, ['claude', 'bob']);
    assert.ok(out.includes(`  ok    Claude Code: installed (claude project in ${dir})`), out);
    assert.match(out, new RegExp(`- project ${dir.replaceAll('\\', '\\\\')}`));
  } finally { sb.cleanup(); }
});

test('project: a host whose global install is active gets the D39 line', () => {
  const sb = makeSandbox('gs-apply-');
  try {
    const layer = { root: '/home/u/.claude', gates: ['Secrets gate', 'Test note'] };
    const { out } = run({ project: sb.path, hosts: 'claude' }, ['claude'],
      { layering: (h) => (h === 'claude' ? layer : null) });
    assert.ok(out.includes(`  note  Claude Code: the global install at /home/u/.claude is active too, so both root files `
      + `load in ${resolvePath(sb.path)}. Global gates that still run there: Secrets gate, Test note `
      + '(see docs/concepts/exclusions.md)'), out);
  } finally { sb.cleanup(); }
});

test('a bad folder, no host found, and a failing build each end non-zero (D16)', () => {
  const bad = run({ project: path.join(ROOT, 'no', 'such', 'dir') }, ['claude']);
  assert.equal(bad.rc, 1);
  assert.match(bad.out, /--project: not a folder: /);
  assert.deepEqual(bad.calls.build, []);
  const none = run({}, []);
  assert.equal(none.rc, 1);
  assert.match(none.out, /None of the AI coding tools this apply builds was found/);
  const fail = run({}, ['claude', 'opencode'], {
    build: (argv) => (argv.includes('opencode-global') ? 3 : 0),
  });
  assert.equal(fail.rc, 1);
  assert.ok(fail.out.includes('  FAIL  OpenCode: build failed (exit 3)'), fail.out);
  assert.ok(fail.out.includes('  ok    Claude Code: installed (claude-global)'), fail.out);
});

test('an unknown profile refuses before anything runs', () => {
  const r = run({}, ['claude'], { load: () => ({ ok: false, error: "no profile 'p' — shipped: starter; personal: none" }) });
  assert.equal(r.rc, 1);
  assert.match(r.out, /\[profile\] no profile 'p'/);
  assert.deepEqual(r.calls.build, []);
});

// ---------------------------------------------------------------------------------------------
// Real builds through the CLI, in a child whose home is a sandbox. A fake `claude` on the sandbox
// PATH makes `hostTools` find Claude Code; the Personal profile lives in the sandboxed tier.
// ---------------------------------------------------------------------------------------------

test('profile apply builds a personal profile into a project, then puts a moved setting back', { timeout: 300_000 }, () => {
  const sb = makeSandbox('gs-apply-');
  try {
    const home = sb.path;
    const bin = path.join(home, 'fakebin');
    fs.mkdirSync(bin);
    for (const f of ['claude', 'claude.cmd']) fs.writeFileSync(path.join(bin, f), '', { mode: 0o755 });
    const tier = path.join(home, '.config', 'geneseed', 'profiles');
    fs.mkdirSync(tier, { recursive: true });
    fs.writeFileSync(path.join(tier, 'team.json'), JSON.stringify({ ...STARTER, hosts: ['claude'], sharedTier: true }));
    const proj = path.join(home, 'work', 'api');
    fs.mkdirSync(proj, { recursive: true });
    const env = cellEnv(home);
    env.PATH = `${bin}${path.delimiter}${env.PATH ?? env.Path ?? ''}`;
    delete env.Path;
    const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), ...args],
      { cwd: home, env, encoding: 'utf8', windowsHide: true });

    const first = cli('profile', 'apply', 'team', '--project', proj);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /Geneseed profile apply - 'team' \(personal\) - project /);
    assert.match(first.stdout, /ok {4}Claude Code: installed \(claude project in /);
    assert.ok(fs.existsSync(path.join(proj, '.claude', 'CLAUDE.md')) || fs.existsSync(path.join(proj, 'CLAUDE.md')));
    assert.match(fs.readFileSync(path.join(proj, '.geneseed-emit'), 'utf8'), /^claude\b/);

    // Move one setting off the profile, then apply again: the summary names what it puts back,
    // read off the PROJECT install (the preserve guard's target is the `--out` folder).
    const moved = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--theme', 'neutral',
      '--emit', 'claude', '--out', proj, '--root', proj, '--footprint', 'lean', '--posture', 'expert',
      '--doctrines', 'craft,rigor,ops,process,comms', '--exclude-rules', 'none', '--no-ownership-gate',
      '--shared-tier', 'on', '--reset'], { cwd: home, env, encoding: 'utf8', windowsHide: true });
    assert.equal(moved.status, 0, moved.stderr);
    const again = cli('profile', 'apply', 'team', '--project', proj);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /changed back to the profile: posture expert -> peer/);
    const third = cli('profile', 'apply', 'team', '--project', proj);
    assert.doesNotMatch(third.stdout, /changed back/);
  } finally { sb.cleanup(); }
});

// F1: `--project ~` would put a Claude Code project install INTO `~/.claude`, the global one, and
// overwrite its manifest. The folder is refused for each host whose marker dir there IS its global
// install, and nothing is written. Through the real CLI, in a sandboxed home, for every
// Claude-style host (OpenCode's global lives elsewhere, in ~/.config/opencode).
test('profile apply refuses a project folder that holds a host global install', { timeout: 300_000 }, () => {
  const sb = makeSandbox('gs-apply-');
  try {
    const home = sb.path;
    const bin = path.join(home, 'fakebin');
    fs.mkdirSync(bin);
    for (const t of ['claude', 'bob', 'openclaude']) {
      for (const f of [t, `${t}.cmd`]) fs.writeFileSync(path.join(bin, f), '', { mode: 0o755 });
    }
    const tier = path.join(home, '.config', 'geneseed', 'profiles');
    fs.mkdirSync(tier, { recursive: true });
    fs.writeFileSync(path.join(tier, 'team.json'), JSON.stringify({ ...STARTER, hosts: ['claude', 'bob', 'openclaude'] }));
    const env = cellEnv(home);
    env.PATH = `${bin}${path.delimiter}${env.PATH ?? env.Path ?? ''}`;
    delete env.Path;
    for (const [host, marker] of [['claude', '.claude'], ['bob', '.bob'], ['openclaude', '.openclaude']]) {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'profile', 'apply', 'team',
        '--project', home, '--hosts', host], { cwd: home, env, encoding: 'utf8', windowsHide: true });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, new RegExp(`--project: .* holds the ${host} global install .* overwrite it`));
      assert.doesNotMatch(r.stdout, /Running:/);
      assert.equal(fs.existsSync(path.join(home, marker, '.geneseed-manifest.json')), false, host);
    }
  } finally { sb.cleanup(); }
});
