// The scope half of `geneseed profile apply` (`js/maintain/profile-scope.mjs`): the project
// folder check, and what a global install still runs inside a project (spec D39).
//
// The two tables there are copies of facts that live elsewhere, so each is held against its
// source here: `STAND_DOWN_VERBS` against the verbs the hooks hand `globalHookStandingDown`, and
// `GATE_VERBS` against the hook commands a real build writes with every gate switched off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { GATE_SWITCHES } from '../../js/build/source.mjs';
import {
  GATE_VERBS, STAND_DOWN_VERBS, checkProjectFolder, gateRunsInProject, globalLayering, layeringText, markerCollision,
} from '../../js/maintain/profile-scope.mjs';
import { resolvePath } from '../../js/hosts/hosts.mjs';
import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('STAND_DOWN_VERBS is exactly the verbs the hooks pass to globalHookStandingDown', () => {
  const verbs = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'js', 'hosts')).filter((n) => n.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(ROOT, 'js', 'hosts', f), 'utf8');
    for (const m of text.matchAll(/globalHookStandingDown\(.*?'([a-z-]+)'\)/g)) verbs.add(m[1]);
  }
  assert.deepEqual([...verbs].sort(), [...STAND_DOWN_VERBS].sort());
});

const ALL_OFF = GATE_SWITCHES.filter((g) => g.flag.startsWith('--no-')).map((g) => g.flag);

/** Every hook command string in `file`'s `hooks` object. */
function hookCommands(file) {
  const hooks = JSON.parse(fs.readFileSync(file, 'utf8')).hooks ?? {};
  return Object.values(hooks).flat().flatMap((g) => (g.hooks ?? []).map((h) => h.command));
}

// For each Claude-style host: build its global install with every `--no-*` switch on, then read
// which hook verb each flag rides. That is what `GATE_VERBS` must say.
for (const [host, dir] of [['claude', '.claude'], ['openclaude', '.openclaude'], ['bob', '.bob']]) {
  test(`GATE_VERBS.${host} is the verbs each gate flag rides in a real ${host}-global build`, { timeout: 300_000 }, () => {
    const sb = makeSandbox('gs-scope-');
    try {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--theme', 'neutral',
        '--emit', `${host}-global`, '--footprint', 'lean', ...ALL_OFF],
      { cwd: sb.path, env: cellEnv(sb.path), encoding: 'utf8', windowsHide: true });
      assert.equal(r.status, 0, r.stderr);
      // The host's settings file is whichever JSON in its dir carries the hook groups.
      const files = fs.readdirSync(path.join(sb.path, dir), { recursive: true })
        .map((f) => path.join(sb.path, dir, String(f))).filter((f) => f.endsWith('.json')
          && fs.statSync(f).isFile() && fs.readFileSync(f, 'utf8').includes('"hooks"'));
      const cmds = files.flatMap((f) => { try { return hookCommands(f); } catch { return []; } });
      assert.ok(cmds.length, `no hook commands under ${dir}`);
      const derived = {};
      for (const g of GATE_SWITCHES.filter((x) => x.flag.startsWith('--no-'))) {
        const verbs = cmds.filter((c) => c.includes(` ${g.flag}`))
          .map((c) => / (context|git-gate|rule-gate|tool-gate|learn|activity) --/.exec(c)?.[1]);
        derived[g.key] = [...new Set(verbs)].sort();
      }
      const want = Object.fromEntries(Object.entries(GATE_VERBS[host]).map(([k, v]) => [k, [...v].sort()]));
      assert.deepEqual(derived, want);
    } finally { sb.cleanup(); }
  });
}

test('a gate still runs in a project unless every verb it rides stands down', () => {
  assert.equal(gateRunsInProject('claude', 'secretsGate'), true);
  assert.equal(gateRunsInProject('claude', 'deletionGate'), false);
  assert.equal(gateRunsInProject('claude', 'doneGate'), false);
  assert.equal(gateRunsInProject('claude', 'externalGate'), true);
  assert.equal(gateRunsInProject('bob', 'deletionGate'), true);
  assert.equal(gateRunsInProject('bob', 'doneGate'), false);
  // OpenCode's gates are plugins, and they do not stand down.
  for (const g of GATE_SWITCHES) assert.equal(gateRunsInProject('opencode', g.key), true, g.key);
});

test('the project folder check refuses what the console refuses, and resolves the rest', () => {
  const sb = makeSandbox('gs-scope-');
  try {
    assert.deepEqual(checkProjectFolder('  '), { error: 'no folder given' });
    assert.deepEqual(checkProjectFolder(null), { error: 'no folder given' });
    assert.match(checkProjectFolder(path.join(sb.path, 'absent')).error, /^not a folder: /);
    assert.deepEqual(checkProjectFolder(` ${sb.path} `), { root: resolvePath(sb.path) });
    // A host's own global config dir is no project folder.
    const cfg = path.join(sb.path, 'cfg');
    fs.mkdirSync(cfg);
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = cfg;
    try {
      assert.match(checkProjectFolder(cfg).error, /^that's a host global config dir/);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  } finally { sb.cleanup(); }
});

// F1: a folder whose marker dir IS a host's global install (`~` for Claude Code, whose `~/.claude`
// is the global) is refused for that host: a project build there would overwrite the global
// install. Only for the hosts about to be built, and case-folded on Windows.
for (const [host, marker, env] of [['claude', '.claude', 'CLAUDE_CONFIG_DIR'], ['bob', '.bob', 'BOB_CONFIG_DIR'],
  ['openclaude', '.openclaude', 'OPENCLAUDE_CONFIG_DIR']]) {
  test(`a folder holding the ${host} global install as its ${marker} is refused for ${host}`, () => {
    const sb = makeSandbox('gs-scope-');
    const prev = process.env[env];
    try {
      fs.mkdirSync(path.join(sb.path, marker));
      process.env[env] = path.join(sb.path, marker);
      const r = checkProjectFolder(sb.path, [host]);
      assert.match(r.error ?? '', new RegExp(`holds the ${host} global install .* overwrite it`));
      assert.equal(markerCollision(resolvePath(sb.path), host), r.error);
      // Spelled in another case on Windows, it is the same folder there.
      if (process.platform === 'win32') {
        assert.ok(checkProjectFolder(sb.path.toUpperCase(), [host]).error, 'case-folded');
      }
      // Another host, or no host named, is not refused for it.
      assert.deepEqual(checkProjectFolder(sb.path, ['opencode']), { root: resolvePath(sb.path) });
      assert.deepEqual(checkProjectFolder(sb.path), { root: resolvePath(sb.path) });
    } finally {
      if (prev === undefined) delete process.env[env];
      else process.env[env] = prev;
      sb.cleanup();
    }
  });
}

test('a global install beside a project names its armed gates that still run there (D39)', { timeout: 300_000 }, () => {
  const sb = makeSandbox('gs-scope-');
  try {
    const cfg = path.join(sb.path, '.claude');
    assert.equal(globalLayering('claude', { configDir: () => cfg }), null);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--theme', 'neutral',
      '--emit', 'claude-global', '--footprint', 'lean', '--no-external-gate'],
    { cwd: sb.path, env: cellEnv(sb.path), encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    // Armed and on rule-gate, which never stands down: secrets, ownership, test note. External
    // is off in this install, so it runs nowhere; done and deletion ride verbs that stand down.
    const layer = globalLayering('claude', { configDir: () => cfg });
    assert.deepEqual(layer, { root: cfg, gates: ['Secrets gate', 'Ownership gate', 'Test note'] });
    assert.equal(layeringText('Claude Code', layer, '/work/api'),
      `Claude Code: the global install at ${cfg} is active too, so both root files load in /work/api. `
      + 'Global gates that still run there: Secrets gate, Ownership gate, Test note (see docs/concepts/exclusions.md)');
    assert.equal(layeringText('Claude Code', null, '/x'), null);
  } finally { sb.cleanup(); }
});
