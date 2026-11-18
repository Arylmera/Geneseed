// F5 of spec 2026-11-18-learn-model-row: on Windows an npm-installed CLI is a `.cmd` shim, which
// CreateProcess cannot run, so `learn` used to find no `claude`/`openclaude` and learn nothing while
// `status` said "active". `spawnPlan` is the one answer to how a command is run; `resolveCommand` is
// the one answer to whether it can be, which `doctor` shares.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { spawnPlan } from '../../js/hosts/hooks-learn.mjs';
import { resolveCommand } from '../../js/lib/proc.mjs';
import { commandOnPath } from '../../js/inspect/doctor.mjs';
import { FAKE_LLM } from '../helpers/cli_golden.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

const BIN = 'C:\\bin';
const NPM = 'C:\\npm';
const env = { PATH: `${BIN};${NPM}`, PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1', SystemRoot: 'C:\\Windows' };
const present = new Set([path.join(BIN, 'a.exe'), path.join(NPM, 'claude.cmd'), path.join(NPM, 'only.ps1')]);
const exists = (p) => present.has(p);
const plan = (words, prompt) => spawnPlan(words, prompt, { platform: 'win32', env, exists });

test('spawnPlan: an .exe runs directly, a .cmd goes through cmd.exe with the prompt on stdin', () => {
  // An .exe on PATH: run as found, the prompt the last argument, as it always was.
  assert.deepEqual(plan(['a', '-p'], 'hi'),
    { file: path.join(BIN, 'a.exe'), args: ['-p', 'hi'], input: undefined, verbatim: false, refuse: null });
  // A .cmd shim: cmd.exe /d /s /c, every word double-quoted, the prompt over stdin and never on the line.
  const prompt = 'a & echo pwned > x %PATH% "q"';
  const cmd = plan(['claude', '-p', '--model', 'haiku', '--tools', ''], prompt);
  assert.equal(cmd.file, path.join('C:\\Windows', 'System32', 'cmd.exe'));
  const line = ['"' + path.join(NPM, 'claude.cmd') + '"', '"-p"', '"--model"', '"haiku"', '"--tools"', '""'].join(' ');
  assert.deepEqual(cmd.args, ['/d', '/s', '/c', `"${line}"`]);
  assert.equal(cmd.input, prompt);
  assert.equal(cmd.verbatim, true);
  assert.ok(!cmd.args.join(' ').includes('pwned'), 'the prompt is not on the command line');
  // The help probe has no prompt: nothing on stdin.
  assert.equal(plan(['claude', '--help'], null).input, undefined);
});

test('spawnPlan: a word cmd.exe could still read inside quotes refuses the call', () => {
  for (const bad of ['%COMSPEC%', 'a"b', 'line\nbreak', 'ends-with-backslash\\']) {
    const p = plan(['claude', bad], 'p');
    assert.match(p.refuse ?? '', /cannot be passed through cmd.exe safely/, JSON.stringify(bad));
  }
});

test('spawnPlan and doctor agree: a .ps1 is not runnable, nothing found is left to the spawn, other hosts unchanged', () => {
  assert.equal(resolveCommand('only', env, exists, 'win32'), null);
  // S-F4: nothing on PATH refuses, because CreateProcess would look in the current folder first.
  assert.match(plan(['only'], 'p').refuse ?? '', /is not on PATH - nothing learned/);
  // R-F4: `claude` and `openclaude` take the prompt over stdin on every path (a long one overran the Windows line);
  // any other command keeps it as the last argument.
  assert.deepEqual(spawnPlan(['claude', '-p'], 'hi', { platform: 'linux' }),
    { file: 'claude', args: ['-p'], input: 'hi', verbatim: false, refuse: null });
  assert.deepEqual(spawnPlan(['llm', '-m', 'x'], 'hi', { platform: 'linux' }),
    { file: 'llm', args: ['-m', 'x', 'hi'], input: undefined, verbatim: false, refuse: null });
  present.add(path.join(BIN, 'claude.exe'));
  const exe = plan(['claude', '-p'], 'p'.repeat(100000));
  assert.equal(exe.file, path.join(BIN, 'claude.exe'));
  assert.deepEqual(exe.args, ['-p'], 'a long prompt is not on the command line');
  assert.equal(exe.input.length, 100000);
  present.delete(path.join(BIN, 'claude.exe'));
  // The doctor's PATH note: a .cmd counts, a .ps1 does not.
  assert.equal(commandOnPath('claude', env, exists, 'win32'), true);
  assert.equal(commandOnPath('only', env, exists, 'win32'), false);
  assert.equal(commandOnPath('missing', env, exists, 'win32'), false);
});

test('a .cmd shim on PATH is actually run, with the prompt on stdin (Windows only)', { skip: process.platform !== 'win32' }, () => {
  const sb = makeSandbox();
  try {
    const inst = path.join(sb.path, 'inst');
    fs.mkdirSync(path.join(inst, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(inst, '.geneseed-manifest.json'), '{}');
    const bin = path.join(sb.path, 'shims');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'fake-llm.cmd'), `@"${process.execPath}" "${FAKE_LLM}" %*\r\n`);
    const pwned = path.join(sb.path, 'pwned.txt');
    const transcript = path.join(sb.path, 't.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ message: { role: 'user', content: `run & echo pwned > "${pwned}" and %PATH%` } })}\n`);
    const reply = path.join(sb.path, 'reply.md');
    fs.writeFileSync(reply, '---\nname: alpha-fact\ndescription: the first canned fact\nmetadata:\n  type: project\n---\n\nBody.\n');
    const echo = path.join(sb.path, 'echo.txt');
    const jobs = path.join(sb.path, 'home', '.config', 'geneseed', 'cache', 'learn-jobs');
    fs.mkdirSync(jobs, { recursive: true });
    const file = path.join(jobs, 'job-4.json');
    fs.writeFileSync(file, JSON.stringify({ v: 1, event: 'SessionEnd', host: 'claude', memory: path.join(inst, 'memory'),
      transcript, agents: [] }));
    const childEnv = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')), PATH: `${bin};${process.env.PATH}`, GENESEED_LLM: 'fake-llm',
      FAKE_LLM_OUT: reply, FAKE_LLM_ECHO: echo };
    delete childEnv.GENESEED_LEARN_CHILD;
    spawnHook(['learn-worker', file], '', { env: childEnv });
    assert.ok(fs.existsSync(path.join(inst, 'memory', 'alpha-fact.md')), 'the shim ran and its reply was stored');
    assert.ok(fs.readFileSync(echo, 'utf8').includes('run & echo pwned'), 'the prompt arrived whole, over stdin');
    assert.ok(!fs.existsSync(pwned), 'cmd.exe never read the prompt');
  } finally { sb.cleanup(); }
});

// R-F6: the lean flags cross a real cmd.exe line: the empty `--setting-sources ""` and `--tools ""`, and a long
// `--system-prompt`, as a `claude.cmd` from npm receives them. The fake logs the argv it was started with.
test('lean flags reach a claude.cmd shim intact through cmd.exe (Windows only)', { skip: process.platform !== 'win32' }, () => {
  const sb = makeSandbox();
  try {
    const inst = path.join(sb.path, 'inst');
    fs.mkdirSync(path.join(inst, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(inst, '.geneseed-manifest.json'), '{}');
    const bin = path.join(sb.path, 'shims');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "${FAKE_LLM}" %*\r\n`);
    const transcript = path.join(sb.path, 't.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ message: { role: 'user', content: 'a turn worth distilling' } })}\n`);
    const log = path.join(sb.path, 'calls.log');
    const echo = path.join(sb.path, 'echo.txt');
    const jobs = path.join(sb.path, 'home', '.config', 'geneseed', 'cache', 'learn-jobs');
    fs.mkdirSync(jobs, { recursive: true });
    const file = path.join(jobs, 'job-5.json');
    fs.writeFileSync(file, JSON.stringify({ v: 1, event: 'SessionEnd', host: 'claude', memory: path.join(inst, 'memory'), transcript, agents: [] }));
    const childEnv = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')), PATH: `${bin};${process.env.PATH}`,
      GENESEED_LLM: 'claude -p --model haiku', FAKE_LLM_LOG: log, FAKE_LLM_ECHO: echo, FAKE_LLM_STDIN: '1' };
    delete childEnv.GENESEED_LEARN_CHILD;
    spawnHook(['learn-worker', file], '', { env: childEnv });
    const argv = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]);
    assert.deepEqual(argv.slice(0, 11), ['-p', '--model', 'haiku', '--setting-sources', '', '--strict-mcp-config', '--tools', '',
      '--disable-slash-commands', '--no-session-persistence', '--system-prompt']);
    assert.match(argv[11], /^You distil durable memories from notes[.] Follow the instructions/);
    assert.equal(argv.length, 12, 'the prompt is not an argument');
    assert.ok(fs.readFileSync(echo, 'utf8').includes('a turn worth distilling'), 'the prompt came over stdin');
  } finally { sb.cleanup(); }
});

// S-F4: a program planted in the project folder is never run. (Measured on Node 22.23: libuv no longer looks in the
// current folder for a bare word, so this test is green with or without the refusal; the refusal's own row is the pure
// `spawnPlan` test above, and this one guards an older libuv.) With nothing on PATH, the bare word used to go to
// CreateProcess, which searches the current folder first. A copy of node named like the command, with a hook that
// leaves a marker only when it is the planted copy that runs.
test('a command planted in the working folder is not run when PATH holds none (Windows only)', { skip: process.platform !== 'win32' }, () => {
  const sb = makeSandbox();
  try {
    const inst = path.join(sb.path, 'inst');
    fs.mkdirSync(path.join(inst, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(inst, '.geneseed-manifest.json'), '{}');
    const repo = path.join(sb.path, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    fs.copyFileSync(process.execPath, path.join(repo, 'plantedcmd.exe'));
    const marker = path.join(sb.path, 'ran.txt');
    const hook = path.join(sb.path, 'mark.cjs');
    fs.writeFileSync(hook, `if (require('node:path').basename(process.execPath) === 'plantedcmd.exe') require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
    const transcript = path.join(sb.path, 't.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ message: { role: 'user', content: 'a turn worth distilling' } })}\n`);
    const jobs = path.join(sb.path, 'home', '.config', 'geneseed', 'cache', 'learn-jobs');
    fs.mkdirSync(jobs, { recursive: true });
    const file = path.join(jobs, 'job-6.json');
    fs.writeFileSync(file, JSON.stringify({ v: 1, event: 'SessionEnd', host: 'claude', memory: path.join(inst, 'memory'), transcript, agents: [] }));
    const childEnv = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')), GENESEED_LLM: 'plantedcmd',
      NODE_OPTIONS: `--require ${JSON.stringify(hook)}` };
    delete childEnv.GENESEED_LEARN_CHILD;
    spawnHook(['learn-worker', file], '', { env: childEnv, cwd: repo });
    assert.ok(!fs.existsSync(marker), 'the planted plantedcmd.exe was run');
  } finally { sb.cleanup(); }
});
