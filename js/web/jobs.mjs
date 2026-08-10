/**
 * The web console's BACKGROUND JOBS — `rituals/_web_jobs.py`'s `JobManager`, its process-tree
 * kill and the `action_commands` table.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS SPAWNS, WHEN NOTHING ELSE IN THE PORT IS ALLOWED TO.
 *
 * `bin/geneseed-cli.mjs` carries a transitive `child_process` ALLOW-LIST
 * (`tests/test_hook_cli_parity.py::_ALLOWED_SPAWNS`) whose criterion is not "this verb
 * spawns" — `build` spawns on the reference and is refused there — but "there is no
 * in-process equivalent, and the spawned thing is not this program". This module spawns THIS
 * PROGRAM, which reads like the passthrough the whole port exists to remove, so the argument
 * has to be made rather than assumed.
 *
 * ISOLATION IS THE DISCRIMINATOR, and it is a property of the RUNTIME, not of the verbs.
 * The reference's daemon is threaded: `start()` hands the work to a `threading.Thread` and
 * the HTTP server keeps answering from another. Node's server is single-threaded and every
 * ported `cmdX` is synchronous, so calling one in-process would block the event loop for the
 * whole run — and the console's only progress mechanism is `web/src/api/jobs.js` polling
 * `GET /api/jobs/<id>`. An in-process job therefore freezes the poll that exists to watch it,
 * which is worse than not showing progress: the UI cannot tell a running job from a hung
 * daemon. And a `process.exit` anywhere in a callee kills the DAEMON instead of the job —
 * `cmdRebuildAll` already had to grow a throwing `die` for exactly that reason (P5f).
 *
 * `worker_threads` IS THE ALTERNATIVE AND IT IS WORSE. It restores concurrency, but a worker
 * re-imports the world per job (the generator, the renderer, every host module), needs a
 * message protocol for stdout and the exit code that a pipe gives for nothing, and cannot
 * isolate a `process.exit` any better than the main thread can — `process.exit` in a worker
 * takes the worker down mid-write, which is the same truncation with more machinery. Strictly
 * more work for strictly less isolation.
 *
 * THE EXIT CODE IS EASIER OUT OF PROCESS, not harder. `_run` reads `p.returncode` and stops
 * the chain on the first non-zero. In-process that would be a return value threaded through
 * every verb's error paths, several of which currently end at `process.exitCode`.
 *
 * SO THE ARGV IS `node bin/geneseed-cli.mjs <verb>` — or `node bin/geneseed.mjs <build args>`
 * for the three rows that run the GENERATOR, which is `build.py`'s twin and the same program
 * by a different entry. `process.execPath` is the running interpreter by absolute path, so
 * stripping `node` off PATH cannot change what starts. Nothing here can name `python`.
 *
 * THE SECOND SPAWN IS `taskkill`, and it is a different argument. `cancel()` must kill the
 * job's whole process TREE — the reference's comment says why: killing only the direct child
 * leaves ITS children holding the stdout pipe, the read loop stays blocked and the job wedges
 * on `running` forever. POSIX gets that in-process (`detached: true` makes a process group and
 * `process.kill(-pid)` signals it). Windows has no process-group kill in Node's standard
 * library at all, and `taskkill /T` is what the reference reaches for too. It is a machine
 * primitive, not this program.
 *
 * ---------------------------------------------------------------------------------------
 * THE PARTITION — six of the eight action rows cross and two do not.
 *
 * `doctor`, `build`, `build-all`, `export`, `uninstall` and — since P8c — `update` all name a
 * verb that has crossed. `link`/`unlink` run `harness.py link|unlink` (P10b). A Node runner
 * that spawned `python harness.py link` for those would put Python back into a "no Python
 * needed" install, so they are DECLARED in `NOT_PORTED_ACTIONS` and answered 501 by the
 * dispatcher, and P10b ends by deleting both rows. `tests/test_web_jobs.py` cross-checks the
 * two sets against `action_commands`' own keys with `ast`, so a NINTH row added to the
 * reference cannot quietly answer "unknown action".
 *
 * ---------------------------------------------------------------------------------------
 * THREE DETAILS OF `_run`, EACH A COMMENT EXPLAINING A BUG IT ALREADY FIXED.
 *
 * `GENESEED_WEB_JOB=1` tells `upgrade` it is running INSIDE this daemon so it must not bounce
 * the daemon mid-job — which killed the job's own tracking and left the console on `running`
 * forever. It was set here before any ported row read it, because it was P6g's CONTRACT WITH
 * P8, and a contract written after the fact is a contract that was broken once first. P8a is
 * where `js/update.mjs` began honouring it, and P8c is where the `update` row that triggers
 * it crossed — so it is a live pair now rather than a promise.
 *
 * `PYTHONUNBUFFERED=1` reaches the Python child AND its own Python children, or their stdout
 * is block-buffered into the pipe and the console looks stuck. THE EQUIVALENT THOUGHT FOR
 * NODE, which is the port and not the copy: there is no unbuffering flag to set, because
 * Node's `process.stdout` on a pipe is not block-buffered by libc — every `write` is queued on
 * the stream and flushed by the event loop. The analogous hazard is a child calling
 * `process.exit()` with writes still queued, which truncates them; both `bin/` entries set
 * `process.exitCode` and return instead, which is what makes the flag unnecessary rather than
 * merely inapplicable. So the variable is NOT set: it would be cargo, and the honest
 * statement is this paragraph.
 *
 * `MEM_CAP` truncates a runaway job's output FROM THE FRONT, so a job that prints forever
 * cannot eat the daemon's memory. `OUTPUT_CAP` is the smaller cap the history FILE keeps.
 *
 * ---------------------------------------------------------------------------------------
 * TWO DIVERGENCES, DECLARED.
 *
 * 1. THE TWO STREAMS ARE TWO PIPES. `stderr=subprocess.STDOUT` merges them in the OPERATING
 *    SYSTEM, so the reference's interleaving is exact. Node's `stdio` cannot name an
 *    already-created pipe, so `stdout` and `stderr` are read separately and appended in
 *    arrival order — identical for a line-buffered child writing to one stream (which is
 *    every ported row: `rebuild-all` writes stdout only, `diff` writes stderr only), and
 *    potentially reordered for a child interleaving both within one tick. No cell can see it,
 *    and it is named here rather than left to be discovered.
 * 2. `_append`'s cap slices UTF-16 code UNITS where Python slices code POINTS. It differs only
 *    past two million characters and only by a lone surrogate at the truncation front. The
 *    history file's cap does the exact thing (`Array.from`), because it runs once per job
 *    rather than once per line — doing it here would make a runaway job quadratic, which is
 *    the failure the cap exists to prevent.
 *
 * NOT PORTED: `JobManager.wait`. It has no caller in `rituals/` — `tests/test_web.py` is its
 * only consumer, twenty times over. Its Node twin is owed the day a Node-side corpus drives
 * the manager directly, which is P9's; until then it would be a function with no caller and no
 * cell, which is the shape this port keeps being bitten by.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';

import { ROOT } from '../checkout.mjs';
import { setupBuildArgs } from '../generate.mjs';
import { isDict } from '../mcp.mjs';
import { jsonDumpsCompact, parseJson, pyTruthy, readText, writeText } from '../lib/pyfs.mjs';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/**
 * `_kill_job_tree` — terminate a job's WHOLE process tree.
 *
 * NEVER THROWS, as the reference's two nested `except`s do not: it runs from `cancel()` and
 * from the crash path in `_run`'s `catch`, and an exception in either would leave the child
 * alive with the manager believing it dead.
 */
export function killJobTree(child) {
  try {
    if (process.platform === 'win32') {
      // The one machine primitive with no Node equivalent — see this module's header.
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        timeout: 15000, windowsHide: true, stdio: 'ignore',
      });
    } else {
      // `os.killpg(p.pid, SIGTERM)`. The group exists because `_run` spawns with
      // `detached: true`, which is `start_new_session=True`.
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill();
    } catch { /* `except OSError: pass` */ }
  }
}

/**
 * `Popen(..., text=True, encoding="utf-8", errors="replace")` — the decode Python's text mode
 * performs and Node's pipes do not.
 *
 * TWO THINGS, and the second is the one a port drops. `StringDecoder` holds a partial UTF-8
 * sequence across a chunk boundary (a naive `buf.toString()` per chunk turns one multi-byte
 * character split across two reads into two replacement characters — the exact defect P5i
 * found when a helper reached its second owner). And Python decodes in UNIVERSAL NEWLINES
 * mode, so `\r\n` and a lone `\r` are both `\n` before the caller ever sees them — while Node
 * hands back the bytes. The reference's children are Python processes writing CRLF on Windows;
 * the twin's are Node processes doing the same. Without the fold the job output would carry
 * CRLF on one side and LF on the other, which is P5b's eighth coverage hole with the
 * normalising transport removed.
 *
 * The pending `\r` is held rather than translated on the spot: a `\r\n` split across two
 * chunks would otherwise become two newlines.
 */
function textDecoder(sink) {
  const dec = new StringDecoder('utf8');
  let pendingCR = false;
  const emit = (s) => {
    if (pendingCR) {
      s = `\r${s}`;
      pendingCR = false;
    }
    if (s.endsWith('\r')) {
      s = s.slice(0, -1);
      pendingCR = true;
    }
    if (s) sink(s.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  };
  return {
    push: (buf) => emit(dec.write(buf)),
    end: () => {
      let s = dec.end();
      if (pendingCR) {
        s = `\r${s}`;
        pendingCR = false;
      }
      if (s) sink(s.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    },
  };
}

/** `s[-n:]` by CODE POINT, which is what Python slices. */
const tailChars = (s, n) => (s.length <= n ? s : Array.from(s).slice(-n).join(''));

/** The signals `killJobTree` sends, for the `-SIGNUM` return code Python reports. */
const SIGNUM = { SIGTERM: 15, SIGKILL: 9, SIGINT: 2, SIGHUP: 1 };

/**
 * `_web_jobs.JobManager` — one mutating action at a time, in the background, output captured.
 *
 * A CLASS rather than P6b's factory-of-a-plain-object, because this one has real state and
 * eleven methods over it; `webState` is a factory because its only behaviour is two cached
 * getters.
 *
 * THE LOCK IS GONE AND ITS ABSENCE IS THE PORT. `self._lock` guards `_jobs`, `_busy` and
 * `_procs` against the run thread and the request threads. Node has one thread and no
 * pre-emption inside a synchronous block, so every critical section here is already atomic —
 * a mutex would be a no-op object whose presence claimed a hazard that cannot occur. What the
 * lock's placement DOES carry over is which sequences must not be interrupted, and none of
 * them awaits.
 */
export class JobManager {
  static HISTORY_MAX = 20;

  static OUTPUT_CAP = 20000;      // chars of output kept per job in the history file

  static MEM_CAP = 2000000;       // chars kept in memory per job while it runs

  constructor(historyPath = null) {
    this._jobs = new Map();
    this._busy = false;
    this._procs = new Map();
    this._historyPath = historyPath;
    this._loadHistory();
  }

  /**
   * A `running` entry in the file means the SERVER died mid-run, so it is dropped rather than
   * restored: nothing will ever finish it, and a console showing it would wait forever.
   */
  _loadHistory() {
    if (!this._historyPath || !isFile(this._historyPath)) return;
    let jobs;
    try {
      jobs = parseJson(readText(this._historyPath));
    } catch {
      return;
    }
    for (const j of Array.isArray(jobs) ? jobs : []) {
      if (isDict(j) && pyTruthy(j.id) && j.status !== 'running') this._jobs.set(String(j.id), j);
    }
  }

  _saveHistory() {
    if (!this._historyPath) return;
    const jobs = [...this._jobs.values()].filter((j) => j.status !== 'running')
      .map((j) => ({ ...j }));
    // `sort(key=...)` is STABLE in both languages, which matters: two jobs started inside the
    // same clock tick keep insertion order rather than swapping between the two runtimes.
    jobs.sort((a, b) => (Number(a.started ?? 0) || 0) - (Number(b.started ?? 0) || 0));
    const kept = jobs.slice(-JobManager.HISTORY_MAX)
      .map((j) => ({ ...j, output: tailChars(String(j.output), JobManager.OUTPUT_CAP) }));
    try {
      writeText(this._historyPath, jsonDumpsCompact(kept, { bareInts: true }));
    } catch { /* `except OSError: pass` — a console that cannot persist still runs */ }
  }

  /** Last `n` jobs, oldest first — the order the console appends in. */
  recent(n = JobManager.HISTORY_MAX) {
    const jobs = [...this._jobs.values()]
      .sort((a, b) => (Number(a.started ?? 0) || 0) - (Number(b.started ?? 0) || 0));
    return jobs.slice(-n).map((j) => ({ ...j }));
  }

  /**
   * `start(action, *cmds, on_done=None)` — `cmds` is a LIST OF ARGVS, run in order, stopping
   * at the first failure. `null` when a job is already running, which the HTTP layer maps
   * to 409.
   */
  start(action, cmds, onDone = null) {
    if (this._busy) return null;
    this._busy = true;
    const jid = randomBytes(8).toString('hex');
    this._jobs.set(jid, {
      id: jid,
      action,
      status: 'running',
      output: '',
      returncode: null,
      started: Date.now() / 1000,
      duration: null,
    });
    // The reference's `threading.Thread(...).start()`: hand the work to the scheduler and
    // return the id NOW, so the 202 goes out before the child has produced a byte.
    void this._run(jid, cmds, onDone);
    return jid;
  }

  _append(jid, text) {
    const j = this._jobs.get(jid);
    j.output += text;
    if (j.output.length > JobManager.MEM_CAP) {
      // Code UNITS, not code points — see this module's header for why the exact slice lives
      // in `_saveHistory` and not here.
      j.output = j.output.slice(-JobManager.MEM_CAP);
    }
  }

  async _run(jid, cmds, onDone = null) {
    let rc = 0;
    let p = null;
    try {
      for (let i = 0; i < cmds.length; i += 1) {
        const cmd = cmds[i];
        this._append(jid, `$ ${cmd.map((c) => String(c)).join(' ')}\n`);
        p = spawn(cmd[0], cmd.slice(1), {
          cwd: ROOT,
          stdio: ['ignore', 'pipe', 'pipe'],
          // `harness.NO_WINDOW`: no console window for a child of a windowless daemon.
          windowsHide: true,
          // `start_new_session=True` on POSIX — the process GROUP `killJobTree` signals.
          detached: process.platform !== 'win32',
          env: { ...process.env, GENESEED_WEB_JOB: '1' },
        });
        this._procs.set(jid, p);       // reachable for cancel()
        rc = await this._pump(jid, p);
        this._procs.delete(jid);
        if (rc !== 0) {
          const left = cmds.length - i - 1;
          this._append(jid, `\n[web] ✗ command exited with code ${rc}`
            + (left ? ` — skipping the ${left} remaining step(s).\n` : '.\n'));
          break;
        }
      }
    } catch (e) {
      this._append(jid, `\n[web] job crashed: ${e && e.message ? e.message : e}`);
      rc = 1;
      // Don't orphan the child on a crash of OUR side: kill its tree, or it lingers.
      // `p.pid` is undefined when the spawn itself failed, which is the `p is not None`
      // arm the reference cannot reach at all (its `Popen` raises before the assignment).
      if (p !== null && p.pid && p.exitCode === null && p.signalCode === null) killJobTree(p);
    } finally {
      this._procs.delete(jid);
      const j = this._jobs.get(jid);
      j.status = rc === 0 ? 'done' : 'failed';
      j.returncode = rc;
      // `round(x, 1)`. ponytail: JS rounds a .x5 tie away from zero where Python rounds to
      // even — unreachable for a wall-clock delta, and the field is a display value.
      j.duration = Math.round((Date.now() / 1000 - Number(j.started)) * 10) / 10;
      this._busy = false;
      this._saveHistory();
      if (onDone) {
        try {
          onDone(rc);          // callbacks take the exit code (0 = every step ok)
        } catch { /* refresh must never kill the job */ }
      }
    }
  }

  /**
   * `for line in p.stdout: ...` then `p.wait()` — read to EOF, then the exit code.
   *
   * BOTH `close` AND the two stream ENDS are awaited, not just `exit`: `exit` fires when the
   * process dies and `close` when its stdio have also closed, and resolving on the former
   * would let a job report `done` with its last lines still in the pipe. That is the same
   * ordering the reference gets for free by draining `p.stdout` to EOF before `p.wait()`.
   */
  _pump(jid, p) {
    return new Promise((resolve, reject) => {
      const sink = (s) => this._append(jid, s);
      const out = textDecoder(sink);
      const err = textDecoder(sink);
      p.stdout.on('data', (b) => out.push(b));
      p.stderr.on('data', (b) => err.push(b));
      p.on('error', reject);
      p.on('close', (code, signal) => {
        out.end();
        err.end();
        // `p.returncode` for a signalled child is `-SIGNUM`, and Node splits the exit code
        // and the signal into two arguments with the code `null` when a signal won. Only
        // `cancel()` produces one, and only on POSIX — which no cell can reach, so the map
        // covers what this program SENDS rather than every signal that exists.
        resolve(code === null ? -(SIGNUM[signal] ?? 1) : code);
      });
    });
  }

  /**
   * Terminate the running job's subprocess; the run thread then winds down normally (stdout
   * closes, the exit code is non-zero, the status becomes `failed`).
   */
  cancel(jid) {
    const p = this._procs.get(jid);
    const j = this._jobs.get(jid);
    if (p === undefined || !j || j.status !== 'running') return false;
    this._append(jid, '\n[web] cancelled by user.\n');
    killJobTree(p);
    return true;
  }

  get(jid) {
    const j = this._jobs.get(jid);
    return j ? { ...j } : null;
  }
}

/**
 * `_web_jobs.action_commands` — action name -> a list of argvs, each a separate step, stopping
 * at the first failure.
 *
 * THE TABLE IS THE DISPATCH, so `PORTED_ACTIONS` is its own keys rather than a list beside it
 * (the rule `POST_ROUTES` established one file over, for the reason M23 gave).
 *
 * `build` renders the DEPLOYED install in its detected theme + emit + footprint + posture +
 * mode, so a rebuild from an imperial, lean, mentor, foreman opencode-global install stays all
 * five. `update` and `export` self-resolve the deployed theme downstream and take no args.
 *
 * THE ARGV HEAD IS THE PORT. The reference names `sys.executable` and `rituals/harness.py` (or
 * `build.py`); this names `process.execPath` and `bin/geneseed-cli.mjs` (or `bin/geneseed.mjs`,
 * which is `build.py`'s twin). The two can never be byte-equal, `tests/web_golden.py`
 * normalises the `$ <argv>` echo line for that reason, and `tests/test_web_jobs.py` asserts
 * each side's head ABSOLUTELY while comparing the tails literally — which is where a real port
 * bug would live.
 */
const NODE = () => process.execPath;
const CLI = () => path.join(ROOT, 'bin', 'geneseed-cli.mjs');
const GEN = () => path.join(ROOT, 'bin', 'geneseed.mjs');

/**
 * The rows whose VERB has not crossed. **EMPTY SINCE P10b, AND STILL DECLARED.**
 *
 * P6g opened it with three rows and wrote the rule that closes it: each removed by the phase
 * that ports its verb. `update` left in P8c; `link` and `unlink` left in P10b, which is the
 * phase that also had to decide whether those two verbs should exist under npm at all
 * (`js/link.mjs`'s docblock carries the argument, and the deciding vote was these two rows —
 * the console's Settings buttons POST here, and only a ported verb can answer them).
 *
 * WHY AN EMPTY SET RATHER THAN A DELETED ONE. The `ast` cross-check in
 * `tests/test_web_jobs.py` reads this set against `action_commands`' own keys, and an empty
 * set is the strongest form that check ever takes: it asserts that EVERY action the reference
 * dispatches on is answered by the Node runner. Deleting the declaration would delete that
 * assertion, and the next unported action would come back as a silent 404 — the thing the
 * 501 exists to prevent.
 *
 * A 501 AND NOT THE 404 THE TABLE WOULD PRODUCE. `action_commands` returns `None` for an
 * unknown action and the reference maps that to `{"error": "unknown action <x>"}` at 404 — so
 * a real-but-unported action falling through would answer the same thing a typo gets. With
 * this set empty the 501 branch is now UNREACHABLE by construction, which is exactly what the
 * dispatcher probe in `tests/test_web_server.py` asserts: every real action answers 202 and
 * only an invented one answers 404.
 */
export const NOT_PORTED_ACTIONS = new Set();

/**
 * The three actions `_post_routes` answers INLINE, without consulting the table: `restore` is
 * synchronous and returns a result rather than a job id, and `install`/`deploy` resolve their
 * argv from the request body first. Declared so the `ast` cross-check covers every `action ==`
 * the reference dispatches on, not only the table's keys.
 */
export const INLINE_ACTIONS = ['restore', 'install', 'deploy'];

function actionTable({
  theme = 'neutral', emit = 'opencode-global', footprint = 'full',
  posture = 'peer', mode = 'direct',
} = {}) {
  const buildArgv = setupBuildArgs(theme, emit, null, null, footprint, posture, mode);
  return {
    doctor: [[NODE(), CLI(), 'doctor']],
    build: [[NODE(), GEN(), ...buildArgv]],
    // Rebuild EVERY active install in place (each in its own theme+emit). The per-install
    // resolution lives in the rebuild-all subcommand, so the web layer threads no theme/emit.
    'build-all': [[NODE(), CLI(), 'rebuild-all']],
    // P8c. The row names `upgrade`, which is the VERB; `update` is the action name here and
    // argparse's alias there, and the reference's own row is `[py, harness.py, "upgrade"]` for
    // the same reason. The daemon bounce this job must not do itself is `GENESEED_WEB_JOB`'s
    // job, set by `_run` above and read by `js/update.mjs` — P6g's contract with P8, honoured.
    update: [[NODE(), CLI(), 'upgrade']],
    export: [[NODE(), CLI(), 'diff', '--out']],
    // Local-machine maintenance, surfaced in the web Settings. uninstall keeps memory (never
    // deleted) and runs non-interactively with --yes.
    link: [[NODE(), CLI(), 'link']],
    unlink: [[NODE(), CLI(), 'unlink']],
    uninstall: [[NODE(), CLI(), 'uninstall', '--yes']],
  };
}

export function actionCommands(action, opts = {}) {
  const table = actionTable(opts);
  // `dict.get(action)` — `None` for anything the table does not name, which the HTTP layer
  // maps to `{"error": "unknown action <x>"}` at 404.
  return Object.hasOwn(table, action) ? table[action] : null;
}

/** `action_commands`' own keys — the table IS the declaration, so this cannot drift from it. */
export const PORTED_ACTIONS = Object.keys(actionTable());
