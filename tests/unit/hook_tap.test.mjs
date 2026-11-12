// THE HOOK TAP (js/hosts/hook-tap.mjs): `GENESEED_HOOK_TAP=<dir>` records what a host sends a
// hook, as a fixture, and changes nothing else.
//
// Run through the real entry, `bin/geneseed-hook.mjs`, a process per case: the claim is about
// stdout bytes and exit codes, which only a process has.
//
// THE RULES, each held below with its expectation written out:
//   1. Unset, the tap does nothing. Set, the hook's stdout, stderr and exit code are the same
//      bytes as unset, and one file appears: `<dir>/<host>-<event>-<n>.json`, n from 1.
//   2. The file holds the payload's SHAPE. Every string, at any depth, is `{type:'string',
//      length}`. The exceptions are top-level `hook_event_name`, `event`, `tool_name`, `tool`,
//      `source`, `trigger`, `permission_mode`, `agent_type` and `matcher`: the host's own
//      vocabulary, kept as written (cut to 80, credential shapes replaced). Numbers, booleans,
//      null and every key are kept.
//   3. Nothing is written into a directory inside a git worktree, into a relative directory,
//      or from a model-CLI child (`GENESEED_LEARN_CHILD`). Silently: a hook never prints.
//   4. No emit writes the variable into a settings file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../js/build/source.mjs';
import { shapeOf, tapPayload } from '../../js/hosts/hook-tap.mjs';
import { HOSTS } from '../../js/hosts/hosts.mjs';
import { claudeHookGroups } from '../../js/hosts/settings.mjs';
import { hookRunnerEntry } from '../../js/hosts/shim.mjs';
import { homeOverrides, withGeneseedHome, withSandbox } from '../helpers/sandbox.mjs';

const HOOK = path.join(ROOT, 'bin', 'geneseed-hook.mjs');
// Put together at run time, so this file never holds a credential-shaped string.
const CREDENTIAL = ['AK', 'IA', 'IOSFODNN7', 'EXAMPLE'].join('');

/** One hook run in a sandboxed home, cwd `cwd`; `tap` is the variable's value, or null for unset. */
function run(home, cwd, argv, stdin, tap, extraEnv = {}) {
  const env = { ...process.env, ...homeOverrides(home), GENESEED_ACTIVITY: 'off', GENESEED_GATE_PROBE: '1', ...extraEnv };
  for (const k of ['GENESEED_HOOK_TAP', 'GENESEED_LEARN_CHILD', 'CLAUDE_PROJECT_DIR', 'GENESEED_ROOT']) {
    if (!(k in extraEnv)) delete env[k];
  }
  if (tap !== null) env.GENESEED_HOOK_TAP = tap;
  const r = spawnSync(process.execPath, [HOOK, ...argv], { cwd, env, input: stdin, encoding: 'utf8' });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}

const files = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** A sandbox with a home, a project dir to run in, and a tap dir, none inside a repo. */
async function withTap(fn) {
  await withSandbox('hook-tap-', (tmp) => {
    const home = path.join(tmp, 'home');
    const work = path.join(tmp, 'work');
    for (const d of [home, work]) mkdirSync(d, { recursive: true });
    return fn({ tmp, home, work, tap: path.join(tmp, 'tap') });
  });
}

// ---------------------------------------------------------------------------------------------
// Rule 2, pure.

test('shapeOf: strings become their type and length, the event and tool names stay', () => {
  assert.deepEqual(shapeOf({
    hook_event_name: 'PreToolUse', tool_name: 'write_file', session_id: 'abc-123',
    cwd: '/home/someone/project', stop_hook_active: false, count: 3, nothing: null,
    tool_input: { path: 'src/a.js', content: 'secret text', tool_name: 'inner', n: 1, list: ['x', 2, { k: 'yy' }] },
  }), {
    hook_event_name: 'PreToolUse', tool_name: 'write_file',
    session_id: { type: 'string', length: 7 },
    cwd: { type: 'string', length: 21 }, stop_hook_active: false, count: 3, nothing: null,
    tool_input: {
      path: { type: 'string', length: 8 }, content: { type: 'string', length: 11 },
      // `tool_name` is kept only at the top: under `tool_input` it is the model's text.
      tool_name: { type: 'string', length: 5 }, n: 1,
      list: [{ type: 'string', length: 1 }, 2, { k: { type: 'string', length: 2 } }],
    },
  });
  // A kept name is still cut to 80 and scanned: a host that put a key there would not leak it.
  assert.deepEqual(shapeOf({ tool_name: `x ${CREDENTIAL} y`, event: 'e'.repeat(100) }),
    { tool_name: 'x [redacted] y', event: 'e'.repeat(80) });
  // Not an object: a bare string is shaped, a number is itself, null stays null.
  assert.deepEqual(shapeOf('hello'), { type: 'string', length: 5 });
  assert.equal(shapeOf(7), 7);
  assert.equal(shapeOf(null), null);
});

// ---------------------------------------------------------------------------------------------
// Rule 1 and 2, through the entry.

test('Bob tool-gate: the same refusal with the tap on, plus one file holding the shape', async () => {
  await withTap(({ home, work, tap }) => {
    const content = `aws_access_key_id = ${CREDENTIAL}\n`;
    const stdin = JSON.stringify({
      session_id: 'tap-session', hook_event_name: 'PreToolUse', tool_name: 'write_file',
      tool_input: { path: 'notes.txt', content }, tool_use_id: 'call-1', cwd: work,
    });
    const argv = ['tool-gate', '--host', 'bob'];
    const off = run(home, work, argv, stdin, null);
    assert.equal(off.rc, 2, `the credential write must be refused on Bob: ${off.err}`);
    assert.equal(off.out, '');
    assert.deepEqual(files(tap), [], 'unset, nothing is written');

    const on = run(home, work, argv, stdin, tap);
    assert.deepEqual(on, off, 'the tap changed the verdict, stdout or stderr');
    assert.deepEqual(files(tap), ['bob-PreToolUse-1.json']);
    assert.deepEqual(json(path.join(tap, 'bob-PreToolUse-1.json')), {
      tap: { host: 'bob', verb: 'tool-gate', json: true, bytes: stdin.length },
      payload: {
        session_id: { type: 'string', length: 11 },
        hook_event_name: 'PreToolUse',
        tool_name: 'write_file',
        tool_input: {
          path: { type: 'string', length: 9 },
          content: { type: 'string', length: content.length },
        },
        tool_use_id: { type: 'string', length: 6 },
        cwd: { type: 'string', length: work.length },
      },
    });
    const text = readFileSync(path.join(tap, 'bob-PreToolUse-1.json'), 'utf8');
    for (const secret of [CREDENTIAL, 'notes.txt', 'tap-session', work]) {
      assert.ok(!text.includes(secret), `the tap file holds a value: ${secret}`);
    }

    // The next call of the same event takes the next number, and overwrites nothing.
    assert.deepEqual(run(home, work, argv, stdin, tap), off);
    assert.deepEqual(files(tap), ['bob-PreToolUse-1.json', 'bob-PreToolUse-2.json']);
  });
});

test('Claude git-gate: the ask is byte-identical with the tap on; the command is not in the file', async () => {
  await withTap(({ home, work, tap }) => {
    const stdin = JSON.stringify({
      session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'git reflog expire --expire=now --all' }, cwd: work,
    });
    const off = run(home, work, ['git-gate'], stdin, null);
    assert.equal(off.rc, 0);
    assert.equal(JSON.parse(off.out).hookSpecificOutput.permissionDecision, 'ask');
    const on = run(home, work, ['git-gate'], stdin, tap);
    assert.deepEqual(on, off);
    assert.deepEqual(files(tap), ['claude-PreToolUse-1.json']);
    assert.deepEqual(json(path.join(tap, 'claude-PreToolUse-1.json')).payload.tool_input,
      { command: { type: 'string', length: 36 } });

    // A call the gate lets through is recorded too: the tap is about the payload, not the verdict.
    const good = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    const pass = run(home, work, ['git-gate'], good, tap);
    assert.deepEqual(pass, { rc: 0, out: '', err: '' });
    assert.deepEqual(files(tap), ['claude-PreToolUse-1.json', 'claude-PreToolUse-2.json']);
  });
});

test('the older Bob shape names its event by `event`; stdin that is not JSON is recorded as such', async () => {
  await withTap(({ home, work, tap }) => {
    const legacy = JSON.stringify({ event: 'PreToolUse', session_id: 's', tool: 'execute_command', input: { command: 'git status' } });
    assert.equal(run(home, work, ['tool-gate', '--host', 'bob'], legacy, tap).rc, 0);
    assert.deepEqual(json(path.join(tap, 'bob-PreToolUse-1.json')).payload, {
      event: 'PreToolUse', session_id: { type: 'string', length: 1 }, tool: 'execute_command',
      input: { command: { type: 'string', length: 10 } },
    });
    // No event name to read: the file is named after the verb, and holds no payload.
    const garbage = run(home, work, ['activity', '--host', 'bob'], 'not json {', tap);
    assert.deepEqual(garbage, { rc: 0, out: '', err: '' });
    assert.deepEqual(json(path.join(tap, 'bob-activity-1.json')),
      { tap: { host: 'bob', verb: 'activity', json: false, bytes: 10 }, payload: null });
  });
});

// ---------------------------------------------------------------------------------------------
// Rule 3.

test('nothing is written inside a git worktree, into a relative directory, or from a learn child', async () => {
  await withTap(({ tmp, home, work, tap }) => {
    const stdin = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    const quiet = { rc: 0, out: '', err: '' };

    // A repo: a `.git` entry is all `gitRootOf` asks for. The tap dir is two levels inside it.
    const repo = path.join(tmp, 'repo');
    mkdirSync(path.join(repo, '.git'), { recursive: true });
    const inside = path.join(repo, 'captures', 'tap');
    assert.deepEqual(run(home, work, ['git-gate'], stdin, inside), quiet);
    assert.ok(!existsSync(path.join(repo, 'captures')), 'a tap directory was created inside a repository');

    assert.deepEqual(run(home, work, ['git-gate'], stdin, 'tap-here'), quiet);
    assert.ok(!existsSync(path.join(work, 'tap-here')), 'a relative tap directory was created');

    assert.deepEqual(run(home, work, ['git-gate'], stdin, tap, { GENESEED_LEARN_CHILD: '1' }), quiet);
    assert.deepEqual(files(tap), []);

    // And the function itself, on the same three refusals plus a value that is no path at all.
    assert.equal(tapPayload(inside, stdin, { verb: 'git-gate', host: 'claude' }), null);
    assert.equal(tapPayload('relative', stdin, { verb: 'git-gate', host: 'claude' }), null);
    assert.equal(tapPayload(undefined, stdin, { verb: 'git-gate', host: 'claude' }), null);
    assert.deepEqual(files(tap), []);
  });
});

// ---------------------------------------------------------------------------------------------
// Rule 4, and the cost.

test('no emit bakes the variable into a settings file', () => {
  withGeneseedHome((home) => {
    for (const { host } of HOSTS.filter((h) => h.family === 'claude')) {
      const groups = claudeHookGroups(path.join(home, host), hookRunnerEntry(), null, [], host);
      assert.ok(!JSON.stringify(groups).includes('HOOK_TAP'), `${host}'s hook groups name the tap`);
    }
  });
  for (const rel of ['js/hosts/settings.mjs', 'js/hosts/shim.mjs', 'js/build/emit-claude.mjs', 'js/build/emit-opencode.mjs']) {
    assert.ok(!readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8').includes('GENESEED_HOOK_TAP'),
      `${rel} names GENESEED_HOOK_TAP — the tap is set by a person, in the host's environment, for one capture`);
  }
});

test('the hook entry loads the tap only behind the variable', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.doesNotMatch(src, /^import .*hook-tap\.mjs/m, 'a static import: every tool call would pay for the tap');
  assert.equal((src.match(/import\('\.\.\/js\/hosts\/hook-tap\.mjs'\)/g) ?? []).length, 1);
  assert.match(src, /if \(process\.env\.GENESEED_HOOK_TAP\) await tapHook\(verb, parsed\.args\);/);
});
