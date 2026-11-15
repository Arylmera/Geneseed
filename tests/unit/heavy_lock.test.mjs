// `tests/heavy.mjs`: one heavy proof per machine, the rest wait their turn.
//
// Every row runs the real script in a child process with a PRIVATE lock path
// (`GENESEED_HEAVY_LOCK` in a fresh temp directory), and with `GENESEED_HEAVY_HELD` removed from
// the child's env: this file itself runs inside `node tests/heavy.mjs suite`, so the inherited
// marker would make every wrapper here skip the lock and every queue row pass vacuously.
// `GENESEED_HEAVY_POLL_MS=50` keeps each queue row well under a second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEAVY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'heavy.mjs');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-heavy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, lock: path.join(dir, 'heavy.lock') };
}

function wrapped(lock, args, extraEnv = {}) {
  const env = { ...process.env, GENESEED_HEAVY_LOCK: lock, GENESEED_HEAVY_POLL_MS: '50', ...extraEnv };
  if (!('GENESEED_HEAVY_HELD' in extraEnv)) delete env.GENESEED_HEAVY_HELD;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HEAVY, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// A child that appends `<tag> start <ms>` and, 400 ms later, `<tag> end <ms>` to `log`.
const timed = (log, tag) => ['--', '-e',
  `const fs=require('fs');const w=(s)=>fs.appendFileSync(${JSON.stringify(log)},'${tag} '+s+' '+Date.now()+'\\n');`
  + `w('start');setTimeout(()=>w('end'),400);`];

const foreignLock = (lock, ageMs) => {
  fs.writeFileSync(lock, `${JSON.stringify({ pid: 4242, cwd: '/elsewhere', command: 'golden', since: new Date().toISOString() })}\n`);
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(lock, t, t);
};

// The point of the script: two wrapped runs never overlap. Each child holds for 400 ms; with
// the lock, one interval ends before the other starts. Without it they overlap by ~400 ms.
test('two concurrent wrapped runs are serialized', async (t) => {
  const { dir, lock } = scratch(t);
  const log = path.join(dir, 'log');
  const [a, b] = await Promise.all([wrapped(lock, timed(log, 'a')), wrapped(lock, timed(log, 'b'))]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  const at = {};
  for (const line of fs.readFileSync(log, 'utf8').trim().split('\n')) {
    const [tag, what, ms] = line.split(' ');
    at[`${tag}.${what}`] = Number(ms);
  }
  const apart = at['a.end'] <= at['b.start'] || at['b.end'] <= at['a.start'];
  assert.equal(apart, true, `intervals overlap: ${JSON.stringify(at)}`);
  assert.equal(fs.existsSync(lock), false, 'the last holder released the lock');
});

// A lock untouched for an hour (past the 60 s stale bound) belongs to a dead holder: it is taken
// over at once, never waited on, and released when the run ends.
test('a stale lock is taken over', async (t) => {
  const { lock } = scratch(t);
  foreignLock(lock, 3600_000);
  const r = await wrapped(lock, ['--', '-e', 'process.exit(0)'], { GENESEED_HEAVY_WAIT_S: '5' });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /took over a stale lock/);
  assert.equal(fs.existsSync(lock), false);
});

// A fresh lock is a live holder: the wrapper names it and waits, and runs once it is gone. The
// child records when it ran, which must be after the holder released.
test('a fresh foreign lock is waited on, then the run goes ahead', async (t) => {
  const { dir, lock } = scratch(t);
  foreignLock(lock, 0);
  const ran = path.join(dir, 'ran');
  let released = 0;
  setTimeout(() => { released = Date.now(); fs.rmSync(lock); }, 400);
  const r = await wrapped(lock, ['--', '-e', `require('fs').writeFileSync(${JSON.stringify(ran)}, String(Date.now()))`]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /waiting for pid 4242 in \/elsewhere running "golden"/);
  assert.ok(released > 0 && Number(fs.readFileSync(ran, 'utf8')) >= released, 'ran after the release');
});

// A wrapper started by a wrapped run (mutate --all runs suites, golden spawns shards) must not
// wait on its own parent's lock: with the marker set it runs at once and leaves the lock alone.
test('the re-entrancy marker skips the lock', async (t) => {
  const { lock } = scratch(t);
  foreignLock(lock, 0);
  const before = fs.readFileSync(lock, 'utf8');
  const r = await wrapped(lock, ['--', '-e', 'process.exit(0)'], { GENESEED_HEAVY_HELD: '1', GENESEED_HEAVY_WAIT_S: '0.2' });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(fs.readFileSync(lock, 'utf8'), before);
});

// A queue timeout is exit 75 and says it is not a test failure; the command never ran.
test('a queue timeout exits 75 and does not run the command', async (t) => {
  const { dir, lock } = scratch(t);
  foreignLock(lock, 0);
  const ran = path.join(dir, 'ran');
  const r = await wrapped(lock, ['--', '-e', `require('fs').writeFileSync(${JSON.stringify(ran)}, 'x')`],
    { GENESEED_HEAVY_WAIT_S: '0.3' });
  assert.equal(r.code, 75);
  assert.match(r.stderr, /QUEUE TIMEOUT — not a test failure/);
  assert.equal(fs.existsSync(ran), false);
  assert.equal(fs.existsSync(lock), true, 'the holder\'s lock is left in place');
});

// The child's exit code is the wrapper's, its stdout passes through untouched, and it carries
// the marker; the lock is released on a red run as on a green one.
test('the child exit code, stdout and marker pass through', async (t) => {
  const { lock } = scratch(t);
  const r = await wrapped(lock, ['--', '-e', 'process.stdout.write(process.env.GENESEED_HEAVY_HELD);process.exit(7)']);
  assert.equal(r.code, 7);
  assert.equal(r.stdout, '1');
  assert.equal(fs.existsSync(lock), false);
});

test('anything but `suite` or `-- <args>` is a usage error, exit 2', async (t) => {
  const { lock } = scratch(t);
  for (const args of [[], ['--'], ['golden'], ['suite', 'x']]) {
    const r = await wrapped(lock, args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.stderr, /usage:/);
  }
});
