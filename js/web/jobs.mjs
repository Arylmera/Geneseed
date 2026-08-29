/**
 * The web console's BACKGROUND JOBS — `JobManager`, its process-tree kill and the
 * `actionTable`.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS SPAWNS, WHEN NOTHING ELSE IN THIS REPO IS ALLOWED TO.
 *
 * `bin/geneseed-cli.mjs` carries a transitive `child_process` ALLOW-LIST (`ALLOWED_SPAWNS`
 * in `tests/unit/hook_cli.test.mjs`) whose criterion is not "this verb spawns" but "there
 * is no in-process equivalent, and the spawned thing is not this program". This module
 * spawns THIS PROGRAM, which reads like the passthrough the ban exists to prevent, so the
 * argument has to be made rather than assumed.
 *
 * ISOLATION IS THE DISCRIMINATOR. Node's server is single-threaded and every ported `cmdX`
 * is synchronous, so calling one in-process would block the event loop for the whole run —
 * and the console's only progress mechanism is `web/src/api/jobs.js` polling
 * `GET /api/jobs/<id>`. An in-process job therefore freezes the poll that exists to watch
 * it, which is worse than not showing progress: the UI cannot tell a running job from a
 * hung daemon. And a `process.exit` anywhere in a callee kills the DAEMON instead of the
 * job — `cmdRebuildAll` already had to grow a throwing `die` for exactly that reason.
 *
 * `worker_threads` IS THE ALTERNATIVE AND IT IS WORSE. It restores concurrency, but a worker
 * re-imports the world per job (the generator, the renderer, every host module), needs a
 * message protocol for stdout and the exit code that a pipe gives for nothing, and cannot
 * isolate a `process.exit` any better than the main thread can — `process.exit` in a worker
 * takes the worker down mid-write, which is the same truncation with more machinery. Strictly
 * more work for strictly less isolation.
 *
 * THE EXIT CODE IS EASIER OUT OF PROCESS, not harder. `_run` awaits the child's exit code
 * and stops the chain on the first non-zero. In-process that would be a return value
 * threaded through every verb's error paths, several of which currently end at
 * `process.exitCode`.
 *
 * SO THE ARGV IS `node bin/geneseed-cli.mjs <verb>` — or `node bin/build-driver.mjs <build
 * args>` for the three rows that run the GENERATOR, the same program by a different entry.
 * `process.execPath` is the running interpreter by absolute path, so stripping `node` off
 * PATH cannot change what starts. Nothing here can name `python`.
 *
 * THE SECOND SPAWN IS `taskkill`, and it is a different argument. `cancel()` must kill the
 * job's whole process TREE: killing only the direct child leaves ITS children holding the
 * stdout pipe, the read loop stays blocked and the job wedges on `running` forever. POSIX
 * gets that in-process (`detached: true` makes a process group and `process.kill(-pid)`
 * signals it). Windows has no process-group kill in Node's standard library at all, so
 * `taskkill /T` is a machine primitive here, not this program.
 *
 * ---------------------------------------------------------------------------------------
 * THE ACTION SURFACE — `doctor`, `build`, `build-all`, `export`, `uninstall`, `update`,
 * `link` and `unlink` each name a verb `bin/geneseed-cli.mjs` runs, plus the three
 * `INLINE_ACTIONS` the dispatcher answers without the table. `tests/unit/web_jobs.test.mjs`
 * holds the union against a written-out list, so a ninth action cannot appear unchecked.
 *
 * ---------------------------------------------------------------------------------------
 * THREE DETAILS OF `_run`, EACH A COMMENT EXPLAINING A BUG IT ALREADY FIXED.
 *
 * `GENESEED_WEB_JOB=1` tells `upgrade` it is running INSIDE this daemon so it must not
 * bounce the daemon mid-job — which would kill the job's own tracking and leave the
 * console on `running` forever. Set here and read by `js/maintain/update.mjs`.
 *
 * NO UNBUFFERING FLAG IS SET, and that absence is deliberate rather than an oversight:
 * Node's `process.stdout` on a pipe is not block-buffered by libc — every `write` is
 * queued on the stream and flushed by the event loop. The real hazard here is a child
 * calling `process.exit()` with writes still queued, which truncates them; both `bin/`
 * entries set `process.exitCode` and return instead, which is what makes an unbuffering
 * flag unnecessary rather than merely inapplicable.
 *
 * `MEM_CAP` truncates a runaway job's output FROM THE FRONT, so a job that prints forever
 * cannot eat the daemon's memory. `OUTPUT_CAP` is the smaller cap the history FILE keeps.
 *
 * ---------------------------------------------------------------------------------------
 * TWO DIVERGENCES, DECLARED.
 *
 * 1. THE TWO STREAMS ARE TWO PIPES, read and appended separately in arrival order — exact
 *    for a line-buffered child writing to only one stream (which is every row today:
 *    `rebuild-all` writes stdout only, `diff` writes stderr only), and potentially
 *    reordered for a child interleaving both within one tick. Named here rather than left
 *    to be discovered, should a future row ever write to both.
 * 2. `_append`'s cap slices UTF-16 code UNITS rather than code POINTS, unlike `tailChars`
 *    (used by the history file's cap via `Array.from`), which differs only past two
 *    million characters and only by a lone surrogate at the truncation front. The history
 *    cap can afford code-point precision because it runs once per job; doing that here,
 *    once per streamed chunk, would make a runaway job quadratic — the exact failure the
 *    cap exists to prevent.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';

import { ROOT, PACK_ORDER } from '../build/source.mjs';
import { setupBuildArgs } from '../build/generate.mjs';
import { isDict } from '../hosts/mcp.mjs';
import { readText, writeText, isFile } from '../lib/fs.mjs';
import { jsonDumpsCompact, parseJson, isTruthy } from '../lib/json.mjs';

/**
 * Terminate a job's WHOLE process tree.
 *
 * NEVER THROWS: it runs from `cancel()` and from the crash path in `_run`'s `catch`, and an
 * exception in either would leave the child alive with the manager believing it dead.
 */
export function killJobTree(child) {
  try {
    if (process.platform === 'win32') {
      // The one machine primitive with no Node equivalent — see this module's header.
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        timeout: 15000, windowsHide: true, stdio: 'ignore',
      });
    } else {
      // The process GROUP exists because `_run` spawns with `detached: true`.
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill();
    } catch { /* last resort already failed; nothing more to try */ }
  }
}

/**
 * Decodes a child's raw stdout/stderr bytes the way a text-mode read would: UTF-8, and
 * newlines folded regardless of the platform.
 *
 * TWO THINGS. `StringDecoder` holds a partial UTF-8 sequence across a chunk boundary — a
 * naive `buf.toString()` per chunk would turn one multi-byte character split across two
 * reads into two replacement characters. And CRLF / a lone CR are both folded to LF before
 * the caller ever sees them: spawned children write CRLF on Windows, and without the fold
 * the job output would carry CRLF on one platform and LF on the other.
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

/** Last `n` CODE POINTS (not UTF-16 units) of a string. */
const tailChars = (s, n) => (s.length <= n ? s : Array.from(s).slice(-n).join(''));

/** The signals `killJobTree` sends, mapped for the `-SIGNUM` return code convention. */
const SIGNUM = { SIGTERM: 15, SIGKILL: 9, SIGINT: 2, SIGHUP: 1 };

/**
 * One mutating action at a time, in the background, output captured.
 *
 * A CLASS rather than a factory-of-a-plain-object like `webState`, because this one has
 * real state and eleven methods over it; `webState` is a factory because its only
 * behaviour is two cached getters.
 *
 * NO LOCK GUARDS `_jobs`, `_busy` and `_procs`, and that absence is deliberate: Node has
 * one thread and no pre-emption inside a synchronous block, so every critical section here
 * is already atomic — a mutex would be a no-op object claiming a hazard that cannot occur.
 * What matters instead is which sequences must not be interrupted, and none of them await.
 *
 * DELIBERATELY NO `wait()`: nothing here calls it, and an untested, caller-less method is
 * exactly the shape this repo keeps getting bitten by.
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
      if (isDict(j) && isTruthy(j.id) && j.status !== 'running') this._jobs.set(String(j.id), j);
    }
  }

  _saveHistory() {
    if (!this._historyPath) return;
    const jobs = [...this._jobs.values()].filter((j) => j.status !== 'running')
      .map((j) => ({ ...j }));
    // STABLE sort matters: two jobs started inside the same clock tick keep insertion
    // order rather than swapping unpredictably.
    jobs.sort((a, b) => (Number(a.started ?? 0) || 0) - (Number(b.started ?? 0) || 0));
    const kept = jobs.slice(-JobManager.HISTORY_MAX)
      .map((j) => ({ ...j, output: tailChars(String(j.output), JobManager.OUTPUT_CAP) }));
    try {
      writeText(this._historyPath, jsonDumpsCompact(kept, { bareInts: true }));
    } catch { /* a console that cannot persist its history still runs */ }
  }

  /** Last `n` jobs, oldest first — the order the console appends in. */
  recent(n = JobManager.HISTORY_MAX) {
    const jobs = [...this._jobs.values()]
      .sort((a, b) => (Number(a.started ?? 0) || 0) - (Number(b.started ?? 0) || 0));
    return jobs.slice(-n).map((j) => ({ ...j }));
  }

  /**
   * `cmds` is a LIST OF ARGVS, run in order, stopping at the first failure. `null` when a
   * job is already running, which the HTTP layer maps to 409.
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
    // Hand the work to the scheduler and return the id NOW, so the 202 goes out before the
    // child has produced a byte.
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
          // No console window for a child of a windowless daemon.
          windowsHide: true,
          // POSIX only: the process GROUP `killJobTree` signals.
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
      // `p.pid` is undefined when the spawn itself failed, which this check guards against.
      if (p !== null && p.pid && p.exitCode === null && p.signalCode === null) killJobTree(p);
    } finally {
      this._procs.delete(jid);
      const j = this._jobs.get(jid);
      j.status = rc === 0 ? 'done' : 'failed';
      j.returncode = rc;
      // ponytail: `Math.round` breaks a .x5 tie away from zero rather than to even —
      // unreachable for a wall-clock delta, and the field is a display value only.
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
   * Read to EOF, then the exit code.
   *
   * Resolves on `close`, not `exit`: `exit` fires when the process dies and `close` only
   * once its stdio have also closed, and resolving on the former would let a job report
   * `done` with its last lines still sitting in the pipe.
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
        // Node splits the exit code and the signal into two arguments, with the code
        // `null` when a signal won. Only `cancel()` produces one, and only on POSIX, so the
        // map above covers what this program SENDS rather than every signal that exists.
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
 * Action name -> a list of argvs, each a separate step, stopping at the first failure.
 *
 * THE TABLE IS THE DISPATCH, so `PORTED_ACTIONS` is its own keys rather than a list beside
 * it — the same rule `POST_ROUTES` establishes one file over.
 *
 * `build` renders the DEPLOYED install in its detected theme + emit + footprint + posture +
 * mode, so a rebuild from an imperial, lean, mentor, foreman opencode-global install stays
 * all five. `update` and `export` self-resolve the deployed theme downstream and take no
 * args.
 *
 * THE ARGV HEAD IS `process.execPath` + `bin/geneseed-cli.mjs` (or `bin/build-driver.mjs`
 * for the rows that run the generator) — the running interpreter by absolute path and this
 * repo's own CLI, never a name any other runtime could shadow.
 */
const NODE = () => process.execPath;
const CLI = () => path.join(ROOT, 'bin', 'geneseed-cli.mjs');
const GEN = () => path.join(ROOT, 'bin', 'build-driver.mjs');

/**
 * The three actions the dispatcher answers INLINE, without consulting the table above:
 * `restore` is synchronous and returns a result rather than a job id, and `install`/`deploy`
 * resolve their argv from the request body first. Declared so the surface check covers every
 * action the dispatcher answers, not only the table's keys.
 */
export const INLINE_ACTIONS = ['restore', 'install', 'deploy'];

/**
 * ⚠ `doctrines` DEFAULTS TO THE FULL SET, and it is the one axis here whose default is not the
 * generator's own. `theme`/`emit`/`footprint`/`posture`/`mode` fall back to a frozen literal
 * that costs nothing when it is wrong; a missing `--doctrines` falls through to
 * `harness.config.json`, and a `{"doctrines":["craft"]}` there re-emits the deployed install
 * without its commit/push consent gate. So a caller that forgets the axis gets ALL packs —
 * unknown resolves to the full set, never to a config value (`doctrinesForBuild`).
 *
 * `excludeRules` is the same argument one tier down and it defaults the same way — to the
 * SAFE end, which here is the empty list. An omitted flag would fall through to
 * `harness.config.json` exactly as the pack list does, so `{"excludeRules":["process.5"]}`
 * there would take the consent gate out of a console Build that never asked for it. `[]` is
 * spelled `--exclude-rules none` and says "exclude nothing" out loud.
 */
function actionTable({
  theme = 'neutral', emit = 'opencode-global', footprint = 'full',
  posture = 'peer', mode = 'direct', doctrines = [...PACK_ORDER], excludeRules = [],
} = {}) {
  const buildArgv = setupBuildArgs(theme, emit, null, null, footprint, posture, mode,
    doctrines, PACK_ORDER, excludeRules);
  return {
    doctor: [[NODE(), CLI(), 'doctor']],
    build: [[NODE(), GEN(), ...buildArgv]],
    // Rebuild EVERY active install in place (each in its own theme+emit). The per-install
    // resolution lives in the rebuild-all subcommand, so the web layer threads no theme/emit.
    'build-all': [[NODE(), CLI(), 'rebuild-all']],
    // `update` is the action name here; `upgrade` is the VERB it runs. The daemon bounce
    // this job must not do itself is `GENESEED_WEB_JOB`'s job, set by `_run` above and read
    // by `js/maintain/update.mjs`.
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
  // `null` for anything the table does not name, which the HTTP layer maps to
  // `{"error": "unknown action <x>"}` at 404.
  return Object.hasOwn(table, action) ? table[action] : null;
}

/** `actionTable`'s own keys — the table IS the declaration, so this cannot drift from it. */
export const PORTED_ACTIONS = Object.keys(actionTable());
