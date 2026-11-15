#!/usr/bin/env node
/**
 * ONE HEAVY PROOF PER MACHINE. Several agents on one PC once ran three full suites and an
 * eight-shard `golden.mjs --cli` side by side: the CPU sat at 100 %, the PC stopped answering,
 * and a suite went red on load timeouts that no code change had caused. This wrapper takes a
 * machine-wide lock before it runs a heavy proof, so a second agent WAITS its turn and then runs.
 *
 *   node tests/heavy.mjs suite                    the full unit suite (AGENTS.md "Proving a change")
 *   node tests/heavy.mjs -- tests/golden.mjs --cli    any node arguments, passed verbatim
 *
 * THE CHILD IS NODE, NOT A SHELL. `process.execPath` with `shell: false` and the arguments as
 * given, so node itself expands the quoted test glob, exactly as when it is typed by hand. The
 * child inherits stdio and this script never writes to stdout: CI and the done gate count the TAP
 * on stdout, and every line of ours goes to stderr. The exit code is the child's, unchanged.
 *
 * THE LOCK PATH IS UNDER THE HOME DIRECTORY. Not `os.tmpdir()`, whose value differs between
 * sessions and hosts on one machine (each one would hold its own lock), and not
 * `~/.config/geneseed`, the machine tier `tests/shim_intact.mjs` guards. `GENESEED_HEAVY_LOCK`
 * moves it; the tests use that, so they never meet a real run's lock.
 *
 * STALE BY MTIME, NOT BY PID. Windows recycles pids, so a dead holder's pid can name a live
 * process. The holder touches the lock every HEARTBEAT_MS; a lock not touched for STALE_MS is
 * taken over. The takeover renames the stale file aside and compares what it moved with what it
 * judged stale: if another waiter took over first, the moved file is that waiter's live lock, and
 * it is linked back.
 *
 * RE-ENTRANT. The child gets `GENESEED_HEAVY_HELD=1`; a wrapper that sees it runs straight
 * through. `mutate.mjs --all` runs suites, and `golden.mjs` spawns shards: if those went through
 * this wrapper they would wait on their own parent's lock forever.
 *
 * THE WAIT IS BOUNDED (GENESEED_HEAVY_WAIT_S, default 30 min). A timeout exits QUEUE_TIMEOUT (75,
 * EX_TEMPFAIL) and says it is not a test failure, so nobody reads a queue for a red run. While it
 * waits it prints a line naming the holder at once and then every NOTICE_MS, so a watcher that
 * reads a stalled output as a hung process sees this one grow.
 *
 * A lock that cannot be made at all (an unwritable directory) exits SETUP_ERROR (71) with the real
 * error, also marked as no test failure.
 *
 * SIGNALS DIFFER BY PLATFORM. SIGINT and SIGTERM are forwarded with `child.kill`. On POSIX the
 * child gets the signal and can clean up. On Windows `child.kill` is a hard kill whatever the
 * signal: the child gets no chance to clean up. A `mutate.mjs --all` stopped that way leaves one
 * product file mutated; its journal restores the file on the script's next start.
 *
 * KNOWN GAPS. Kill only this wrapper hard (SIGKILL, Task Manager) and its child runs on unlocked;
 * the lock goes stale in STALE_MS and the next waiter starts beside it. A narrower one: three waiters meet one stale lock,
 * the first takes it, the second renames that live lock aside, and a third creates a lock before
 * the second can link it back. Two runs then overlap, and the first holder's heartbeat says it
 * lost the lock. That needs a dead holder and three waiters inside one poll; a lock with no
 * window would need an OS primitive that node does not offer.
 *
 * UNTESTED PATHS. `tests/unit/heavy_lock.test.mjs` covers the queue, a stale takeover, the
 * marker, the timeout, the setup error and the exit code. It does not reach the link-back of a
 * live lock moved aside, nor the heartbeat (10 s apart, so a row would need a minute-long run);
 * both are argued in the comments above them, not proven.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER = 'GENESEED_HEAVY_HELD';
const QUEUE_TIMEOUT = 75;
// The lock itself cannot be made (an unwritable directory, a create refused with no lock file
// there): neither a queue nor a red run, so it has its own code, EX_OSERR.
const SETUP_ERROR = 71;
const USAGE = 2;
const HEARTBEAT_MS = 10_000;
const STALE_MS = 60_000;
const NOTICE_MS = 45_000;
// `0` is a real value for both (no wait; a test's tight poll), so an unset or non-numeric
// variable is what falls back, never a zero.
const envNumber = (name, fallback) => {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
// A test knob: the tests poll at 50 ms so the queue rows take well under a second.
const POLL_MS = envNumber('GENESEED_HEAVY_POLL_MS', 5_000);
const WAIT_MS = envNumber('GENESEED_HEAVY_WAIT_S', 30 * 60) * 1000;
const LOCK = process.env.GENESEED_HEAVY_LOCK || path.join(os.homedir(), '.cache', 'geneseed', 'heavy.lock');

const say = (line) => process.stderr.write(`heavy: ${line}\n`);

function argsOf(argv) {
  if (argv.length === 1 && argv[0] === 'suite') {
    // `--test-concurrency=8` only off Windows: AGENTS.md says why it buys nothing there.
    return ['--test', ...(process.platform === 'win32' ? [] : ['--test-concurrency=8']),
      '--test-reporter=tap', 'tests/**/*.test.mjs'];
  }
  if (argv[0] === '--' && argv.length > 1) return argv.slice(1);
  return null;
}

const readOrNull = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// BUSY IS NOT AN ERROR. On Windows a lock its holder is deleting refuses a new create with EPERM,
// not EEXIST, and a file a waiter is reading refuses a delete with EBUSY or EPERM. Measured: 2 of
// 25 serialized runs crashed with EPERM on the create before this. Each one means "try again" —
// while a lock file is there. EPERM or EACCES with NO file there, and still so after a pending
// delete has had a second to clear, is a directory we cannot write: that is thrown, once.
const remove = (p) => {
  try { fs.rmSync(p, { force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* goes stale */ }
};

function create(mine) {
  for (let tries = 0; ; tries += 1) {
    try {
      fs.writeFileSync(LOCK, mine, { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code === 'EEXIST' || e.code === 'EBUSY') return false;
      if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      if (fs.existsSync(LOCK)) return false;
      if (tries >= 20) throw e;
      pause(50);
    }
  }
}

const fresh = (p) => {
  try { return Date.now() - fs.statSync(p).mtimeMs < STALE_MS; } catch { return false; }
};

/** Create the lock, or take over a stale one. True when it is ours, holding `mine`. */
function tryAcquire(mine) {
  if (create(mine)) return true;
  let mtime;
  try { mtime = fs.statSync(LOCK).mtimeMs; } catch { return false; }
  const judged = readOrNull(LOCK);
  if (judged === null || Date.now() - mtime < STALE_MS) return false;
  const aside = `${LOCK}.${process.pid}.stale`;
  try { fs.renameSync(LOCK, aside); } catch { return false; }
  // Judge what we MOVED, not what we looked at: between the two, another waiter may have taken
  // over (new content) or the holder may have beaten (new mtime). Either way it is a live lock.
  if (readOrNull(aside) !== judged || fresh(aside)) {
    try { fs.linkSync(aside, LOCK); } catch { /* a third holder exists; nothing better to do */ }
    remove(aside);
    return false;
  }
  remove(aside);
  say(`took over a stale lock (untouched ${Math.round((Date.now() - mtime) / 1000)} s): ${judged.trim()}`);
  return create(mine);
}

function holderLine() {
  let h = {};
  try { h = JSON.parse(readOrNull(LOCK) ?? '{}'); } catch { /* half-written; name what we can */ }
  const since = Date.parse(h.since);
  const elapsed = Number.isNaN(since) ? '?' : `${Math.round((Date.now() - since) / 1000)} s`;
  return `waiting for pid ${h.pid ?? '?'} in ${h.cwd ?? '?'} running "${h.command ?? '?'}" (for ${elapsed})`;
}

async function acquire(mine) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const start = Date.now();
  let noticed = -Infinity;
  for (;;) {
    if (tryAcquire(mine)) {
      if (noticed !== -Infinity) say(`lock taken after ${Math.round((Date.now() - start) / 1000)} s`);
      return true;
    }
    if (Date.now() - start >= WAIT_MS) return false;
    if (Date.now() - noticed >= NOTICE_MS) { say(holderLine()); noticed = Date.now(); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function run(args, onExit) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit', shell: false, env: { ...process.env, [MARKER]: '1' },
  });
  const forward = (sig) => () => child.kill(sig);
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  child.on('error', (e) => { say(`could not start node: ${e.message}`); onExit(1); });
  child.on('exit', (code, signal) => onExit(code ?? 128 + (os.constants.signals[signal] ?? 0)));
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (!args) {
    say('usage: node tests/heavy.mjs suite | node tests/heavy.mjs -- <node args…>');
    process.exit(USAGE);
  }
  if (process.env[MARKER]) {
    run(args, (code) => process.exit(code));
    return;
  }
  const mine = `${JSON.stringify({
    pid: process.pid, cwd: process.cwd(), command: args.join(' '), since: new Date().toISOString(),
  })}\n`;
  // A null read is no verdict: the file is briefly absent while a waiter links back a live lock
  // it moved aside, or unreadable while another process holds it. Only OTHER content means lost.
  const lockText = () => {
    for (let i = 0; i < 10; i += 1) {
      const text = readOrNull(LOCK);
      if (text !== null) return text;
      pause(20);
    }
    return null;
  };
  const leave = () => process.exit(130);
  process.on('SIGINT', leave);
  process.on('SIGTERM', leave);
  let got;
  try {
    got = await acquire(mine);
  } catch (e) {
    say(`SETUP ERROR — not a test failure: cannot make the lock ${LOCK}: ${e.message}`);
    process.exit(SETUP_ERROR);
  }
  if (!got) {
    say(`QUEUE TIMEOUT — not a test failure: still ${holderLine()} after ${WAIT_MS / 1000} s`);
    process.exit(QUEUE_TIMEOUT);
  }
  process.off('SIGINT', leave);
  process.off('SIGTERM', leave);
  const beat = setInterval(() => {
    const text = readOrNull(LOCK);
    if (text === null) return;
    if (text !== mine) { say('lost the lock (taken over as stale?); running on'); clearInterval(beat); return; }
    const now = new Date();
    try { fs.utimesSync(LOCK, now, now); } catch { /* next beat retries */ }
  }, HEARTBEAT_MS);
  run(args, (code) => {
    clearInterval(beat);
    if (lockText() === mine) remove(LOCK);
    process.exit(code);
  });
}

await main();
