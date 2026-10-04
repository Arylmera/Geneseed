/**
 * The daemon — its on-disk record, and the lifecycle that starts, probes, stops and restarts it.
 *
 * `geneseed web` can run in the foreground or detached. Detached is the interesting half: the
 * record at `.geneseed-web.json` is how a later `web stop` or `web status` finds a server nobody
 * kept a handle to, and `probe` is the liveness question every one of those verbs asks first.
 *
 * TWO OF THIS PACKAGE'S THREE SPAWNS ARE HERE — the detached daemon and the desktop URL opener —
 * and both are declared by name in `tests/unit/hook_cli.test.mjs`'s spawn allow-list. A new spawn
 * in this file is a deliberate act that reddens that gate until it is declared.
 */
import { printOut, writeText } from '../lib/fs.mjs';
import { isTruthy, jsonDumpsCompact } from '../lib/json.mjs';
import { webState } from './state.mjs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';

const ROOT = pathResolve(import.meta.dirname, '..', '..');

// ---- the daemon record -----------------------------------------------------

/**
 * Which code a console serves: the package version and a hash of the `web/dist/index.html` it
 * would load. A daemon writes the stamp it started with into its record; an npm upgrade or a
 * `git pull` that replaces `web/dist/` changes the stamp on disk, and the daemon — still
 * serving the old `index.html`, whose chunk hashes may no longer exist — is then STALE.
 * Read fresh on every call: the comparison is against the files as they are NOW.
 */
export function codeStamp(root = ROOT) {
  const read = (rel) => { try { return readFileSync(join(root, rel)); } catch { return ''; } };
  let version = 'unknown';
  try { version = JSON.parse(read('package.json')).version ?? version; } catch { /* unknown */ }
  const html = createHash('sha256').update(read(join('web', 'dist', 'index.html'))).digest('hex');
  return `${version}:${html.slice(0, 12)}`;
}

/** A record written by an older daemon carries no `code` — and is stale by definition. */
export function daemonStale(record, root = ROOT) {
  return record?.code !== codeStamp(root);
}

export const STALE_LINE = '[web] running OLD code (started before the last upgrade) — '
  + 'geneseed web restart';

const statePath = (target) => join(target, '.geneseed-web.json');

export function readDaemon(target) {
  try {
    return JSON.parse(readFileSync(statePath(target), 'utf-8'));
  } catch {
    return null;
  }
}

export function writeDaemon(target, data) {
  try {
    mkdirSync(target, { recursive: true });
    const p = statePath(target);
    writeText(p, jsonDumpsCompact(data, { bareInts: true }));
    // Owner-only: the record carries the API token. A no-op on Windows, where the
    // mode only maps to the read-only attribute.
    chmodSync(p, 0o600);
  } catch { /* best-effort: a failed write here just means no daemon record */ }
}

export function clearDaemon(target) {
  try {
    unlinkSync(statePath(target));
  } catch { /* already gone */ }
}

// ---- daemon mode -----------------------------------------------------------
//
// `geneseed web start|stop|status|restart`. The running server records pid/port/token/url
// in a small JSON file and control is over HTTP, so nothing here needs OS process-kill
// semantics, only a localhost request with the token.
//
//   * Every function below that touches the network is `async` (`fetch` has no
//     synchronous equivalent), and `cmdWeb` awaits it.
//   * Both requests are drained (`res.body?.cancel()`) whether or not the caller wants the
//     body: an undrained `fetch` response can keep a keep-alive socket referenced, which is
//     the same hang a `web status` that answered correctly would otherwise suffer while
//     waiting to exit.

/**
 * `${url}/api/ping` answered 200 — the cheap liveness probe both `status` and the launcher's
 * wait loop are built on. Every failure mode (network error, timeout, malformed url) is
 * `false`.
 */
export async function probe(url, timeout = 1.5) {
  try {
    const res = await fetch(`${url}/api/ping`, {
      method: 'GET',
      signal: AbortSignal.timeout(Math.round(timeout * 1000)),
    });
    const ok = res.status === 200;
    // Drained after the verdict is already read: a failure canceling the body must not
    // flip an already-successful ping to `false`.
    await res.body?.cancel().catch(() => {});
    return ok;
  } catch {
    // network error, timeout abort, or a malformed url — all become `false`.
    return false;
  }
}

/** The token-carrying POST `geneseed web stop` and the in-page Stop button both send. */
async function postShutdown(url, token, timeout = 3.0) {
  try {
    const res = await fetch(`${url}/api/shutdown`, {
      method: 'POST',
      headers: { 'X-Geneseed-Token': token, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(Math.round(timeout * 1000)),
    });
    const ok = res.status === 200;
    await res.body?.cancel().catch(() => {});
    return ok;
  } catch {
    return false;
  }
}

/**
 * The record ONLY if a server is answering; otherwise the stale file is deleted — which is
 * what stops a machine that crashed with a daemon running from re-probing a dead URL on
 * every `status` forever. Both arms are gated by a `harness_golden` cell — a record whose
 * url nothing answers, and a record carrying no url at all, which skips the probe and still
 * clears.
 */
export async function liveDaemon(target) {
  const st = readDaemon(target);
  if (st && isTruthy(st.url) && await probe(st.url)) return st;
  if (isTruthy(st)) clearDaemon(target);
  return null;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * A missing key prints `None`, not `undefined` — only reachable through a hand-edited
 * record, kept for consistency with how every other missing value is reported here.
 */
export const none = (v) => (v === undefined || v === null ? 'None' : String(v));

/**
 * The daemon launcher, and the second `ALLOWED_SPAWNS` entry this module owns.
 *
 * WHY THERE IS NO IN-PROCESS EQUIVALENT: the whole contract is that the server OUTLIVES
 * the process that started it. `geneseed web start` prints a URL and returns to the shell;
 * the server it started must still be there. A thread, a `worker_thread` or an in-process
 * `serve()` all die with the launcher.
 *
 * WHAT IT STARTS IS THIS PROGRAM: `process.execPath` + `bin/geneseed-cli.mjs` — the running
 * interpreter by absolute path and this repo's own CLI, re-executing itself rather than
 * shelling out to anything else. `tests/unit/web_daemon.test.mjs:199-223` scans this
 * function's own source for `python`/`harness.py`/`build.py`/`sys.executable` and asserts
 * none of them appear — this daemon may re-execute only itself.
 */
function spawnDetached(webArgs, log) {
  const cmd = [process.execPath, join(ROOT, 'bin', 'geneseed-cli.mjs'), 'web', ...webArgs];
  let out = 'ignore';
  try {
    out = openSync(log, 'a');
  } catch { /* falls back to 'ignore' if the log can't be opened */ }
  const child = spawn(cmd[0], cmd.slice(1), {
    // `detached: true` covers `DETACHED_PROCESS | NEW_PROCESS_GROUP` on Windows and
    // `start_new_session` on POSIX; `unref()` is what then lets the launcher's own event
    // loop end while the child keeps running — Node does not do this by default.
    detached: true, windowsHide: true, stdio: ['ignore', out, out],
  });
  child.unref();
}

/** The `web` argv the launcher passes. Pure and side-effect free. */
export function daemonArgs(port, theme) {
  const args = ['--daemon-internal', '--port', String(port), '--no-browser'];
  if (isTruthy(theme)) args.push('--theme', theme);
  return args;
}

/** The same for the out-of-band restart. */
export function restartArgs(theme) {
  const args = ['restart', '--no-browser'];
  if (isTruthy(theme)) args.push('--theme', theme);
  return args;
}

/**
 * A detached `web restart`, so the new server survives the exit of the very process asking
 * for it. Called by POST `/api/restart` and after a successful update job.
 *
 * ONLY FROM THE DAEMON THE RECORD NAMES — `false`, and nothing spawned, otherwise. A plain
 * `geneseed web` serves in the foreground and writes no record, so `web restart` found nothing
 * to stop, started a fresh daemon on 4747 while this process still held it, lost the bind,
 * fell back to a random port, and left a background console nobody had asked for.
 */
export function requestRestart(theme) {
  const target = webState(theme).target;
  if (readDaemon(target)?.pid !== process.pid) return false;
  spawnDetached(restartArgs(theme), join(target, '.geneseed-web.log'));
  return true;
}

/**
 * Opens a URL in the desktop's default browser. No Node stdlib API knows what that is, so
 * this shells out to an OS-native opener (`start`/`open`/`xdg-open`).
 *
 * IT IS A MACHINE PRIMITIVE, the same class as `taskkill` and `java -version`, and the
 * opposite of a passthrough: it asks the OS to open a URL and hands it nothing of this
 * program's work. Declining it instead would have been a silent regression in the one verb
 * whose job is to put a UI on screen — `geneseed web` would print an address and do
 * nothing, and no automated test would catch it, because every test passes `--no-browser`.
 *
 * Every failure here is swallowed — a machine with no browser opener configured must not
 * crash a server that is otherwise working fine.
 */
export function openUrl(url) {
  const [file, args, extra] = process.platform === 'win32'
    // `start` is a cmd BUILTIN, not a program. The empty `""` is its title argument —
    // without it `start "http://…"` treats the quoted URL as the window title and opens
    // nothing. Verbatim args because Node would otherwise re-quote the whole string.
    ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`],
      { windowsVerbatimArguments: true }]
    : (process.platform === 'darwin' ? ['open', [url], {}] : ['xdg-open', [url], {}]);
  try {
    const child = spawn(file, args, {
      detached: true, stdio: 'ignore', windowsHide: true, ...extra,
    });
    // ⚠ ENOENT ARRIVES AS AN EVENT, NOT AS A THROW, AND THE `try` ABOVE CANNOT SEE IT.
    // Node's `spawn` reports a missing executable on the child's `error` event; an 'error'
    // with no listener is re-thrown as an uncaught exception that would crash the daemon
    // over a browser it doesn't strictly need to open. The listener below is what actually
    // suppresses it — the `try`/`catch` around this call catches nothing here.
    //
    // MEASURED: `geneseed web` on a headless Linux box with no browser opener printed
    // `Error: spawn xdg-open ENOENT` before this listener existed. No automated test catches
    // this, because every test passes `--no-browser`.
    child.on('error', () => { /* no opener on this machine; the daemon is still serving */ });
    child.unref();
  } catch { /* spawn itself can still throw synchronously on some platforms; same rule */ }
}

export async function startDaemon(theme, port, openBrowser = true) {
  const { target } = webState(theme);
  const st = await liveDaemon(target);
  if (st) {
    printOut(`[web] already running on ${st.url}  (pid ${none(st.pid)})\n`);
    if (openBrowser) openUrl(st.url);
    return 0;
  }
  clearDaemon(target);
  const log = join(target, '.geneseed-web.log');
  spawnDetached(daemonArgs(port, theme), log);
  // Twelve seconds for the child to bind and write its record (60 * 200ms). The probe
  // timeout here is the shorter 0.5s, not the default 1.5s.
  for (let i = 0; i < 60; i += 1) {
    const rec = readDaemon(target);
     
    if (rec && isTruthy(rec.url) && await probe(rec.url, 0.5)) {
      printOut(`[web] Geneseed UI on ${rec.url}  (theme: ${none(rec.theme)}, `
        + `pid ${none(rec.pid)})\n`);
      printOut('[web] running in the background — `geneseed web stop` to stop it.\n');
      if (openBrowser) openUrl(rec.url);
      return 0;
    }
     
    await sleep(200);
  }
  printOut('[web] daemon did not come up in time — check the log:\n');
  printOut(`      ${log}\n`);
  return 1;
}

/**
 * `--port` NAMES WHICH DAEMON, and the record holds only one. With no `--port` (`port` null)
 * the verbs act on whatever the record names, as they always have. With one, they act only if
 * the record is on that port: `stop --port 4791` once POSTed shutdown to the recorded url and
 * stopped the console on 4747. So a record on another port is refused — no request sent, record
 * left in place — and a server answering on the named port that is NOT the record is explained,
 * because its token is not on record and there is nothing to guess it from.
 *
 * Null when the verb may go ahead; otherwise the exit code, already explained on stdout.
 */
async function portRefusal(st, port, verb) {
  if (port === null || port === undefined) return null;
  const recorded = isTruthy(st) && isTruthy(st.url) ? Number(st.port) : null;
  if (recorded === port) return null;
  if (recorded !== null) {
    if (verb === 'status') {
      printOut(`[web] not running on port ${port} (the recorded daemon is on port ${recorded}).\n`);
    } else {
      printOut(`[web] the recorded daemon is on port ${recorded}, not ${port} — not touching it.\n`);
      printOut(`      \`geneseed web ${verb} --port ${recorded}\` (or no --port) ${verb}s that one.\n`);
    }
  }
  if (await probe(`http://127.0.0.1:${port}`)) {
    printOut(`[web] a server answers on port ${port} but is not the recorded daemon, so its `
      + 'token is unknown — stop it from its own page (Stop) or end its process.\n');
    return 1;
  }
  // Nothing recorded and nothing on the named port: the verb's own no-daemon arm says so.
  return recorded === null ? null : 1;
}

export async function stopDaemon(theme = null, port = null) {
  const { target } = webState(theme);
  const st = readDaemon(target);
  const refused = await portRefusal(st, port, 'stop');
  if (refused !== null) return refused;
  if (!isTruthy(st) || !isTruthy(st.url)) {
    // NO `clearDaemon` HERE — deliberately asymmetric with `liveDaemon`/`statusDaemon`,
    // which DO delete a record naming no url. Unifying the two would delete a file this
    // function is not supposed to touch.
    printOut('[web] no running server recorded.\n');
    return 0;
  }
  if (await postShutdown(st.url, isTruthy(st.token) ? st.token : '')) {
    clearDaemon(target);
    printOut(`[web] stopped (pid ${none(st.pid)}).\n`);
    return 0;
  }
  // A FAILED SHUTDOWN IS NOT A DEAD SERVER. The POST times out at 3 s, a synchronous handler
  // (a doctor run) can hold the event loop longer, and a console with a job running answers
  // 409 — deleting the record then left a live daemon nothing could find again.
  if (await probe(st.url)) {
    printOut(`[web] the server on ${st.url} did not stop (pid ${none(st.pid)}) — it may be `
      + 'busy with a job; try again once it finishes.\n');
    return 1;
  }
  clearDaemon(target);
  printOut('[web] no live server (cleared a stale record).\n');
  return 0;
}

export async function statusDaemon(theme = null, port = null) {
  const { target } = webState(theme);
  const refused = await portRefusal(readDaemon(target), port, 'status');
  if (refused !== null) return refused;
  const st = await liveDaemon(target);
  if (st) {
    printOut(`[web] running on ${st.url}  (theme: ${none(st.theme)}, pid ${none(st.pid)})\n`);
    if (daemonStale(st)) printOut(`${STALE_LINE}\n`);
    return 0;
  }
  // EXIT 1, which is the verb's whole contract for a script. The snapshot's `<exit>`
  // column is what gates it.
  printOut('[web] not running.\n');
  return 1;
}

/**
 * Bounce a running console so it serves the code now on disk — `upgrade` after it rebuilt,
 * `rebuild-all` when the running one is stale. EXCEPT inside a web job (`GENESEED_WEB_JOB`,
 * set by `js/web/jobs.mjs`): restarting here would kill the process tracking that very job,
 * leaving the console stuck on 'running'; the server restarts itself after an update job, and
 * shows its stale banner otherwise. `onlyIfStale` is `rebuild-all`'s: after an `upgrade`
 * (which bounces, then runs `rebuild-all`) the console is current, and bouncing it again
 * would drop the open tab for nothing. Never throws — no rebuild fails over a console.
 */
export async function bounceDaemonIfRunning(theme, log, { onlyIfStale = false } = {}) {
  if (onlyIfStale) {
    const st = readDaemon(webState(theme).target);
    if (!st || !daemonStale(st)) return;
  }
  if (process.env.GENESEED_WEB_JOB) {
    log(onlyIfStale
      ? '[geneseed] the web console is running old code — use its Restart banner.'
      : '[geneseed] web daemon will restart itself after this job to load the new code.');
    return;
  }
  try {
    await restartDaemon(theme, null, false, true);
  } catch (e) {
    log(`[geneseed] ⚠️  could not refresh the web daemon (${e && e.message ? e.message : e}) — \`geneseed web restart\` manually if it was running.`);
  }
}

/** `port` null keeps the recorded daemon's port (4747 if none); see `portRefusal`. */
export async function restartDaemon(theme = null, port = null, openBrowser = true,
  onlyIfRunning = false) {
  const { target } = webState(theme);
  const st = readDaemon(target);
  const refused = await portRefusal(st, port, 'restart');
  if (refused !== null) return refused;
  const live = (await liveDaemon(target)) !== null;
  if (onlyIfRunning && !live) return 0;
  const usePort = port ?? ((st && isTruthy(st.port) ? st.port : null) || 4747);
  let open = openBrowser;
  if (live) {
    // A live daemon means a tab is already open on this (preserved) port and will
    // reconnect on its own — no need to open a fresh browser window here.
    open = false;
    // A daemon that refused to stop is still on the port: starting another would find it live
    // and report "already running" over a restart that never happened.
    const stopped = await stopDaemon(theme);
    if (stopped !== 0) return stopped;
    for (let i = 0; i < 50; i += 1) {
       
      if (!await probe(`http://127.0.0.1:${usePort}`, 0.2)) break;
       
      await sleep(100);
    }
  }
  return startDaemon(theme, usePort, open);
}

