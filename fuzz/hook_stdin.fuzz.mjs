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
  '\n', ' ');
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
