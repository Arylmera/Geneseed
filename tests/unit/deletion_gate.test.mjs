// `--no-deletion-gate` — Law IV's tool-boundary gate, switched off per install (user decision,
// 2026-10-17). Written out, not recorded. Each cell states what the switch must reach:
//   1. the carrier says `Deletion gate: off` ONLY when off, so a default build stays byte-identical,
//      and the reader fails closed: no line, or any value but `off`, reads as armed
//   2. the flag survives a rebuild: `installProfile` reads it back and `setupBuildArgs` re-spells
//      it, eliding it when armed
//   3. the emitted gate commands carry `--no-deletion-gate` only when off (Claude, OpenClaude, Bob)
//      and OpenCode's `permission.bash` drops the Law IV tier — and nothing else
//   4. the OpenCode guard plugin reads the carrier: a real loss blocks when armed and passes when
//      off, while a catastrophic command still blocks
//   5. `status` names the switch only when off; `doctor --probe` probes a disarmed gate on what it
//      must still refuse
// The hook verbs themselves are covered in hook_gates.test.mjs (`--no-deletion-gate` cells).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from '../../js/build/bundle.mjs';
import { ROOT, makeCfg } from '../../js/build/source.mjs';
import { parseDriverArgs, emitGlobalInto } from '../../js/build/driver.mjs';
import { installProfile, setupBuildArgs } from '../../js/build/generate.mjs';
import { gatesOfDir } from '../../js/hosts/installs.mjs';
import { claudeHookGroups } from '../../js/hosts/settings.mjs';
import { hookRunnerEntry } from '../../js/hosts/shim.mjs';
import { statusData, statusLines } from '../../js/inspect/status.mjs';
import {
  BAD_COMMAND, DISARMED_BAD_COMMAND, badCommandFor, probeVerdict,
} from '../../js/inspect/checks-probe.mjs';
import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

// The global emit writes the machine hook shim into the environment's home.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

function quiet(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
}

function withDir(fn) {
  const sb = makeSandbox('gsdelgate-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

const agentLines = (dir) => fs.readFileSync(path.join(dir, 'AGENT.md'), 'utf8').replace(/\r\n/g, '\n')
  .split('\n');

// The Law IV keys OpenCode's permission.bash carries when armed: the two acts that delete the
// recovery net, and the protected-branch forms (one of each kind is enough to see the tier).
const LAW_IV_KEYS = ['git reflog expire*', 'git gc --prune*', 'git push --force* main', 'git branch -D main'];

test('the marker is written only when off, right under Active packs:, and reads back fail-closed', () => {
  withDir((d) => {
    const off = path.join(d, 'off');
    quiet(() => build(makeCfg({ noDeletionGate: true }), 'neutral', off));
    const lines = agentLines(off);
    const at = lines.indexOf('Deletion gate: off');
    assert.ok(at > 0, 'the Deletion gate: off line is missing or misspelled');
    assert.match(lines[at - 1], /^Active packs: /, 'the marker left the Active packs: block');
    assert.equal(gatesOfDir(off).deletionGate, false, 'read-back of an off install');

    const on = path.join(d, 'on');
    quiet(() => build(makeCfg(), 'neutral', on));
    assert.ok(!agentLines(on).some((l) => l.startsWith('Deletion gate:')), 'a default build grew a marker');
    assert.equal(gatesOfDir(on).deletionGate, true, 'no line reads as armed');

    // Anything but exactly `off` is armed: a gate is the thing a misread must never take away.
    const odd = path.join(d, 'odd');
    fs.mkdirSync(odd);
    fs.writeFileSync(path.join(odd, 'AGENT.md'), '# x\n\nActive packs: craft\nDeletion gate: maybe\n');
    assert.equal(gatesOfDir(odd).deletionGate, true, 'an unknown value disarmed the gate');
    assert.equal(gatesOfDir(path.join(d, 'nowhere')).deletionGate, true, 'no carrier disarmed the gate');
  });
});

test('the driver flag parses to the switch, and setupBuildArgs spells it only when off', () => {
  assert.equal(parseDriverArgs(['--emit', 'files']).noDeletionGate, false);
  assert.equal(parseDriverArgs(['--emit', 'files', '--no-deletion-gate']).noDeletionGate, true);
  const at = (gate) => setupBuildArgs('neutral', 'files', null, null, 'lean', 'peer', 'direct',
    null, undefined, null, undefined, null, { deletionGate: gate });
  for (const armed of [undefined, true, null]) {
    assert.ok(!at(armed).includes('--no-deletion-gate'), `${armed} grew the flag`);
  }
  assert.equal(at(false).at(-1), '--no-deletion-gate');
});

test('a global OpenCode install keeps the switch through a rebuild and drops only the Law IV tier', () => {
  withDir((d) => {
    const emit = (cfgDir, deletionGate) => quiet(() => emitGlobalInto('opencode', {
      theme: 'neutral', out: path.join(d, 'out'), cfgDir, footprint: 'lean', deletionGate,
    }));
    const offDir = path.join(d, 'off');
    emit(offDir, false);
    const p = installProfile('opencode', 'global', offDir);
    assert.equal(p.deletionGate, false);
    assert.ok(p.argv.includes('--no-deletion-gate'), 'the rebuild argv would re-arm the gate');
    const offBash = JSON.parse(fs.readFileSync(path.join(offDir, 'opencode.json'), 'utf8')).permission.bash;
    for (const k of LAW_IV_KEYS) assert.ok(!(k in offBash), `${k} was written with the gate off`);
    for (const k of ['git commit*', 'git push*']) {
      assert.equal(offBash[k], 'ask', `${k} is not Law IV's real-loss tier and must stay`);
    }

    const onDir = path.join(d, 'on');
    emit(onDir, null);
    const q = installProfile('opencode', 'global', onDir);
    assert.equal(q.deletionGate, true);
    assert.ok(!q.argv.includes('--no-deletion-gate'), 'an armed rebuild grew the flag');
    const onBash = JSON.parse(fs.readFileSync(path.join(onDir, 'opencode.json'), 'utf8')).permission.bash;
    for (const k of LAW_IV_KEYS) assert.equal(onBash[k], 'ask', `${k} is missing from an armed install`);
  });
});

// The same two installs, through the guard plugin each emit actually WROTE: proves the emitted
// layout (`<cfg>/plugins/` beside `<cfg>/AGENT.md`) and the plugin's own lookup agree, which the
// hand-placed copy in the cell further down cannot.
test('the guard an OpenCode emit wrote reads that install\'s switch', async () => {
  const sb = makeSandbox('gsdelemit-');
  const saved = process.env.GENESEED_HARNESS;
  delete process.env.GENESEED_HARNESS;
  try {
    const dirs = {};
    for (const [tag, deletionGate] of [['off', false], ['on', null]]) {
      dirs[tag] = path.join(sb.path, tag);
      quiet(() => emitGlobalInto('opencode', {
        theme: 'neutral', out: path.join(sb.path, 'out'), cfgDir: dirs[tag], footprint: 'lean', deletionGate,
      }));
    }
    const work = path.join(sb.path, 'work');
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, 'notes.txt'), 'x');
    const load = (d) => import(pathToFileURL(path.join(d, 'plugins', 'geneseed-guard.js')).href);
    const err = process.stderr.write;
    process.stderr.write = () => true;
    try {
      assert.equal(await guardBlocks(await load(dirs.on), 'rm notes.txt', work), true, 'the armed emit let a loss through');
      assert.equal(await guardBlocks(await load(dirs.off), 'rm notes.txt', work), false, 'the disarmed emit still blocked');
    } finally { process.stderr.write = err; }
  } finally {
    if (saved !== undefined) process.env.GENESEED_HARNESS = saved;
    sb.cleanup();
  }
});

test('the gate commands carry --no-deletion-gate only when off, on Claude, OpenClaude and Bob', () => {
  withDir((d) => {
    const cfg = path.join(d, 'cfg');
    const gateCmd = (host, gate) => {
      const groups = claudeHookGroups(cfg, hookRunnerEntry(), null, [], host, { deletionGate: gate });
      const verb = host === 'bob' ? ' tool-gate ' : ' git-gate ';
      return Object.values(groups).flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command)))
        .filter((c) => c.includes(verb));
    };
    for (const host of ['claude', 'openclaude', 'bob']) {
      const armed = gateCmd(host);
      assert.ok(armed.length, `${host}: no gate command found`);
      assert.ok(armed.every((c) => !c.includes('--no-deletion-gate')), `${host}: armed grew the flag`);
      const off = gateCmd(host, false);
      assert.ok(off.length && off.every((c) => /--no-deletion-gate/.test(c)), `${host}: ${off.join(' | ')}`);
    }
    // Claude's Skill|Agent|Task counter (`tool-gate` without `--host bob`) judges no shell
    // command, so it never needs the switch.
    const counter = Object.values(claudeHookGroups(cfg, hookRunnerEntry(), null, [], 'claude', { deletionGate: false }))
      .flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command))).filter((c) => c.includes(' tool-gate '));
    assert.ok(counter.every((c) => !c.includes('--no-deletion-gate')), counter.join(' | '));
  });
});

// The guard is copied verbatim into an install, so it reads the switch at load from the
// install's AGENT.md. Two installs, one plugin each — a module-level read means one import each.
async function guardAt(dir, marker) {
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-guard.js'),
    path.join(dir, 'plugins', 'geneseed-guard.js'));
  fs.writeFileSync(path.join(dir, 'AGENT.md'), `# x\n\nActive packs: craft${marker}\n`);
  return import(pathToFileURL(path.join(dir, 'plugins', 'geneseed-guard.js')).href);
}
async function guardBlocks(mod, command, cwd) {
  const hooks = await mod.default.server({ worktree: cwd, directory: cwd });
  try {
    await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command } });
    return false;
  } catch (e) {
    if (String(e?.message || '').startsWith('[geneseed-guard]')) return true;
    throw e;
  }
}

test('the OpenCode guard honours the carrier: loss blocks when armed, passes when off', async () => {
  const sb = makeSandbox('gsdelguard-');
  const saved = process.env.GENESEED_HARNESS;
  delete process.env.GENESEED_HARNESS;
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try {
    // Outside any git repository, so a removal of an existing file is a loss git cannot undo.
    const work = path.join(sb.path, 'work');
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, 'notes.txt'), 'x');
    const armed = await guardAt(path.join(sb.path, 'armed'), '');
    const off = await guardAt(path.join(sb.path, 'off'), '\nDeletion gate: off');
    assert.equal(await guardBlocks(armed, 'rm notes.txt', work), true, 'armed guard let a real loss through');
    assert.equal(await guardBlocks(off, 'rm notes.txt', work), false, 'disarmed guard still blocked the loss');
    // Everything else stays: a catastrophic command and a root-wide scan still block.
    assert.equal(await guardBlocks(off, 'rm -rf /', work), true, 'disarmed guard let rm -rf / through');
    assert.equal(await guardBlocks(off, 'find / -name x', work), true, 'disarmed guard let a root scan through');
    assert.ok(fs.existsSync(path.join(work, 'notes.txt')), 'the guard ran the command');
  } finally {
    process.stderr.write = err;
    if (saved !== undefined) process.env.GENESEED_HARNESS = saved;
    sb.cleanup();
  }
});

test('status names the switch only when off', () => {
  withDir((d) => {
    const base = {
      host: 'claude', scope: 'global', root: d, state: 'active', theme: 'neutral', footprint: 'lean',
      posture: 'peer', mode: 'direct', trust: 'standard', doctrines: ['craft'], excludeRules: [],
      excludeSkills: [],
    };
    const lines = statusLines({ ...statusData(), installs: [
      { ...base, host: 'claude', deletionGate: false },
      { ...base, host: 'bob', deletionGate: true },
    ] }, false);
    const row = (host) => lines.find((l) => l.includes(`${host}:global`)) || '';
    assert.match(row('claude'), /deletion gate: off \(Law IV text still binds\)/);
    assert.doesNotMatch(row('bob'), /deletion gate/);
  });
});

test('doctor --probe refuses-checks a disarmed gate on a root scan, an armed one on Law IV', () => {
  const run = 'node "x/geneseed-hook.mjs" git-gate --root "c"';
  assert.equal(badCommandFor(run), BAD_COMMAND);
  assert.equal(badCommandFor(`${run} --no-deletion-gate`), DISARMED_BAD_COMMAND);
  assert.equal(badCommandFor(`${run} --no-deletion-gate --host bob`), DISARMED_BAD_COMMAND);
  const ask = { status: 0, stdout: '{"permissionDecision":"ask"}', stderr: '' };
  const pass = { status: 0, stdout: '', stderr: '' };
  assert.equal(probeVerdict('claude', ask, pass, DISARMED_BAD_COMMAND), null);
  assert.match(probeVerdict('claude', pass, pass, DISARMED_BAD_COMMAND), /find \/ -name geneseed-probe/);
});
