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
// hook_done.test.mjs (`--no-done-gate`).
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
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { buildActionCmds } from '../../js/web/actions.mjs';
import { webState } from '../../js/web/state.mjs';
import { claudeHookGroups } from '../../js/hosts/settings.mjs';
import { hookRunnerEntry } from '../../js/hosts/shim.mjs';
import { statusData, statusLines } from '../../js/inspect/status.mjs';
import { BAD_COMMAND, DISARMED_BAD_COMMAND, badCommandFor } from '../../js/inspect/checks-probe.mjs';
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
  const sb = makeSandbox('gsgates-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

const agentLines = (dir) => fs.readFileSync(path.join(dir, 'AGENT.md'), 'utf8').replace(/\r\n/g, '\n')
  .split('\n');
// The ownership row (`law: null`, ruling D25) is a fourth switch under the same contract.
const ARMED = { secretsGate: true, doneGate: true, deletionGate: true, ownershipGate: true };

test('each marker is written only when off, in law order under Active packs:, and reads back fail-closed', () => {
  withDir((d) => {
    const all = path.join(d, 'all');
    quiet(() => build(makeCfg({ noSecretsGate: true, noDoneGate: true, noDeletionGate: true,
      noOwnershipGate: true }), 'neutral', all));
    const lines = agentLines(all);
    const at = lines.indexOf('Secrets gate: off');
    assert.ok(at > 0, 'the Secrets gate: off line is missing or misspelled');
    assert.match(lines[at - 1], /^Active packs: /, 'the markers left the Active packs: block');
    assert.deepEqual(lines.slice(at, at + 4),
      ['Secrets gate: off', 'Done gate: off', 'Deletion gate: off', 'Ownership gate: off']);
    assert.deepEqual(gatesOfDir(all), { secretsGate: false, doneGate: false, deletionGate: false, ownershipGate: false });

    // One gate off writes that one line and reads back that one gate.
    const done = path.join(d, 'done');
    quiet(() => build(makeCfg({ noDoneGate: true }), 'neutral', done));
    assert.deepEqual(agentLines(done).filter((l) => /^(Secrets|Done|Deletion|Ownership) gate:/.test(l)), ['Done gate: off']);
    assert.deepEqual(gatesOfDir(done), { ...ARMED, doneGate: false });

    const on = path.join(d, 'on');
    quiet(() => build(makeCfg(), 'neutral', on));
    assert.ok(!agentLines(on).some((l) => /^(Secrets|Done|Deletion|Ownership) gate:/.test(l)), 'a default build grew a marker');
    assert.deepEqual(gatesOfDir(on), ARMED, 'no line reads as armed');

    // Anything but exactly `off` is armed: a gate is the thing a misread must never take away.
    const odd = path.join(d, 'odd');
    fs.mkdirSync(odd);
    fs.writeFileSync(path.join(odd, 'AGENT.md'), '# x\n\nActive packs: craft\nSecrets gate: maybe\nDone gate: Off\n');
    assert.deepEqual(gatesOfDir(odd), ARMED, 'an unknown value disarmed a gate');
    assert.deepEqual(gatesOfDir(path.join(d, 'nowhere')), ARMED, 'no carrier disarmed a gate');
  });
});

test('a CRLF carrier\'s off line reads as off', () => {
  // Pinned, not fixed: a review read `(.+?)[ \t]*$` as capturing `off\r`, but a JS multiline
  // `$` also matches before `\r`, so the reader already agrees with the OpenCode plugins'
  // `\r?`. This cell keeps it that way if the pattern is ever rewritten.
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'AGENT.md'),
      '# x\r\n\r\nActive packs: craft\r\nSecrets gate: off\r\nDeletion gate: off \r\n');
    assert.deepEqual(gatesOfDir(d), { secretsGate: false, doneGate: true, deletionGate: false, ownershipGate: true });
  });
});

test('the driver flags parse to the switches, and setupBuildArgs spells each only when off', () => {
  const p = parseDriverArgs(['--emit', 'files']);
  assert.deepEqual([p.noSecretsGate, p.noDoneGate], [false, false]);
  const q = parseDriverArgs(['--emit', 'files', '--no-secrets-gate', '--no-done-gate']);
  assert.deepEqual([q.noSecretsGate, q.noDoneGate], [true, true]);
  const at = (deletion, gates) => setupBuildArgs('neutral', 'files', null, null, 'lean', 'peer', 'direct',
    null, undefined, null, undefined, null, { ...gates, deletionGate: deletion });
  const flags = (argv) => argv.filter((t) => t.endsWith('-gate'));
  for (const armed of [undefined, {}, { secretsGate: true, doneGate: null }]) {
    assert.deepEqual(flags(at(undefined, armed)), [], `${JSON.stringify(armed)} grew a flag`);
  }
  assert.deepEqual(flags(at(true, { secretsGate: false })), ['--no-secrets-gate']);
  assert.deepEqual(flags(at(true, { doneGate: false })), ['--no-done-gate']);
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
    emit(offDir, { secretsGate: false, doneGate: false });
    const p = installProfile('opencode', 'global', offDir);
    assert.deepEqual([p.secretsGate, p.doneGate, p.deletionGate], [false, false, true]);
    assert.deepEqual(p.argv.filter((t) => t.endsWith('-gate')), ['--no-secrets-gate', '--no-done-gate'],
      'the rebuild argv would re-arm a gate (or disarm Law IV)');

    const onDir = path.join(d, 'on');
    emit(onDir, {});
    const q = installProfile('opencode', 'global', onDir);
    assert.deepEqual([q.secretsGate, q.doneGate], [true, true]);
    assert.ok(!q.argv.some((t) => t.endsWith('-gate')), 'an armed rebuild grew a flag');
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
      assert.ok(off.filter(writeGate).length && off.filter(writeGate).every((c) => / --no-ownership-gate$/.test(c.command)),
        `${host}: ${off.filter(writeGate).map((c) => c.command).join(' | ')}`);
      assert.ok(off.filter((c) => !writeGate(c)).every((c) => !c.command.includes('--no-ownership-gate')),
        `${host}: the ownership flag leaked past the write gate`);
    }
  });
});

// The plugins are copied verbatim into an install and read its AGENT.md at load (through
// $GENESEED_HARNESS here), so each install is its own copy and its own import.
async function pluginAt(dir, name, marker) {
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'adapters', 'opencode', 'plugins', name), path.join(dir, 'plugins', name));
  fs.writeFileSync(path.join(dir, 'AGENT.md'), `# x\n\nActive packs: craft${marker}\n`);
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

test('the OpenCode context plugin drops only the done reminder when the carrier says so', async () => {
  const sb = makeSandbox('gsdonectx-');
  const savedWiki = process.env.GENESEED_WIKI;
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const repo = path.join(sb.path, 'repo');
    fs.mkdirSync(path.join(repo, '.geneseed'), { recursive: true });
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

test('status names each switch only when off, #319\'s wording unchanged', () => {
  withDir((d) => {
    const base = {
      host: 'claude', scope: 'global', root: d, state: 'active', theme: 'neutral', footprint: 'lean',
      posture: 'peer', mode: 'direct', trust: 'standard', doctrines: ['craft'], excludeRules: [],
      excludeSkills: [],
    };
    const lines = statusLines({ ...statusData(), installs: [
      { ...base, host: 'claude', secretsGate: false, doneGate: false, deletionGate: false, ownershipGate: false },
      { ...base, host: 'bob', ...ARMED },
    ] }, false);
    const row = (host) => lines.find((l) => l.includes(`${host}:global`)) || '';
    assert.match(row('claude'), /secrets gate: off \(Law I text still binds\)/);
    assert.match(row('claude'), /done gate: off \(Law III text still binds\)/);
    assert.match(row('claude'), /deletion gate: off \(Law IV text still binds\)/);
    // The ownership gate is no law's gate, so it names none.
    assert.match(row('claude'), /ownership gate: off(?! \()/);
    assert.doesNotMatch(row('bob'), / gate: off/);
  });
});

test('doctor --probe is unaffected by the two new switches', () => {
  // The probe sends a shell command to git-gate/tool-gate; neither switch judges one.
  const run = 'node "x/geneseed-hook.mjs" tool-gate --root "c" --host bob';
  assert.equal(badCommandFor(`${run} --no-secrets-gate`), BAD_COMMAND);
  assert.equal(badCommandFor(`${run} --no-secrets-gate --no-deletion-gate`), DISARMED_BAD_COMMAND);
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
    assert.deepEqual(argv.filter((t) => t.endsWith('-gate')), ['--no-done-gate'],
      `the Build re-armed the done gate (or disarmed another): ${argv.join(' ')}`);
    assert.equal(after('--config-dir'), cfgDir, 'a global Build must name its own dir');
  });
});
