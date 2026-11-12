// `doctor --probe` (js/inspect/checks-probe.mjs, #290): each installed gate is RUN, through the
// host's shell, on a payload it must refuse (`git reflog expire --expire=now --all`) and one it must let
// through (`git status`).
//
// THE GATE FAILS BOTH WAYS, and this file holds it to that. A probe that always reports ok
// passes P1 and nothing else; one that always reports a problem passes P2-P4 and fails P1. So
// every sound fixture below has a broken twin, and each twin names the direction it broke in:
// "not refusing" (allows everything), "refuses everything", "does not run".
//
// The fixtures are real installs: settings and manifest written by `claudeHookGroups`, the
// shim written by `hookPrefix` under a sandboxed `GENESEED_HOME`, the hook binary this
// checkout's own. The broken twins swap one recorded command for a fixture script whose path
// carries `geneseed-hook`, so the probe's own-command check lets them through on purpose.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../js/build/source.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { claudeHookGroups } from '../../js/hosts/settings.mjs';
import { claudeGitBashPath, hookRunnerEntry } from '../../js/hosts/shim.mjs';
import {
  BAD_COMMAND, GOOD_COMMAND, gateProbe, guardPluginPath, guardProbe, isOurGate, probeVerdict, probesFor,
  refused,
} from '../../js/inspect/checks-probe.mjs';
import { makeSandbox, withGeneseedHome } from '../helpers/sandbox.mjs';

// The probe needs the shell the host would use. CI's Windows runners carry Git Bash; a
// Windows machine without it cannot run a bash-form Claude hook at all, so there is nothing
// to probe there and the spawning tests skip with that reason.
const NO_SHELL = process.platform === 'win32' && !claudeGitBashPath()
  ? 'no Git Bash on this Windows machine — the shell Claude would run the gate under' : false;

/** A live install at `cfg` exactly as an emit for `host` writes it: settings + manifest. */
function writeInstall(cfg, host, edit = (g) => g) {
  mkdirSync(cfg, { recursive: true });
  const groups = edit(claudeHookGroups(cfg, hookRunnerEntry(), null, [], host));
  const recorded = Object.entries(groups).flatMap(([event, gs]) => gs.map((group) => ({ event, group })));
  writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ hooks: groups }));
  writeFileSync(path.join(cfg, GLOBAL_MANIFEST), JSON.stringify({ managed: { settings_hooks: recorded } }));
}

/** Rewrite every recorded command running `verb` with `fn` — settings and manifest alike. */
const swapGate = (verb, fn) => (groups) => Object.fromEntries(Object.entries(groups).map(([event, gs]) => [
  event, gs.map((g) => ({ ...g, hooks: g.hooks.map((h) => (h.command.includes(` ${verb} --root`)
    ? { ...h, command: fn(h.command) } : h)) })),
]));

/** A fixture "gate" at `<dir>/<name>.mjs` running `body`, called the way the shim calls one. */
function fixtureGate(dir, name, body, verb, cfg) {
  const file = path.join(dir, `${name}.mjs`);
  writeFileSync(file, body);
  return () => `"${process.execPath}" "${file}" ${verb} --root "${cfg}"`;
}

const ASK = 'process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: '
  + '"PreToolUse", permissionDecision: "ask", permissionDecisionReason: "x" } }) + "\\n");';

// ---------------------------------------------------------------------------------------------
// The verdict table, pure: every row a gate's two runs can land in.

test('probeVerdict: refuse-then-pass is the only sound pair, on both refusal dialects', () => {
  const ask = { status: 0, stdout: '{"hookSpecificOutput": {"permissionDecision": "ask"}}' };
  const defer = { status: 0, stdout: '' };
  const two = { status: 2, stdout: '' };
  assert.equal(probeVerdict('claude', ask, defer), null);
  assert.equal(probeVerdict('bob', two, defer), null);
  assert.match(probeVerdict('claude', defer, defer), /^registered but not refusing/);
  assert.match(probeVerdict('claude', ask, ask), /^refuses everything/);
  // Bob reads no stdout on PreToolUse: an ask JSON there refuses nothing.
  assert.match(probeVerdict('bob', ask, defer), /^registered but not refusing/);
  assert.match(probeVerdict('bob', two, two), /^refuses everything/);
  assert.match(probeVerdict('claude', { status: 1, stdout: '', stderr: 'boom' }, defer),
    /^does not run \(exit 1: boom\).*onFailure: block/);
  assert.match(probeVerdict('openclaude', { status: null, error: 'timed out' }, defer),
    /^does not run \(timed out\).*lets every call through/);
  assert.equal(refused('claude', two), true, 'exit 2 blocks on Claude too');
});

test('isOurGate: a gate verb, --root, and our shim — all three', () => {
  assert.equal(isOurGate('"C:/x/geneseed-hook.cmd" git-gate --root "c"', 'git-gate'), true);
  assert.equal(isOurGate('"C:/x/evil.cmd" git-gate --root "c"', 'git-gate'), false);
  assert.equal(isOurGate('"C:/x/geneseed-hook.cmd" context --root "c"', 'git-gate'), false);
});

// ---------------------------------------------------------------------------------------------
// The real installs, run.

test('a sound Claude and OpenClaude install pass, and the probe leaves no ledger line', { skip: NO_SHELL }, () => {
  withGeneseedHome((home) => {
    for (const host of ['claude', 'openclaude']) {
      const cfg = path.join(home, host);
      writeInstall(cfg, host);
      const { problems, probed } = gateProbe([[host, 'global', cfg]]);
      assert.deepEqual(problems, [], problems.join('\n'));
      assert.equal(probed.length, 1, `${host}: ${probed}`);
      assert.match(probed[0], /git-gate/);
      assert.ok(!existsSync(path.join(cfg, 'notebook', 'gates.jsonl')),
        `${host}: the probe's ask landed in the gate ledger`);
    }
  });
});

test('a gate that allows everything fails as "not refusing"', { skip: NO_SHELL }, () => {
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'claude');
    writeInstall(cfg, 'claude', swapGate('git-gate', fixtureGate(home, 'geneseed-hook-defer', '', 'git-gate', cfg)));
    const { problems, probed } = gateProbe([['claude', 'global', cfg]]);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /git-gate under .* registered but not refusing/);
    assert.deepEqual(probed, []);
  });
});

test('a gate that refuses everything fails as "refuses everything"', { skip: NO_SHELL }, () => {
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'claude');
    writeInstall(cfg, 'claude', swapGate('git-gate', fixtureGate(home, 'geneseed-hook-ask', ASK, 'git-gate', cfg)));
    const { problems } = gateProbe([['claude', 'global', cfg]]);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /refuses everything/);
  });
});

test('a gate that crashes fails as "does not run"', { skip: NO_SHELL }, () => {
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'claude');
    writeInstall(cfg, 'claude', swapGate('git-gate',
      fixtureGate(home, 'geneseed-hook-crash', 'process.exit(1);', 'git-gate', cfg)));
    const { problems } = gateProbe([['claude', 'global', cfg]]);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /does not run \(exit 1\)/);
  });
});

test('a sovereign exclusion over the probe dir is a gate that refuses nothing', { skip: NO_SHELL }, () => {
  // The realistic "registered but not refusing": the gate is ours and healthy, and something
  // in the install tells it to stand down where the probe runs.
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'claude');
    writeInstall(cfg, 'claude');
    writeFileSync(path.join(cfg, 'excludes.json'), JSON.stringify({ excludes: [path.parse(home).root] }));
    const { problems } = gateProbe([['claude', 'global', cfg]]);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /registered but not refusing/);
  });
});

test('a recorded command that is not ours is reported and never run', { skip: NO_SHELL }, () => {
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'claude');
    const marker = path.join(home, 'ran.txt');
    const body = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\n`;
    writeInstall(cfg, 'claude', swapGate('git-gate', fixtureGate(home, 'foreign', body, 'git-gate', cfg)));
    const { problems } = gateProbe([['claude', 'global', cfg]]);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /not probed — its command does not run geneseed-hook/);
    assert.ok(!existsSync(marker), 'doctor ran a command that is not a Geneseed gate');
  });
});

test('an install with no live gate is a problem, not a silent pass', () => {
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'claude');
    writeInstall(cfg, 'claude', (g) => ({ ...g, PreToolUse: g.PreToolUse.filter((x) => x.matcher !== 'Bash|PowerShell|Monitor') }));
    const { problems } = gateProbe([['claude', 'global', cfg]]);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /no live git-gate hook/);
  });
});

test('Bob: exit 2 refuses; the same gate without --host bob speaks JSON Bob never reads', { skip: NO_SHELL && process.platform !== 'win32' ? NO_SHELL : false }, () => {
  // On Windows Bob runs `cmd /c`, so Git Bash is not needed here. The broken twin is the
  // exact 2026-09 Bob bug: Claude's verdict dialect on a host that only reads exit codes.
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'bob');
    writeInstall(cfg, 'bob');
    const ok = gateProbe([['bob', 'global', cfg]]);
    assert.deepEqual(ok.problems, [], ok.problems.join('\n'));
    assert.match(ok.probed[0], /tool-gate/);
    writeInstall(cfg, 'bob', swapGate('tool-gate', (c) => c.replace(' --host bob', '')));
    const { problems } = gateProbe([['bob', 'global', cfg]]);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /tool-gate under .* registered but not refusing/);
  });
});

test('the payloads are the ones the docs and the ADR name', () => {
  // State-independent on purpose: Law IV asks for `reflog expire` in every state, where
  // `reset --hard` would pass on a clean tree since the gate asks only on real loss.
  assert.equal(BAD_COMMAND, 'git reflog expire --expire=now --all');
  assert.equal(GOOD_COMMAND, 'git status');
  assert.ok(readFileSync(path.join(import.meta.dirname, '..', '..', 'docs', 'adr',
    '0002-no-spawn-on-the-generator-and-hook-path.md'), 'utf8').includes('doctor --probe'));
});

// ---------------------------------------------------------------------------------------------
// OpenCode (phase 2): the guard plugin is imported and its hooks called in-process, through BOTH
// plugin APIs — V1 refuses by throwing, V2 by renaming the call. The sound fixture is this
// checkout's own plugin file, copied where an install keeps it; each broken twin is a plugin
// file of the same shape that fails in one direction.

/** A live OpenCode global install at `root` whose guard plugin is `source`. */
function writeOpencodeInstall(root, source) {
  mkdirSync(path.join(root, 'plugins'), { recursive: true });
  mkdirSync(path.join(root, 'notebook'), { recursive: true });
  writeFileSync(path.join(root, GLOBAL_MANIFEST), '{}');
  writeFileSync(guardPluginPath(root, 'global'), source);
}

const realGuard = () => readFileSync(path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-guard.js'), 'utf8');

/** A guard-shaped plugin whose verdict is `refuse(command)` on both APIs. */
const fakeGuard = (refuse) => `const refuse = ${refuse};
export default {
  id: 'geneseed-guard',
  server: async () => ({ 'tool.execute.before': async (_i, o) => {
    if (refuse(o.args.command)) throw new Error('[geneseed-guard] blocked: fixture');
  } }),
  setup: async (ctx) => ctx.tool.hook('execute.before', async (e) => {
    if (refuse(e.input.command)) e.tool = '[geneseed-guard] blocked: fixture';
  }),
};
`;

test('OpenCode: the shipped guard refuses rm -rf / and passes git status on V1 and V2, ledger untouched', async () => {
  const sb = makeSandbox('probe-oc-');
  try {
    writeOpencodeInstall(sb.path, realGuard());
    const { problems, probed } = await guardProbe([['opencode', 'global', sb.path]], {});
    assert.deepEqual(problems, [], problems.join('\n'));
    assert.equal(probed.length, 1);
    assert.match(probed[0], /guard, in-process/);
    assert.ok(!existsSync(path.join(sb.path, 'notebook', 'gates.jsonl')), 'the probe\'s block landed in the ledger');
    assert.equal(process.env.GENESEED_GATE_PROBE, undefined, 'the probe leaked its env var');
  } finally { sb.cleanup(); }
});

test('OpenCode: a guard that allows everything fails on both APIs', async () => {
  const sb = makeSandbox('probe-oc-');
  try {
    writeOpencodeInstall(sb.path, fakeGuard('() => false'));
    const { problems, probed } = await guardProbe([['opencode', 'global', sb.path]], {});
    assert.equal(problems.length, 2, problems.join('\n'));
    assert.match(problems[0], /V1 hook\) registered but not refusing — `rm -rf \/`/);
    assert.match(problems[1], /V2 hook\) registered but not refusing/);
    assert.deepEqual(probed, []);
  } finally { sb.cleanup(); }
});

test('OpenCode: a guard that refuses everything fails on both APIs', async () => {
  const sb = makeSandbox('probe-oc-');
  try {
    writeOpencodeInstall(sb.path, fakeGuard('() => true'));
    const { problems } = await guardProbe([['opencode', 'global', sb.path]], {});
    assert.equal(problems.length, 2, problems.join('\n'));
    for (const p of problems) assert.match(p, /refuses everything/);
  } finally { sb.cleanup(); }
});

test('OpenCode: GENESEED_GUARD=off|warn is a note; a missing or foreign plugin is a problem', async () => {
  const sb = makeSandbox('probe-oc-');
  try {
    const target = [['opencode', 'global', sb.path]];
    writeOpencodeInstall(sb.path, realGuard());
    for (const mode of ['off', 'warn']) {
      const { problems } = await guardProbe(target, { GENESEED_GUARD: mode });
      assert.equal(problems.length, 1);
      assert.ok(problems[0].startsWith('[note] '), problems[0]);
    }
    writeFileSync(guardPluginPath(sb.path, 'global'), 'export default { id: "someone-else" };\n');
    assert.match((await guardProbe(target, {})).problems[0], /does not export the Geneseed guard/);
    rmSync(guardPluginPath(sb.path, 'global'));
    assert.match((await guardProbe(target, {})).problems[0], /no guard plugin/);
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// Bob, in Bob's own shapes (`probesFor`). A Claude-shaped Bash call is not what Bob sends, and
// `tool-gate` finds a `command` wherever it sits, so that one pair could pass on a gate blind
// to Bob's real payloads.
//
// THE RULE, written out:
//   claude, openclaude  one probe: the Claude-shaped pair, shape ''.
//   bob                 three, in this order: the Claude-shaped pair (shape ''), the legacy
//                       `{event, tool, input:{command}}` pair ("Bob's legacy payload"), and a
//                       `write_file` carrying a credential, refusal only ("Bob's write_file").
//   --no-secrets-gate   the third is left out: that gate passes the write by design.
//   --no-deletion-gate  both command pairs ask `find / -name geneseed-probe` instead.
// The good command is `git status` in both command shapes. A failing probe after the first
// names its shape in brackets at the end of the problem line.

const keysOf = (json) => Object.keys(JSON.parse(json)).sort();

test('probesFor: one probe for the Claude dialect, three for Bob, in Bob\'s shapes', () => {
  const cmd = '"/x/geneseed-hook" tool-gate --root "/cfg" --host bob';
  for (const host of ['claude', 'openclaude']) {
    assert.deepEqual(probesFor(host, cmd, '/t').map((p) => [p.shape, p.name]), [['', BAD_COMMAND]]);
  }
  const bob = probesFor('bob', cmd, '/t');
  assert.deepEqual(bob.map((p) => [p.shape, p.name, p.good === null]), [
    ['', 'git reflog expire --expire=now --all', false],
    ["Bob's legacy payload", 'git reflog expire --expire=now --all', false],
    ["Bob's write_file", 'write_file with a credential', true],
  ]);
  assert.deepEqual(JSON.parse(bob[0].bad), {
    session_id: 'geneseed-probe', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'git reflog expire --expire=now --all' }, cwd: '/t',
  });
  assert.deepEqual(JSON.parse(bob[1].bad), {
    event: 'PreToolUse', session_id: 'geneseed-probe', tool: 'execute_command',
    input: { command: 'git reflog expire --expire=now --all' },
  });
  assert.deepEqual(JSON.parse(bob[1].good), {
    event: 'PreToolUse', session_id: 'geneseed-probe', tool: 'execute_command',
    input: { command: 'git status' },
  });
  // The write: Bob 2.2.3's keys, `path` (not Claude's `file_path`), and a credential-shaped
  // value that exists only at run time.
  const write = JSON.parse(bob[2].bad);
  assert.deepEqual(keysOf(bob[2].bad), ['cwd', 'hook_event_name', 'session_id', 'tool_input', 'tool_name']);
  assert.equal(write.tool_name, 'write_file');
  assert.deepEqual(Object.keys(write.tool_input).sort(), ['content', 'path']);
  assert.equal(write.tool_input.path, 'geneseed-probe.txt');
  assert.match(write.tool_input.content, /\bAKIA[0-9A-Z]{16}\b/);
});

test('probesFor: each switch on the wired command drops or swaps exactly its own probe', () => {
  const base = '"/x/geneseed-hook" tool-gate --root "/cfg" --host bob';
  assert.deepEqual(probesFor('bob', `${base} --no-secrets-gate`, '/t').map((p) => [p.shape, p.name]), [
    ['', 'git reflog expire --expire=now --all'],
    ["Bob's legacy payload", 'git reflog expire --expire=now --all'],
  ]);
  assert.deepEqual(probesFor('bob', `${base} --no-deletion-gate`, '/t').map((p) => [p.shape, p.name]), [
    ['', 'find / -name geneseed-probe'],
    ["Bob's legacy payload", 'find / -name geneseed-probe'],
    ["Bob's write_file", 'write_file with a credential'],
  ]);
});

test('the probe source never spells the credential it sends', () => {
  const src = readFileSync(path.join(ROOT, 'js', 'inspect', 'checks-probe.mjs'), 'utf8');
  assert.doesNotMatch(src, /AKIA[0-9A-Z]{16}/);
});

// Fixture gates for the two broken twins. Each refuses by exit 2, as Bob reads it.
const READ_STDIN = "import { readFileSync } from 'node:fs';\nconst p = JSON.parse(readFileSync(0, 'utf8'));\n";
// Reads only Claude's keys: blind to the legacy shape.
const CLAUDE_ONLY = `${READ_STDIN}const c = (p.tool_input || {}).command || '';\n`
  + "process.exit(/reflog|find \\//.test(c) ? 2 : 0);\n";
// Reads a command in either shape, and no file content at all: blind to a credential write.
const COMMANDS_ONLY = `${READ_STDIN}const c = (p.tool_input || p.input || {}).command || '';\n`
  + "process.exit(/reflog|find \\//.test(c) ? 2 : 0);\n";

const BOB_SKIP = NO_SHELL && process.platform !== 'win32' ? NO_SHELL : false;

test('Bob: a gate blind to the legacy payload fails, and the line names the shape', { skip: BOB_SKIP }, () => {
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'bob');
    writeInstall(cfg, 'bob', swapGate('tool-gate', fixtureGate(home, 'geneseed-hook-claude-only', CLAUDE_ONLY, 'tool-gate', cfg)));
    const { problems, probed } = gateProbe([['bob', 'global', cfg]]);
    assert.deepEqual(probed, []);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.ok(problems[0].endsWith('registered but not refusing — `git reflog expire --expire=now --all` '
      + "went through (Bob's legacy payload)"), problems[0]);
  });
});

test('Bob: a gate blind to a credential write fails; wired --no-secrets-gate, the same gate passes', { skip: BOB_SKIP }, () => {
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'bob');
    const gate = fixtureGate(home, 'geneseed-hook-commands-only', COMMANDS_ONLY, 'tool-gate', cfg);
    writeInstall(cfg, 'bob', swapGate('tool-gate', gate));
    const blind = gateProbe([['bob', 'global', cfg]]);
    assert.equal(blind.problems.length, 1, blind.problems.join('\n'));
    assert.ok(blind.problems[0].endsWith('registered but not refusing — `write_file with a credential` '
      + "went through (Bob's write_file)"), blind.problems[0]);
    writeInstall(cfg, 'bob', swapGate('tool-gate', () => `${gate()} --no-secrets-gate`));
    const off = gateProbe([['bob', 'global', cfg]]);
    assert.deepEqual(off.problems, [], off.problems.join('\n'));
    assert.equal(off.probed.length, 1);
  });
});

test('Bob: the shipped gate, wired --no-secrets-gate or --no-deletion-gate, still passes every probe it gets', { skip: BOB_SKIP }, () => {
  withGeneseedHome((home) => {
    const cfg = path.join(home, 'bob');
    for (const flag of [' --no-secrets-gate', ' --no-deletion-gate']) {
      writeInstall(cfg, 'bob', swapGate('tool-gate', (c) => `${c}${flag}`));
      const { problems, probed } = gateProbe([['bob', 'global', cfg]]);
      assert.deepEqual(problems, [], `${flag}: ${problems.join('\n')}`);
      assert.equal(probed.length, 1, flag);
    }
  });
});
