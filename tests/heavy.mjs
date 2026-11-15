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
 * KNOWN GAP: kill only this wrapper hard (SIGKILL, Task Manager) and its child runs on unlocked;
 * the lock goes stale in STALE_MS and the next waiter starts beside it. SIGINT and SIGTERM are
 * forwarded to the child, which avoids this. A narrower one: three waiters meet one stale lock,
 * the first takes it, the second renames that live lock aside, and a third creates a lock before
 * the second can link it back. Two runs then overlap, and the first holder's heartbeat says it
 * lost the lock. That needs a dead holder and three waiters inside one poll; a lock with no
 * window would need an OS primitive that node does not offer.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER = 'GENESEED_HEAVY_HELD';
const QUEUE_TIMEOUT = 75;
const USAGE = 2;
const HEARTBEAT_MS = 10_000;
const STALE_MS = 60_000;
const NOTICE_MS = 45_000;
// A test knob: the tests poll at 50 ms so the queue rows take well under a second.
const POLL_MS = Number(process.env.GENESEED_HEAVY_POLL_MS) || 5_000;
const WAIT_MS = (Number(process.env.GENESEED_HEAVY_WAIT_S) || 30 * 60) * 1000;
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

/** Create the lock, or take over a stale one. True when it is ours, holding `mine`. */
function tryAcquire(mine) {
  try {
    fs.writeFileSync(LOCK, mine, { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  let mtime;
  try { mtime = fs.statSync(LOCK).mtimeMs; } catch { return false; }
  const judged = readOrNull(LOCK);
  if (judged === null || Date.now() - mtime < STALE_MS) return false;
  const aside = `${LOCK}.${process.pid}.stale`;
  try { fs.renameSync(LOCK, aside); } catch { return false; }
  if (readOrNull(aside) !== judged) {
    // Another waiter took over between our read and our rename: this is its live lock.
    try { fs.linkSync(aside, LOCK); } catch { /* a third holder exists; nothing better to do */ }
    fs.rmSync(aside, { force: true });
    return false;
  }
  fs.rmSync(aside, { force: true });
  say(`took over a stale lock (untouched ${Math.round((Date.now() - mtime) / 1000)} s): ${judged.trim()}`);
  try {
    fs.writeFileSync(LOCK, mine, { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return false;
  }
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
  const ours = () => readOrNull(LOCK) === mine;
  const leave = () => process.exit(130);
  process.on('SIGINT', leave);
  process.on('SIGTERM', leave);
  if (!(await acquire(mine))) {
    say(`QUEUE TIMEOUT — not a test failure: still ${holderLine()} after ${WAIT_MS / 1000} s`);
    process.exit(QUEUE_TIMEOUT);
  }
  process.off('SIGINT', leave);
  process.off('SIGTERM', leave);
  const beat = setInterval(() => {
    if (!ours()) { say('lost the lock (taken over as stale?); running on'); clearInterval(beat); return; }
    const now = new Date();
    try { fs.utimesSync(LOCK, now, now); } catch { /* next beat retries */ }
  }, HEARTBEAT_MS);
  run(args, (code) => {
    clearInterval(beat);
    if (ours()) fs.rmSync(LOCK, { force: true });
    process.exit(code);
  });
}

await main();
