/**
 * Fuzz the hook gates' stdin: whatever a host pipes in, a gate exits 0 and prints either
 * nothing (defer) or one well-formed verdict.
 *
 * WHY THIS IS THE TARGET. `bin/geneseed-hook.mjs` runs on every tool call of every session, and
 * it signals through stdout JSON, not its exit code. A gate that crashes or prints a stray byte
 * does not fail loudly: a non-zero exit breaks the host's tool call, and garbage on stdout is a
 * verdict the host cannot read — either way a blocking gate turns silently permissive. The
 * written tests (`tests/unit/hook_gates.test.mjs`) pin the commands someone thought of; this
 * feeds the ones nobody did — raw bytes, truncated JSON, wrong types, and git commands with
 * random quoting and chaining — through the real entry point, as a real child process.
 *
 * Not in the unit glob on purpose: it spawns a process per case. CI runs it as its own step
 * (`node --test --test-reporter=tap "fuzz/*.fuzz.mjs"`). Each failure prints fast-check's seed
 * and the shrunk input, which is the row to add to the written table.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'bin', 'geneseed-hook.mjs');
const RUNS = Number(process.env.FUZZ_RUNS ?? 40);

/** Run one gate with `stdin` on fd 0 from a file — what a host does, and immune to pipe races. */
function gate(verb, stdin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-fuzz-'));
  try {
    const inFile = path.join(dir, 'stdin');
    fs.writeFileSync(inFile, stdin);
    const fd = fs.openSync(inFile, 'r');
    try {
      const p = spawnSync(process.execPath, [HOOK, verb], {
        cwd: dir, encoding: 'utf8', windowsHide: true, stdio: [fd, 'pipe', 'pipe'],
      });
      return { rc: p.status, out: p.stdout, err: p.stderr };
    } finally { fs.closeSync(fd); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** The contract every gate keeps on every input. */
function assertWellFormed(verb, input, r) {
  const show = JSON.stringify(input).slice(0, 200);
  assert.equal(r.rc, 0, `${verb} exited ${r.rc} on ${show}\nstderr: ${r.err}`);
  if (r.out === '') return;
  let verdict;
  assert.doesNotThrow(() => { verdict = JSON.parse(r.out); },
    `${verb} printed non-JSON on ${show}: ${JSON.stringify(r.out.slice(0, 200))}`);
  assert.equal(typeof verdict, 'object', `${verb} printed a JSON non-object on ${show}`);
  assert.ok(verdict && !Array.isArray(verdict), `${verb} printed a JSON non-object on ${show}`);
}

// Shapes a host could send, from garbage to almost-right.
const fragment = fc.constantFrom('git', 'commit', 'push', '--force', '-C', '/repo', '&&', ';',
  '|', '-m', "'x'", '"y"', 'origin', 'main', 'reset', '--hard', 'rm', '-rf', '$(', ')', '`', '\\',
  '\n', ' ', '&', '2>&1', '(', '{', '}', 'then', 'sudo', '-u', 'timeout', 'Remove-Item', '-delete',
  '<<EOF');
const command = fc.array(fc.oneof(fragment, fc.string()), { maxLength: 12 }).map((a) => a.join(' '));
const payload = fc.oneof(
  fc.uint8Array({ maxLength: 256 }).map((b) => Buffer.from(b)),
  fc.string(),
  fc.jsonValue().map((v) => JSON.stringify(v)),
  fc.record({ tool_name: fc.oneof(fc.constant('Bash'), fc.string()), tool_input: fc.jsonValue() })
    .map((v) => JSON.stringify(v)),
  command.map((c) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } })),
  command.map((c) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } }).slice(0, -3)),
);

for (const verb of ['git-gate', 'rule-gate']) {
  test(`${verb} keeps its output contract on any stdin`, () => {
    fc.assert(fc.property(payload, (input) => {
      assertWellFormed(verb, input, gate(verb, input));
    }), { numRuns: RUNS });
  });
}

// The done gate (#289) rides `learn` on Stop, where stdout is a verdict too: whatever the
// transcript holds — torn lines, wrong types, random tool calls — `learn` exits 0 and prints
// nothing or exactly one `{"decision":"block"}`. `$GENESEED_LLM` is unset, so nothing spawns.
const toolLine = fc.record({
  name: fc.constantFrom('Edit', 'Write', 'Bash', 'PowerShell', 'Read', 'NotebookEdit'),
  input: fc.oneof(fc.jsonValue(), command.map((c) => ({ command: c })),
    fc.constantFrom({ file_path: 'a.js' }, { file_path: '../out.js' }, { file_path: 7 })),
  err: fc.oneof(fc.boolean(), fc.constant(undefined)),
}).map(({ name, input, err }, i) => [
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name, input }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: err }] } }),
].join('\n'));
const transcript = fc.array(fc.oneof(toolLine, fc.string(), fc.jsonValue().map((v) => JSON.stringify(v))),
  { maxLength: 12 }).map((lines) => lines.join('\n'));

test('learn keeps its Stop contract with the done gate armed, on any transcript', () => {
  fc.assert(fc.property(transcript, fc.boolean(), (text, active) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-fuzz-'));
    try {
      fs.mkdirSync(path.join(dir, '.git'));
      fs.mkdirSync(path.join(dir, '.geneseed'));
      fs.writeFileSync(path.join(dir, '.geneseed', 'done-checks.txt'), 'npm test\n');
      fs.writeFileSync(path.join(dir, 't.jsonl'), text);
      const inFile = path.join(dir, 'stdin');
      fs.writeFileSync(inFile, JSON.stringify({ hook_event_name: 'Stop', cwd: dir,
        transcript_path: path.join(dir, 't.jsonl'), stop_hook_active: active }));
      const env = { ...process.env };
      delete env.GENESEED_LLM;
      delete env.GENESEED_LEARN_CHILD;
      const fd = fs.openSync(inFile, 'r');
      let p;
      try {
        p = spawnSync(process.execPath, [HOOK, 'learn', '--memory', path.join(dir, 'install', 'memory')],
          { cwd: dir, encoding: 'utf8', windowsHide: true, stdio: [fd, 'pipe', 'pipe'], env });
      } finally { fs.closeSync(fd); }
      assert.equal(p.status, 0, `learn exited ${p.status}\nstderr: ${p.stderr}`);
      if (p.stdout === '') return;
      assert.equal(active, false, 'a block after a block: the cap must let the turn end');
      assert.equal(JSON.parse(p.stdout).decision, 'block');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }), { numRuns: RUNS });
});

// The `activity` verb runs on UserPromptSubmit, where Claude injects stdout as context and exit 2
// erases the prompt — so on ANY payload it exits 0 and prints nothing on either stream, and the
// activity writer behind it (js/hosts/activity.mjs) writes only under `<root>/activity/`, whatever
// session id or transcript arrives. Tracking is on (no flag file), so the writer really runs.
const sid = fc.oneof(fc.string(), fc.constantFrom('../../x', 'a/b\\c', 'C:\\x', '..', '.', ''), fc.jsonValue());
const event = fc.constantFrom('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'SubagentStart', 'SubagentStop',
  'PreCompact', 'SessionEnd', 'Notification');
const activityPayload = fc.oneof(payload, fc.record({
  hook_event_name: event, session_id: sid, prompt: fc.oneof(fc.string(), fc.jsonValue()),
  tool_name: fc.oneof(fc.constantFrom('Edit', 'Write', 'TodoWrite', 'Bash'), fc.jsonValue()),
  tool_input: fc.jsonValue(), useTranscript: fc.boolean(), text: transcript,
}));

test('activity exits 0 silently and writes only under <root>/activity on any stdin', () => {
  fc.assert(fc.property(activityPayload, (input) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-fuzz-'));
    try {
      const root = path.join(dir, 'cfg');
      fs.mkdirSync(root);
      let stdin = input;
      const extra = [];
      if (input && typeof input === 'object' && !Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
        const { useTranscript, text, ...rest } = input;
        if (useTranscript) {
          fs.writeFileSync(path.join(dir, 't.jsonl'), text);
          rest.transcript_path = path.join(dir, 't.jsonl');
          extra.push('t.jsonl');
        }
        stdin = JSON.stringify(rest);
      }
      const inFile = path.join(dir, 'stdin');
      fs.writeFileSync(inFile, stdin);
      const env = { ...process.env };
      delete env.GENESEED_ACTIVITY;
      delete env.GENESEED_LEARN_CHILD;
      const fd = fs.openSync(inFile, 'r');
      let p;
      try {
        p = spawnSync(process.execPath, [HOOK, 'activity', '--root', root],
          { cwd: dir, encoding: 'utf8', windowsHide: true, stdio: [fd, 'pipe', 'pipe'], env });
      } finally { fs.closeSync(fd); }
      const show = String(stdin).slice(0, 200);
      assert.deepEqual([p.status, p.stdout, p.stderr], [0, '', ''], `activity on ${show}`);
      assert.deepEqual(fs.readdirSync(root).filter((n) => n !== 'activity'), [],
        `wrote outside activity/ on ${show}`);
      assert.deepEqual(fs.readdirSync(dir).sort(), ['cfg', 'stdin', ...extra].sort(),
        `wrote outside the install on ${show}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }), { numRuns: RUNS });
});
