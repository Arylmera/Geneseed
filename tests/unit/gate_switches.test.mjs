// `--no-secrets-gate` and `--no-done-gate` — Laws I and III's hook gates, switched off per install
// the way #319 switched Law IV's (user decision, 2026-10-18; `GATE_SWITCHES` in
// js/build/source.mjs). Written out, not recorded. Each cell states what a switch must reach:
//   1. the carrier says `Secrets gate: off` / `Done gate: off` ONLY when off, in law order beside
//      `Deletion gate: off`, and the reader fails closed (no line, or any value but `off`, is armed)
//   2. the switches survive a rebuild: `installProfile` reads them back and `setupBuildArgs`
//      re-spells them, eliding each when armed
//   3. the emitted hooks carry the flag only when off: `rule-gate` (Claude, OpenClaude) and Bob's
//      `tool-gate` get `--no-secrets-gate`, every `learn` gets `--no-done-gate` before `|| exit 0`
//   4. the OpenCode guard drops only Sealed Secrets (path block and content scan); the context
//      plugin drops only the done reminder
//   5. `status` names each switch only when off; `doctor --probe` is unaffected by both
// The hook verbs themselves are covered in hook_gates.test.mjs (`--no-secrets-gate` cells) and
// hook_done.test.mjs (`--no-done-gate`, `--no-test-note`); gate_verdicts.test.mjs holds the verdict
// rows of `--no-external-gate` and `--no-test-note`. Their plugin halves are proved here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from '../../js/build/bundle.mjs';
import { ROOT, makeCfg } from '../../js/build/source.mjs';
import { parseDriverArgs, emitGlobalInto, emitProjectInto } from '../../js/build/driver.mjs';
import { installProfile, setupBuildArgs } from '../../js/build/generate.mjs';
import { doctrinesOfDir, excludedRulesOfDir, gatesOfDir } from '../../js/hosts/installs.mjs';
import { GLOBAL_MANIFEST, carrierName, gateCarrierText } from '../../js/hosts/hosts.mjs';
import { buildActionCmds } from '../../js/web/actions.mjs';
import { webState } from '../../js/web/state.mjs';
import { claudeHookGroups } from '../../js/hosts/settings.mjs';
import { hookRunnerEntry } from '../../js/hosts/shim.mjs';
import { statusData, statusLines } from '../../js/inspect/status.mjs';
import { BAD_COMMAND, DISARMED_BAD_COMMAND, badCommandFor } from '../../js/inspect/checks-probe.mjs';
import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

// The global emit writes the machine hook shim into the environment's home.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

function quiet(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
}

function withDir(fn) {
  const sb = makeSandbox('gsgates-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

const agentLines = (dir) => fs.readFileSync(path.join(dir, 'AGENT.md'), 'utf8').replace(/\r\n/g, '\n')
  .split('\n');
// The ownership row (`law: null`, ruling D25) is a fourth switch under the same contract.
// `externalGate` and `testNote` are the fifth and sixth; neither flag nor marker ends in the old
// `-gate` / ` gate:` spelling alone (`--no-test-note`), so the filters below read every switch.
const ARMED = { secretsGate: true, doneGate: true, deletionGate: true, ownershipGate: true, externalGate: true, testNote: true };
const MARKER_RE = /^(Secrets gate|Done gate|Deletion gate|Ownership gate|External gate|Test note):/;
const isSwitchFlag = (t) => /^--no-.*-(gate|note)$/.test(t);

test('each marker is written only when off, in law order under Active packs:, and reads back fail-closed', () => {
  withDir((d) => {
    const all = path.join(d, 'all');
    quiet(() => build(makeCfg({ noSecretsGate: true, noDoneGate: true, noDeletionGate: true,
      noOwnershipGate: true, noExternalGate: true, noTestNote: true }), 'neutral', all));
    const lines = agentLines(all);
    const at = lines.indexOf('Secrets gate: off');
    assert.ok(at > 0, 'the Secrets gate: off line is missing or misspelled');
    assert.match(lines[at - 1], /^Active packs: /, 'the markers left the Active packs: block');
    assert.deepEqual(lines.slice(at, at + 6), ['Secrets gate: off', 'Done gate: off', 'Deletion gate: off',
      'Ownership gate: off', 'External gate: off', 'Test note: off']);
    assert.deepEqual(gatesOfDir(all), { secretsGate: false, doneGate: false, deletionGate: false, ownershipGate: false,
      externalGate: false, testNote: false });

    // One gate off writes that one line and reads back that one gate.
    const done = path.join(d, 'done');
    quiet(() => build(makeCfg({ noDoneGate: true }), 'neutral', done));
    assert.deepEqual(agentLines(done).filter((l) => MARKER_RE.test(l)), ['Done gate: off']);
    assert.deepEqual(gatesOfDir(done), { ...ARMED, doneGate: false });

    const on = path.join(d, 'on');
    quiet(() => build(makeCfg(), 'neutral', on));
    assert.ok(!agentLines(on).some((l) => MARKER_RE.test(l)), 'a default build grew a marker');
    assert.deepEqual(gatesOfDir(on), ARMED, 'no line reads as armed');

    // Anything but exactly `off` is armed: a gate is the thing a misread must never take away.
    const odd = path.join(d, 'odd');
    fs.mkdirSync(odd);
    fs.writeFileSync(path.join(odd, 'AGENT.md'), '# x\n\nActive packs: craft\nSecrets gate: maybe\nDone gate: Off\nExternal gate: of\nTest note: OFF\n');
    assert.deepEqual(gatesOfDir(odd), ARMED, 'an unknown value disarmed a gate');
    assert.deepEqual(gatesOfDir(path.join(d, 'nowhere')), ARMED, 'no carrier disarmed a gate');
  });
});

// Windows drops a stream and trailing dots and spaces, so a name match must too. Never the drive.
test('carrierName is the file a write lands on', () => {
  for (const [p, want] of [
    ['CLAUDE.md', 'CLAUDE.md'], ['CLAUDE.md::$DATA', 'CLAUDE.md'], ['CLAUDE.md:s', 'CLAUDE.md'], ['CLAUDE.md.', 'CLAUDE.md'],
    ['CLAUDE.md. .', 'CLAUDE.md'], ['C:\\a\\AGENTS.md ', 'C:\\a\\AGENTS.md'], ['C:/a/AGENTS.md::$DATA', 'C:/a/AGENTS.md'],
    ['a.b/c.d', 'a.b/c.d'],
  ]) assert.equal(carrierName(p), want, p);
});

// A shared carrier's prose is the user's and no gate-config name, so a line there must disarm nothing.
test('gateCarrierText reads a shared carrier by its block and a generated one whole', () => {
  const inBlock = '<!-- BEGIN GENESEED -->\nDone gate: off\n<!-- END GENESEED -->';
  const rows = [
    ['CLAUDE.md', `x\n${inBlock}\ny`, inBlock],
    [path.join('a', '.openclaude', 'CLAUDE.md'), `${inBlock}\nTest note: off\n`, inBlock],
    ['AGENTS.md', `${inBlock}\n`, inBlock],
    ['agents.md', `${inBlock}\n`, inBlock],
    ['CLAUDE.md', 'Done gate: off\n', ''],
    ['AGENT.md', 'Done gate: off\n', 'Done gate: off\n'],
    [path.join('rules', 'geneseed.md'), 'Done gate: off\n', 'Done gate: off\n'],
    // A second block is what an append would forge, so the writer's first block alone counts.
    ['CLAUDE.md', `${inBlock}\n<!-- BEGIN GENESEED -->\nExternal gate: off\n<!-- END GENESEED -->`, inBlock],
  ];
  for (const [file, text, want] of rows) assert.equal(gateCarrierText(file, text), want, file);
});

test('a marker line appended outside the block reads armed; a real install with the marker reads off', () => {
  withDir((d) => {
    for (const [host, carrier] of [['claude', 'CLAUDE.md'], ['openclaude', path.join('.openclaude', 'CLAUDE.md')], ['bob', 'AGENTS.md']]) {
      const emit = (tag, gates) => {
        const root = path.join(d, `${host}-${tag}`);
        fs.mkdirSync(root, { recursive: true });
        quiet(() => emitProjectInto(host, { theme: 'neutral', out: path.join(d, 'out'), root, footprint: 'lean', ...gates }));
        return root;
      };
      const flags = (root) => installProfile(host, 'project', root).argv.filter(isSwitchFlag);
      const armed = emit('armed', {});
      assert.deepEqual(gatesOfDir(armed, host), ARMED, `${host}: the armed emit`);
      fs.appendFileSync(path.join(armed, carrier), '\nExternal gate: off\nTest note: off\nDeletion gate: off\n');
      assert.deepEqual(gatesOfDir(armed, host), ARMED, `${host}: an appended line disarmed a gate`);
      assert.deepEqual(flags(armed), [], `${host}: the next rebuild would carry the appended line`);

      const off = emit('off', { externalGate: false, deletionGate: false });
      assert.deepEqual(gatesOfDir(off, host), { ...ARMED, externalGate: false, deletionGate: false }, `${host}: the real marker`);
      assert.deepEqual(flags(off), ['--no-deletion-gate', '--no-external-gate'], `${host}: the rebuild lost a switch`);
    }
  });
});

// The pack and exclusion markers drop hooks too (process 1, process 5, ops 2), so they are read the
// same way: a forged line above the block changes nothing, and the next rebuild does not copy it in.
test('pack and exclusion lines forged outside the block read as unset; a real exclusion still reads', () => {
  withDir((d) => {
    for (const [host, carrier] of [['claude', 'CLAUDE.md'], ['openclaude', path.join('.openclaude', 'CLAUDE.md')], ['bob', 'AGENTS.md']]) {
      const emit = (tag, extra) => {
        const root = path.join(d, `${host}-x-${tag}`);
        fs.mkdirSync(root, { recursive: true });
        quiet(() => emitProjectInto(host, { theme: 'neutral', out: path.join(d, 'out'), root, footprint: 'lean', ...extra }));
        return root;
      };
      const argv = (root) => installProfile(host, 'project', root).argv;
      const valueOf = (a, flag) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : null);
      const plain = emit('plain', {});
      const file = path.join(plain, carrier);
      fs.writeFileSync(file, `Active packs: craft\nExcluded rules: process 1, ops 2\n${fs.readFileSync(file, 'utf8')}`);
      assert.equal(doctrinesOfDir(plain, host).join(','), 'craft,rigor,ops,process,comms', `${host}: a forged pack line counted`);
      assert.deepEqual(excludedRulesOfDir(plain, host), [], `${host}: a forged exclusion counted`);
      // The rebuild spells both axes out: every pack, and `none` excluded.
      assert.equal(valueOf(argv(plain), '--exclude-rules'), 'none', `${host}: the rebuild would carry the forged exclusion`);
      assert.equal(valueOf(argv(plain), '--doctrines'), 'craft,rigor,ops,process,comms', `${host}: the rebuild would narrow the packs`);

      const real = emit('real', { excludeRules: ['process.1', 'ops.2'] });
      assert.deepEqual(excludedRulesOfDir(real, host), ['ops.2', 'process.1'], `${host}: the real exclusion`);
      assert.match(String(valueOf(argv(real), '--exclude-rules')), /ops\.2/, `${host}: the rebuild lost the exclusion`);
    }
  });
});

test('the context hook ignores a marker appended outside the block', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }));
    quiet(() => emitProjectInto('claude', { theme: 'neutral', out: path.join(d, 'out'), root: repo, footprint: 'lean' }));
    fs.appendFileSync(path.join(repo, 'CLAUDE.md'), '\nDone gate: off\n');
    const out = spawnHook(['context', '--root', path.join(repo, '.claude')], '',
      { cwd: repo, env: { ...process.env, GENESEED_ROOT: repo } }).stdout;
    assert.match(out, /^Done gate: inferred from package\.json/m, 'an appended line silenced the done line');
  });
});

test('a CRLF carrier\'s off line reads as off', () => {
  // Pinned, not fixed: a review read `(.+?)[ \t]*$` as capturing `off\r`, but a JS multiline
  // `$` also matches before `\r`, so the reader already agrees with the OpenCode plugins'
  // `\r?`. This cell keeps it that way if the pattern is ever rewritten.
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'AGENT.md'),
      '# x\r\n\r\nActive packs: craft\r\nSecrets gate: off\r\nDeletion gate: off \r\n');
    assert.deepEqual(gatesOfDir(d), { ...ARMED, secretsGate: false, deletionGate: false });
  });
});

test('the driver flags parse to the switches, and setupBuildArgs spells each only when off', () => {
  const p = parseDriverArgs(['--emit', 'files']);
  assert.deepEqual([p.noSecretsGate, p.noDoneGate], [false, false]);
  const q = parseDriverArgs(['--emit', 'files', '--no-secrets-gate', '--no-done-gate']);
  assert.deepEqual([q.noSecretsGate, q.noDoneGate], [true, true]);
  const at = (deletion, gates) => setupBuildArgs('neutral', 'files', null, null, 'lean', 'peer', 'direct',
    null, undefined, null, undefined, null, { ...gates, deletionGate: deletion });
  const flags = (argv) => argv.filter(isSwitchFlag);
  for (const armed of [undefined, {}, { secretsGate: true, doneGate: null }]) {
    assert.deepEqual(flags(at(undefined, armed)), [], `${JSON.stringify(armed)} grew a flag`);
  }
  assert.deepEqual(flags(at(true, { secretsGate: false })), ['--no-secrets-gate']);
  assert.deepEqual(flags(at(true, { doneGate: false })), ['--no-done-gate']);
  assert.deepEqual(flags(at(true, { externalGate: false })), ['--no-external-gate']);
  assert.deepEqual(flags(at(true, { testNote: false })), ['--no-test-note']);
  // Law order, so a Law IV-only argv still ends on `--no-deletion-gate` as #319 wrote it.
  assert.deepEqual(flags(at(false, { secretsGate: false, doneGate: false })),
    ['--no-secrets-gate', '--no-done-gate', '--no-deletion-gate']);
});

test('a global OpenCode install keeps both switches through a rebuild', () => {
  withDir((d) => {
    const emit = (cfgDir, gates) => quiet(() => emitGlobalInto('opencode', {
      theme: 'neutral', out: path.join(d, 'out'), cfgDir, footprint: 'lean', ...gates,
    }));
    const offDir = path.join(d, 'off');
    emit(offDir, { secretsGate: false, doneGate: false, externalGate: false, testNote: false });
    const p = installProfile('opencode', 'global', offDir);
    assert.deepEqual([p.secretsGate, p.doneGate, p.deletionGate], [false, false, true]);
    assert.deepEqual([p.externalGate, p.testNote], [false, false]);
    assert.deepEqual(p.argv.filter(isSwitchFlag), ['--no-secrets-gate', '--no-done-gate', '--no-external-gate', '--no-test-note'],
      'the rebuild argv would re-arm a gate (or disarm Law IV)');

    const onDir = path.join(d, 'on');
    emit(onDir, {});
    const q = installProfile('opencode', 'global', onDir);
    assert.deepEqual([q.secretsGate, q.doneGate], [true, true]);
    assert.ok(!q.argv.some(isSwitchFlag), 'an armed rebuild grew a flag');
  });
});

test('the hook commands carry --no-secrets-gate / --no-done-gate only when off', () => {
  withDir((d) => {
    const cfg = path.join(d, 'cfg');
    const cmds = (host, gates) => Object.entries(claudeHookGroups(cfg, hookRunnerEntry(), null, [], host, gates))
      .flatMap(([event, gs]) => gs.flatMap((g) => g.hooks.map((h) => ({ event, matcher: g.matcher, command: h.command }))));
    for (const host of ['claude', 'openclaude', 'bob']) {
      const armed = cmds(host);
      assert.ok(armed.every((c) => !/--no-(secrets|done)-gate/.test(c.command)), `${host}: armed grew a flag`);
      const off = cmds(host, { secretsGate: false, doneGate: false });
      const secretGate = off.filter((c) => (host === 'bob' ? / tool-gate /.test(c.command) : / rule-gate /.test(c.command)));
      assert.ok(secretGate.length && secretGate.every((c) => c.command.includes('--no-secrets-gate')),
        `${host}: ${secretGate.map((c) => c.command).join(' | ')}`);
      const learn = off.filter((c) => / learn /.test(c.command));
      assert.deepEqual(learn.map((c) => c.event).sort(),
        host === 'bob' ? ['Stop'] : ['PreCompact', 'Stop', 'SubagentStop'], `${host}: learn events`);
      // Before `|| exit 0`, or the shell would read the flag as a second command.
      assert.ok(learn.every((c) => / --no-done-gate \|\| exit 0$/.test(c.command)), learn.map((c) => c.command).join(' | '));
      // Each switch reaches only its own verb.
      assert.ok(off.filter((c) => / (git-gate|context|learn) /.test(c.command))
        .every((c) => !c.command.includes('--no-secrets-gate')), `${host}: secrets flag leaked`);
      assert.ok(off.filter((c) => !/ learn /.test(c.command))
        .every((c) => !c.command.includes('--no-done-gate')), `${host}: done flag leaked`);
    }
    // Claude's Skill|Agent|Task counter judges no write, so it never needs the switch.
    const counter = cmds('claude', { secretsGate: false }).filter((c) => c.matcher === 'Skill|Agent|Task');
    assert.ok(counter.length && counter.every((c) => !c.command.includes('--no-secrets-gate')));
    // The ownership switch, the same way: only the write gate (Claude/OpenClaude rule-gate, Bob's
    // tool-gate) carries `--no-ownership-gate`, and only when the install switched it off.
    for (const host of ['claude', 'openclaude', 'bob']) {
      const writeGate = (c) => (host === 'bob' ? / tool-gate /.test(c.command) : / rule-gate /.test(c.command));
      assert.ok(cmds(host).every((c) => !c.command.includes('--no-ownership-gate')), `${host}: armed grew the flag`);
      const off = cmds(host, { ownershipGate: false });
      // Last of the flags: only OpenClaude's launch-failure tail (`|| printf …`) may follow it.
      const last = host === 'openclaude' ? / --no-ownership-gate \|\| printf '%s' '[^']*'$/ : / --no-ownership-gate$/;
      assert.ok(off.filter(writeGate).length && off.filter(writeGate).every((c) => last.test(c.command)),
        `${host}: ${off.filter(writeGate).map((c) => c.command).join(' | ')}`);
      assert.ok(off.filter((c) => !writeGate(c)).every((c) => !c.command.includes('--no-ownership-gate')),
        `${host}: the ownership flag leaked past the write gate`);
    }
    // The two later switches, stated per verb: which verbs each must reach, and none other.
    for (const host of ['claude', 'openclaude', 'bob']) {
      const verb = (c) => / (git-gate|rule-gate|tool-gate|learn|context|activity) /.exec(c.command)?.[1];
      const carrying = (gates, flag) => [...new Set(cmds(host, gates).filter((c) => c.command.includes(flag)).map(verb))].sort();
      assert.deepEqual(carrying({}, '--no-external-gate'), [], `${host}: armed grew the external flag`);
      assert.deepEqual(carrying({}, '--no-test-note'), [], `${host}: armed grew the note flag`);
      assert.deepEqual(carrying({ externalGate: false }, '--no-external-gate'),
        host === 'bob' ? ['tool-gate'] : ['git-gate', 'rule-gate'], `${host}: external`);
      assert.deepEqual(carrying({ testNote: false }, '--no-test-note'),
        host === 'bob' ? ['learn', 'tool-gate'] : ['learn', 'rule-gate'], `${host}: note`);
      assert.ok(cmds(host, { testNote: false }).filter((c) => / learn /.test(c.command))
        .every((c) => / --no-test-note \|\| exit 0$/.test(c.command)), `${host}: the flag sits after || exit 0`);
      // Claude's Skill|Agent|Task tool-gate judges no write, so neither flag belongs there.
      assert.ok(cmds(host, { externalGate: false, testNote: false }).filter((c) => c.matcher === 'Skill|Agent|Task')
        .every((c) => !/--no-(external-gate|test-note)/.test(c.command)), `${host}: the counter got a flag`);
    }
  });
});

// The plugins are copied verbatim into an install and read its AGENT.md at load (through
// $GENESEED_HARNESS here), so each install is its own copy and its own import.
async function pluginAt(dir, name, marker) {
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'adapters', 'opencode', 'plugins', name), path.join(dir, 'plugins', name));
  fs.writeFileSync(path.join(dir, 'AGENT.md'), `# x\n\nActive packs: craft, rigor, ops, process, comms${marker}\n`);
  const saved = process.env.GENESEED_HARNESS;
  process.env.GENESEED_HARNESS = dir;
  try {
    return await import(pathToFileURL(path.join(dir, 'plugins', name)).href);
  } finally {
    if (saved === undefined) delete process.env.GENESEED_HARNESS; else process.env.GENESEED_HARNESS = saved;
  }
}
async function guardBlocks(mod, tool, args, cwd) {
  const hooks = await mod.default.server({ worktree: cwd, directory: cwd });
  try {
    await hooks['tool.execute.before']({ tool }, { args });
    return false;
  } catch (e) {
    if (String(e?.message || '').startsWith('[geneseed-guard]')) return true;
    throw e;
  }
}

test('the OpenCode guard drops only Sealed Secrets when the carrier says so', async () => {
  const sb = makeSandbox('gssecguard-');
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const work = path.join(sb.path, 'work');
    fs.mkdirSync(path.join(work, '.git'), { recursive: true });
    fs.mkdirSync(path.join(work, '.geneseed'), { recursive: true });
    fs.writeFileSync(path.join(work, '.geneseed', 'protected-checks.txt'), 'tests/\n');
    const secret = { filePath: path.join(work, 'src', 'a.js'), content: 'const k = "AKIAIOSFODNN7EXAMPLE";' };
    const keyFile = { filePath: path.join(work, 'id_rsa'), content: 'x' };
    const armed = await pluginAt(path.join(sb.path, 'armed'), 'geneseed-guard.js', '');
    const off = await pluginAt(path.join(sb.path, 'off'), 'geneseed-guard.js', '\nSecrets gate: off');
    assert.equal(await guardBlocks(armed, 'write', secret, work), true, 'armed guard let a credential through');
    assert.equal(await guardBlocks(armed, 'write', keyFile, work), true, 'armed guard let a key file through');
    assert.equal(await guardBlocks(off, 'write', secret, work), false, 'disarmed guard still scanned content');
    assert.equal(await guardBlocks(off, 'write', keyFile, work), false, 'disarmed guard still blocked the key file');
    // Everything else stays: a protected check, a catastrophic command, a real loss.
    assert.equal(await guardBlocks(off, 'write', { ...secret, filePath: path.join(work, 'tests', 'a.test.js') }, work),
      true, 'disarmed guard let a protected check be written');
    assert.equal(await guardBlocks(off, 'bash', { command: 'rm -rf /' }, work), true, 'disarmed guard let rm -rf / through');
  } finally {
    process.stderr.write = err;
    sb.cleanup();
  }
});

test('the OpenCode guard drops the ownership gate when the carrier says `Ownership gate: off`', async () => {
  const sb = makeSandbox('gsownguard-');
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const app = path.join(sb.path, 'app');
    fs.mkdirSync(path.join(app, '.git'), { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), '{}');
    const first = async (mod) => {
      const hooks = await mod.default.server({ worktree: app, directory: app });
      try {
        await hooks['tool.execute.before']({ tool: 'write', sessionID: 's1' },
          { args: { filePath: path.join(app, 'a.js'), content: 'x' } });
        return false;
      } catch (e) {
        if (String(e?.message || '').startsWith('[geneseed-guard]')) return true;
        throw e;
      }
    };
    const armed = await pluginAt(path.join(sb.path, 'armed'), 'geneseed-guard.js', '');
    const off = await pluginAt(path.join(sb.path, 'off'), 'geneseed-guard.js', '\nOwnership gate: off');
    assert.equal(await first(armed), true, 'the armed guard let the first write of an application through');
    assert.equal(await first(off), false, 'the disarmed guard still refused the first write');
  } finally {
    process.stderr.write = err;
    sb.cleanup();
  }
});

// `--no-external-gate` on OpenCode, every path of the guard: the refusals on V1 and V2, and V2's
// `evaluate` ask. Every armed/off pair runs on one fixture, so the marker is the only difference.
test('the OpenCode guard drops only External Gate when the carrier says so', async () => {
  const sb = makeSandbox('gsextguard-');
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const work = path.join(sb.path, 'work');
    fs.mkdirSync(path.join(work, '.git'), { recursive: true });
    fs.mkdirSync(path.join(work, '.geneseed'), { recursive: true });
    fs.writeFileSync(path.join(work, '.geneseed', 'protected-checks.txt'), 'ci.yml\n');
    const check = { filePath: path.join(work, 'ci.yml'), content: 'x' };
    const conf = path.join(work, 'opencode.json');
    const armed = await pluginAt(path.join(sb.path, 'armed'), 'geneseed-guard.js', '');
    const off = await pluginAt(path.join(sb.path, 'off'), 'geneseed-guard.js', '\nExternal gate: off');
    assert.equal(await guardBlocks(armed, 'write', check, work), true, 'armed: a protected check was written');
    assert.equal(await guardBlocks(off, 'write', check, work), false, 'off: the guard still refused the check');
    // Another host's excludes list: a file only `gateConfig` refuses, with no native ask behind it.
    const excludes = { filePath: path.join(work, '.claude', 'excludes.json'), content: '{}' };
    assert.equal(await guardBlocks(armed, 'write', excludes, work), true, 'armed: gate configuration was written');
    assert.equal(await guardBlocks(off, 'write', excludes, work), false, 'off: the guard still refused gate configuration');
    // A carrier's block: the armed guard refuses a change to it, and the rule goes with the switch.
    const block = path.join(work, 'CLAUDE.md');
    fs.writeFileSync(block, '<!-- BEGIN GENESEED -->\nDone gate: on\n<!-- END GENESEED -->\n');
    const flip = { filePath: block, oldString: 'Done gate: on', newString: 'Done gate: off' };
    assert.equal(await guardBlocks(armed, 'edit', flip, work), true, 'armed: the block moved unrefused');
    assert.equal(await guardBlocks(off, 'edit', flip, work), false, 'off: the carrier rule outlived the switch');
    const shell = { command: 'echo x > ci.yml' };
    assert.equal(await guardBlocks(armed, 'bash', shell, work), true, 'armed: a shell write reached the check');
    assert.equal(await guardBlocks(off, 'bash', shell, work), false, 'off: the shell path still refused');
    const shellConf = { command: `echo x > "${conf.replace(/\\/g, '/')}"` };
    assert.equal(await guardBlocks(armed, 'bash', shellConf, work), true, 'armed: a shell write reached opencode.json');
    assert.equal(await guardBlocks(off, 'bash', shellConf, work), false, 'off: the shell path still refused opencode.json');
    // Every other gate stays: a secret, a catastrophic command.
    const secret = { filePath: path.join(work, 'a.js'), content: 'const k = "AKIAIOSFODNN7EXAMPLE";' };
    assert.equal(await guardBlocks(off, 'write', secret, work), true, 'off: a credential got through');
    assert.equal(await guardBlocks(off, 'bash', { command: 'rm -rf /' }, work), true, 'off: rm -rf / got through');
    // The stream refusal keeps its `rigor-5` ledger key but protects every path gate, so it stays.
    if (process.platform === 'win32') {
      assert.equal(await guardBlocks(off, 'write', { filePath: path.join(work, 'a.js:s'), content: 'x' }, work), true,
        'off: an NTFS stream path got through');
    }

    // V2: the tool hook renames a refused call, and `evaluate` asks over a gate file.
    const v2 = async (mod) => {
      const hooks = { tool: {}, permission: {} };
      await mod.default.setup({
        location: { directory: work, project: { directory: work } },
        session: { get: async () => ({}), synthetic: async () => undefined },
        tool: { hook: async (n, cb) => { hooks.tool[n] = cb; return { dispose: async () => {} }; } },
        permission: { hook: async (n, cb) => { hooks.permission[n] = cb; return { dispose: async () => {} }; } },
      });
      return hooks;
    };
    const refused = async (hooks) => {
      const event = { tool: 'write', id: 'c', sessionID: 's', input: check };
      await hooks.tool['execute.before'](event);
      return event.tool !== 'write';
    };
    const asked = async (hooks, file) => {
      const event = { sessionID: 's', action: 'edit', resources: [file], effect: 'allow', source: { type: 'tool', messageID: 'm', id: 'c' } };
      await hooks.permission.evaluate(event);
      return event.effect === 'ask';
    };
    const [v2armed, v2off] = [await v2(armed), await v2(off)];
    assert.equal(await refused(v2armed), true, 'V2 armed: the check was not refused');
    assert.equal(await refused(v2off), false, 'V2 off: the check was still refused');
    assert.equal(await asked(v2armed, conf), true, 'V2 armed: evaluate did not ask over opencode.json');
    assert.equal(await asked(v2off, conf), false, 'V2 off: evaluate still asked over opencode.json');
    // The store branch of `evaluate` is Persist Insight's, so the switch leaves it asking.
    const store = path.join(work, 'user-rules.md');
    assert.equal(await asked(v2armed, store), true, 'V2 armed: evaluate did not ask over the rule store');
    assert.equal(await asked(v2off, store), true, 'V2 off: the switch took the store ask with it');
  } finally {
    process.stderr.write = err;
    sb.cleanup();
  }
});

// `--no-test-note` on OpenCode, V1's transform and V2's context hook: the twin of the hook's note.
// The done reminder rides the same transform, so its survival shows the switch took only the note.
test('the OpenCode context plugin drops only the weakened-test reminder when the carrier says so', async () => {
  const sb = makeSandbox('gsnotectx-');
  const savedWiki = process.env.GENESEED_WIKI;
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const repo = path.join(sb.path, 'repo');
    fs.mkdirSync(path.join(repo, '.geneseed'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.geneseed', 'done-checks.txt'), 'npm run lint\n');
    fs.writeFileSync(path.join(sb.path, 'geneseed-wiki.jsonc'), '{ "wikis": [] }');
    process.env.GENESEED_WIKI = path.join(sb.path, 'geneseed-wiki.jsonc');
    const client = { session: { get: async () => ({ data: { title: 'user session' } }), messages: async () => [] } };
    const user = (id) => ({ info: { id, role: 'user', sessionID: 's1' }, parts: [{ type: 'text', text: 'go' }] });
    const test = path.join(repo, 'a.test.js');
    const edit = { info: { id: 'a1', role: 'assistant', sessionID: 's1' },
      parts: [{ type: 'tool', tool: 'edit', state: { status: 'completed', input: { filePath: test } } }] };
    const said = async (tag, marker) => {
      const dir = path.join(sb.path, tag);
      const mod = await pluginAt(dir, 'geneseed-context.js', marker);
      const saved = process.env.GENESEED_HARNESS;
      process.env.GENESEED_HARNESS = dir;
      try {
        const hooks = await mod.GeneseedContext({ client, directory: repo, worktree: repo });
        await hooks['tool.execute.before']({ tool: 'edit', sessionID: 's1' },
          { args: { filePath: test, oldString: 'it("x", f)', newString: 'it.skip("x", f)' } });
        const output = { messages: [user('u1'), edit, user('u2')] };
        await hooks['experimental.chat.messages.transform']({}, output);
        const text = output.messages.flatMap((m) => (m.parts ?? []).map((p) => String(p.text ?? ''))).join('\n');
        return { note: text.includes('test weakened this turn'), done: text.includes('Verify Before Asserting') };
      } finally {
        if (saved === undefined) delete process.env.GENESEED_HARNESS; else process.env.GENESEED_HARNESS = saved;
      }
    };
    assert.deepEqual(await said('armed', ''), { note: true, done: true }, 'the armed plugin');
    assert.deepEqual(await said('off', '\nTest note: off'), { note: false, done: true }, 'the note switch');
    // `--no-done-gate` keeps silencing this line, as it did.
    assert.deepEqual(await said('doneoff', '\nDone gate: off'), { note: false, done: false }, 'the done switch');
  } finally {
    process.stderr.write = err;
    if (savedWiki === undefined) delete process.env.GENESEED_WIKI; else process.env.GENESEED_WIKI = savedWiki;
    sb.cleanup();
  }
});

test('the OpenCode context plugin drops only the done reminder when the carrier says so', async () => {
  const sb = makeSandbox('gsdonectx-');
  const savedWiki = process.env.GENESEED_WIKI;
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const repo = path.join(sb.path, 'repo');
    fs.mkdirSync(path.join(repo, '.geneseed'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });   // the gate needs a git root
    fs.writeFileSync(path.join(repo, '.geneseed', 'done-checks.txt'), 'npm run lint\n');
    fs.writeFileSync(path.join(sb.path, 'geneseed-wiki.jsonc'), '{ "wikis": [] }');
    process.env.GENESEED_WIKI = path.join(sb.path, 'geneseed-wiki.jsonc');
    const client = { session: { get: async () => ({ data: { title: 'user session' } }), messages: async () => [] } };
    const user = (id) => ({ info: { id, role: 'user', sessionID: 's1' }, parts: [{ type: 'text', text: 'go' }] });
    const edit = { info: { id: 'a1', role: 'assistant', sessionID: 's1' },
      parts: [{ type: 'tool', tool: 'edit', state: { status: 'completed', input: { filePath: path.join(repo, 'a.js') } } }] };
    const reminded = async (mod) => {
      const saved = process.env.GENESEED_HARNESS;
      process.env.GENESEED_HARNESS = mod.dir;
      try {
        const hooks = await mod.GeneseedContext({ client, directory: repo, worktree: repo });
        const output = { messages: [user('u1'), edit, user('u2')] };
        await hooks['experimental.chat.messages.transform']({}, output);
        return output.messages.some((m) => (m.parts ?? []).some((p) => String(p.text ?? '').includes('Verify Before Asserting')));
      } finally {
        if (saved === undefined) delete process.env.GENESEED_HARNESS; else process.env.GENESEED_HARNESS = saved;
      }
    };
    const at = async (tag, marker) => {
      const dir = path.join(sb.path, tag);
      return { dir, ...(await pluginAt(dir, 'geneseed-context.js', marker)) };
    };
    assert.equal(await reminded(await at('armed', '')), true, 'the armed plugin forgot the reminder');
    assert.equal(await reminded(await at('off', '\nDone gate: off')), false, 'the disarmed plugin still reminded');
  } finally {
    process.stderr.write = err;
    if (savedWiki === undefined) delete process.env.GENESEED_WIKI; else process.env.GENESEED_WIKI = savedWiki;
    sb.cleanup();
  }
});

// The Claude/Bob/OpenClaude twin of the row above: the `context` hook reads the same carrier
// line with the same pattern, and a disarmed install's session starts without the done line.
test('the context hook drops the done gate line when the carrier says so', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }));
    const armed = path.join(d, 'armed');
    const off = path.join(d, 'off');
    quiet(() => build(makeCfg({}), 'neutral', armed));
    quiet(() => build(makeCfg({ noDoneGate: true }), 'neutral', off));
    const ctx = (root) => spawnHook(['context', '--root', root], '',
      { cwd: repo, env: { ...process.env, GENESEED_ROOT: repo } }).stdout;
    assert.match(ctx(armed), /^Done gate: inferred from package\.json — npm run lint \(advisory\)\r?$/m,
      'the armed install lost the done line');
    assert.doesNotMatch(ctx(off), /Done gate:/, 'the disarmed install still printed the done line');
  });
});

// The ownership decline reminder (ruling D4) under the same contract: a declined application gets
// the line from an armed install, and none from one built `--no-ownership-gate`. The decline
// line itself is `Setup: declined <date>` in the repo's personal `.geneseed/ownership.md`.
const DECLINED_LINE = 'Ownership: setup declined since 2026-10-29 — not set up; say "set up ownership" to run it';
function declinedApp(d) {
  const repo = path.join(d, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.geneseed'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  fs.writeFileSync(path.join(repo, '.geneseed', 'ownership.md'), 'Setup: declined 2026-10-29\n');
  return repo;
}

test('the context hook prints the ownership decline line only when the gate is armed', () => {
  withDir((d) => {
    const repo = declinedApp(d);
    const armed = path.join(d, 'armed');
    const off = path.join(d, 'off');
    quiet(() => build(makeCfg({}), 'neutral', armed));
    quiet(() => build(makeCfg({ noOwnershipGate: true }), 'neutral', off));
    const ctx = (root) => spawnHook(['context', '--root', root], '',
      { cwd: repo, env: { ...process.env, GENESEED_ROOT: repo } }).stdout.split(/\r?\n/);
    assert.ok(ctx(armed).includes(DECLINED_LINE), 'the armed install lost the decline line');
    assert.ok(!ctx(off).some((l) => l.startsWith('Ownership:')), 'the disarmed install still printed it');
  });
});

test('the OpenCode context plugin prints the ownership decline line only when the gate is armed', async () => {
  const sb = makeSandbox('gsownctx-');
  const savedWiki = process.env.GENESEED_WIKI;
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const repo = declinedApp(sb.path);
    fs.writeFileSync(path.join(sb.path, 'geneseed-wiki.jsonc'), '{ "wikis": [] }');
    process.env.GENESEED_WIKI = path.join(sb.path, 'geneseed-wiki.jsonc');
    const client = { session: { get: async () => ({ data: { title: 'user session' } }), messages: async () => [] } };
    const lines = async (tag, marker) => {
      const dir = path.join(sb.path, tag);
      const mod = await pluginAt(dir, 'geneseed-context.js', marker);
      const saved = process.env.GENESEED_HARNESS;
      process.env.GENESEED_HARNESS = dir;
      try {
        const hooks = await mod.GeneseedContext({ client, directory: repo, worktree: repo });
        const output = { messages: [{ info: { id: 'u1', role: 'user', sessionID: 's1' }, parts: [{ type: 'text', text: 'go' }] }] };
        await hooks['experimental.chat.messages.transform']({}, output);
        return output.messages.flatMap((m) => (m.parts ?? []).flatMap((p) => String(p.text ?? '').split('\n')));
      } finally {
        if (saved === undefined) delete process.env.GENESEED_HARNESS; else process.env.GENESEED_HARNESS = saved;
      }
    };
    assert.ok((await lines('armed', '')).includes(DECLINED_LINE), 'the armed plugin lost the decline line');
    assert.ok(!(await lines('off', '\nOwnership gate: off')).some((l) => l.startsWith('Ownership:')),
      'the disarmed plugin still printed it');
  } finally {
    process.stderr.write = err;
    if (savedWiki === undefined) delete process.env.GENESEED_WIKI; else process.env.GENESEED_WIKI = savedWiki;
    sb.cleanup();
  }
});

// Ruling D6: the carrier's ownership proposal is prose outside any LEAN block, so the hook
// standing down alone left the model proposing the setup. A `--no-ownership-gate` install renders
// none of it, at either footprint; an armed one keeps it, with the three answers.
test('the carrier drops the ownership proposal when built --no-ownership-gate, at both footprints', () => {
  withDir((d) => {
    for (const footprint of ['lean', 'full']) {
      const armed = path.join(d, `armed-${footprint}`);
      const off = path.join(d, `off-${footprint}`);
      quiet(() => build(makeCfg({}), 'neutral', armed, { footprint }));
      quiet(() => build(makeCfg({ noOwnershipGate: true }), 'neutral', off, { footprint }));
      const text = (dir) => agentLines(dir).join('\n');
      assert.match(text(armed), /With no section at all, propose it once before the first\nwrite/, `${footprint}: armed`);
      assert.match(text(armed), /set it up now, skip this session, or skip in this repo until\nasked/,
        `${footprint}: armed names the three answers`);
      assert.match(text(armed), /`Ownership: setup declined …` means propose nothing:\nrepeat it once, verbatim/,
        `${footprint}: armed names the reminder`);
      assert.doesNotMatch(text(off), /With no section at all|Setup: declined|\/document-project` once/, `${footprint}: off`);
      assert.match(text(off), /workers get only approved decisions\.\n/, `${footprint}: off keeps the pointer`);
    }
  });
});

test('status names each switch only when off, #319\'s wording unchanged', () => {
  withDir((d) => {
    const base = {
      host: 'claude', scope: 'global', root: d, state: 'active', theme: 'neutral', footprint: 'lean',
      posture: 'peer', mode: 'direct', trust: 'standard', doctrines: ['craft'], excludeRules: [],
      excludeSkills: [],
    };
    const lines = statusLines({ ...statusData(), installs: [
      { ...base, host: 'claude', secretsGate: false, doneGate: false, deletionGate: false, ownershipGate: false,
        externalGate: false, testNote: false },
      { ...base, host: 'bob', ...ARMED },
    ] }, false);
    const row = (host) => lines.find((l) => l.includes(`${host}:global`)) || '';
    assert.match(row('claude'), /secrets gate: off \(Law I text still binds\)/);
    assert.match(row('claude'), /done gate: off \(Law III text still binds\)/);
    assert.match(row('claude'), /deletion gate: off \(Law IV text still binds\)/);
    // The ownership gate is no law's gate, so it names none.
    assert.match(row('claude'), /ownership gate: off(?! \()/);
    // No text claim for either: rigor 5's text may be excluded, and the note is advisory.
    assert.match(row('claude'), /external gate: off(?! \()/);
    assert.match(row('claude'), /test note: off(?! \()/);
    assert.doesNotMatch(row('bob'), / gate: off|test note/);
  });
});

test('doctor --probe is unaffected by the switches', () => {
  // The probe sends a shell command to git-gate/tool-gate; neither switch judges one.
  const run = 'node "x/geneseed-hook.mjs" tool-gate --root "c" --host bob';
  assert.equal(badCommandFor(`${run} --no-secrets-gate`), BAD_COMMAND);
  assert.equal(badCommandFor(`${run} --no-secrets-gate --no-deletion-gate`), DISARMED_BAD_COMMAND);
  assert.equal(badCommandFor(`${run} --no-external-gate --no-test-note`), BAD_COMMAND);
});

// The console's Build re-emits the viewed install. It used to build its argv from the axes it
// carried itself — no gates, `--exclude-rules none`, no skills — so a Build silently re-armed a
// switched-off gate and handed back every excluded rule and skill. It now takes the argv the
// install's profile owns (`installProfile`), with only the theme the picker chose swapped in.
test('a console Build keeps a switched-off gate, an excluded rule and an excluded skill', () => {
  withDir((d) => {
    const cfgDir = path.join(d, 'oc');
    quiet(() => emitGlobalInto('opencode', {
      theme: 'neutral', out: path.join(d, 'out'), cfgDir, footprint: 'lean',
      doneGate: false, excludeRules: ['process.5'], excludeSkills: ['daydream'],
    }));
    // What makes the console call it deployed (`deployed(state)`): the build writes it, the
    // render alone does not.
    fs.writeFileSync(path.join(cfgDir, GLOBAL_MANIFEST), '{"owned": []}');
    const st = webState('neutral', cfgDir);
    st.selectView(cfgDir);
    const [cmd] = buildActionCmds(st, { theme: 'imperial', emit: 'opencode-global' });
    const argv = cmd.slice(2);
    const after = (flag) => argv[argv.indexOf(flag) + 1];
    assert.equal(after('--theme'), 'imperial', 'the picked theme did not reach the argv');
    assert.equal(after('--emit'), 'opencode-global');
    assert.equal(after('--exclude-rules'), 'process.5', `the excluded rule was dropped: ${argv.join(' ')}`);
    assert.equal(after('--exclude-skills'), 'daydream', `the excluded skill was dropped: ${argv.join(' ')}`);
    assert.deepEqual(argv.filter(isSwitchFlag), ['--no-done-gate'],
      `the Build re-armed the done gate (or disarmed another): ${argv.join(' ')}`);
    assert.equal(after('--config-dir'), cfgDir, 'a global Build must name its own dir');
  });
});
