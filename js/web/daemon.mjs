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
import { webState } from './api.mjs';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = pathResolve(fileURLToPath(import.meta.url), '..', '..', '..');

// ---- the daemon record -----------------------------------------------------

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
    // mode only maps to the read-only attribute — same as the reference's os.chmod.
    chmodSync(p, 0o600);
  } catch { /* the reference swallows OSError here too */ }
}

export function clearDaemon(target) {
  try {
    unlinkSync(statePath(target));
  } catch { /* already gone */ }
}

// ---- daemon mode -----------------------------------------------------------
//
// `geneseed web start|stop|status|restart`. The reference's own banner explains the design
// — the running server records pid/port/token/url in a small JSON file and control is over
// HTTP, so nothing here needs OS process-kill semantics, only a localhost request with the
// token. Two things about the TWIN, neither of which is in that banner:
//
//   * `_probe` and `_post_shutdown` are `urllib.request.urlopen` with a timeout, which is
//     synchronous. Node has no synchronous HTTP client, so every function below that
//     reaches one is `async` and `cmdWeb` awaits it — which is why `bin/geneseed-cli.mjs`
//     awaits its dispatch. Nothing about the ORDER of the reference's steps changes.
//   * `agent: false` on both requests. Node's global agent has kept sockets alive by
//     default since v19, and a pooled idle socket keeps the event loop referenced — a
//     `web status` that answered correctly would then hang for the keep-alive timeout
//     instead of exiting. Python's `urlopen` opens and closes a connection per call.

/** `f"{url}/api/ping"` answered 200 — the cheap liveness probe both `status` and the
 *  launcher's wait loop are built on. Every failure mode is False, as the reference's
 *  `(URLError, OSError, ValueError)` catch is. */
export function probe(url, timeout = 1.5) {
  return new Promise((done) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; done(v); } };
    let req;
    try {
      req = httpRequest(`${url}/api/ping`, { method: 'GET', agent: false }, (res) => {
        res.resume();          // drain, or the socket never closes
        finish(res.statusCode === 200);
      });
    } catch {
      return finish(false);    // a malformed url is `ValueError` there and a throw here
    }
    req.setTimeout(Math.round(timeout * 1000), () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
    req.end();
    return undefined;
  });
}

/** The token-carrying POST `geneseed web stop` and the in-page Stop button both send. */
export function postShutdown(url, token, timeout = 3.0) {
  return new Promise((done) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; done(v); } };
    let req;
    try {
      req = httpRequest(`${url}/api/shutdown`, {
        method: 'POST',
        agent: false,
        headers: { 'X-Geneseed-Token': token, 'Content-Type': 'application/json' },
      }, (res) => {
        res.resume();
        finish(res.statusCode === 200);
      });
    } catch {
      return finish(false);
    }
    req.setTimeout(Math.round(timeout * 1000), () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
    req.end('{}');
    return undefined;
  });
}

/**
 * The record ONLY if a server is answering; otherwise the stale file is deleted.
 *
 * The deletion is the part a port drops, and it is what stops a machine that crashed with
 * a daemon running from re-probing a dead URL on every `status` forever. Both of its arms
 * are gated by a `harness_golden` cell — a record whose url nothing answers, and a record
 * carrying no url at all, which skips the probe and still clears.
 */
export async function liveDaemon(target) {
  const st = readDaemon(target);
  if (st && isTruthy(st.url) && await probe(st.url)) return st;
  if (isTruthy(st)) clearDaemon(target);
  return null;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** `st.get(k)` rendered as Python renders it — a missing key prints `None`, not
 *  `undefined`. Only reachable through a hand-edited record, and one character of
 *  divergence in a message is still a divergence. */
export const none = (v) => (v === undefined || v === null ? 'None' : String(v));

/**
 * `_spawn_detached` — the daemon launcher, and the second `_ALLOWED_SPAWNS` entry this
 * module owns.
 *
 * WHY THERE IS NO IN-PROCESS EQUIVALENT: the whole contract is that the server OUTLIVES
 * the process that started it. `geneseed web start` prints a URL and returns to the shell;
 * the server it started must still be there. A thread, a `worker_thread` or an in-process
 * `serve()` all die with the launcher.
 *
 * WHAT IT STARTS IS THIS PROGRAM, named as `process.execPath` + `bin/geneseed-cli.mjs` —
 * the running interpreter by absolute path and this repo's own CLI. The reference names
 * `sys.executable` + `rituals/harness.py`; each side re-executes ITSELF, which is what
 * makes this not the passthrough the port exists to remove, and
 * `tests/test_web_daemon.py` asserts the twin's argv contains no `python`, no `harness.py`
 * and no `build.py` at all.
 */
function spawnDetached(webArgs, log) {
  const cmd = [process.execPath, join(ROOT, 'bin', 'geneseed-cli.mjs'), 'web', ...webArgs];
  let out = 'ignore';
  try {
    out = openSync(log, 'a');       // `open(log, "ab")`; DEVNULL on OSError, as there
  } catch { /* the reference falls back to DEVNULL on exactly this failure */ }
  const child = spawn(cmd[0], cmd.slice(1), {
    // `DETACHED_PROCESS | NEW_PROCESS_GROUP` on Windows and `start_new_session` on POSIX
    // are both `detached` here; `unref()` is what lets the launcher's event loop end while
    // the child runs on, which is `Popen`'s default and Node's is not.
    detached: true, windowsHide: true, stdio: ['ignore', out, out],
  });
  child.unref();
}

/** The `web` argv the launcher passes. Pure, and compared against `_daemon_args` by the
 *  corpus: the binary differs per side by design, the FLAGS may not. */
export function daemonArgs(port, theme) {
  const args = ['--daemon-internal', '--port', String(port), '--no-browser'];
  if (isTruthy(theme)) args.push('--theme', theme);
  return args;
}

/** The same for the out-of-band restart — `_restart_args`. */
export function restartArgs(theme) {
  const args = ['restart', '--no-browser'];
  if (isTruthy(theme)) args.push('--theme', theme);
  return args;
}

/** `request_restart` — a detached `web restart`, so the new server survives the exit of
 *  the very process asking for it. Called by POST `/api/restart`. */
export function requestRestart(theme) {
  const target = webState(theme).target;
  spawnDetached(restartArgs(theme), join(target, '.geneseed-web.log'));
}

/**
 * `webbrowser.open(url)`, which has no Node equivalent at all — there is no stdlib module
 * that knows what a desktop's default browser is.
 *
 * IT IS A MACHINE PRIMITIVE, the same class as `taskkill` and `java -version` and the
 * opposite of a passthrough: it asks the OS to open a URL and hands it nothing of this
 * program's work. Declining it instead would have been a silent regression in the one verb
 * whose job is to put a UI on screen — `geneseed web` would print an address and do
 * nothing, and no cell would say so because every cell passes `--no-browser`.
 *
 * The reference swallows every failure here (`contextlib.suppress(Exception)` in two call
 * sites and a bare `except` in the third), and so does this.
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
    // This is where the reference's suppression failed to survive translation: Python's
    // `subprocess` raises `FileNotFoundError` synchronously, so `contextlib.suppress(Exception)`
    // really did swallow a missing opener. Node's `spawn` reports the same condition on the
    // child's `error` event, and an 'error' with no listener is re-thrown as an uncaught
    // exception. So the port's `try/catch` read as equivalent and suppressed nothing.
    //
    // MEASURED, in the packaged no-python container: `geneseed web` on a headless Linux box
    // printed `Error: spawn xdg-open ENOENT`. Found by the acceptance gate rather than by the
    // 690-cell corpus, and the docblock above says why the corpus never could — every cell
    // passes `--no-browser`, so no recorded cell has ever executed this line.
    child.on('error', () => { /* no opener on this machine; the daemon is still serving */ });
    child.unref();
  } catch { /* the reference suppresses every exception from this call too */ }
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
  // `for _ in range(60): ... time.sleep(0.2)` — twelve seconds for the child to bind and
  // write its record. The probe timeout is the reference's shorter 0.5 here, not 1.5.
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

export async function stopDaemon(theme = null) {
  const { target } = webState(theme);
  const st = readDaemon(target);
  if (!isTruthy(st) || !isTruthy(st.url)) {
    // NO `clearDaemon` HERE, and the asymmetry with `liveDaemon` is the reference's. A
    // record that names no url is left exactly where it is; `web status` on the same file
    // deletes it. Both directions are cells, because a port that unified them would delete
    // a file the reference keeps and stdout would look identical.
    printOut('[web] no running server recorded.\n');
    return 0;
  }
  if (await postShutdown(st.url, isTruthy(st.token) ? st.token : '')) {
    clearDaemon(target);
    printOut(`[web] stopped (pid ${none(st.pid)}).\n`);
    return 0;
  }
  clearDaemon(target);
  printOut('[web] no live server (cleared a stale record).\n');
  return 0;
}

export async function statusDaemon(theme = null) {
  const { target } = webState(theme);
  const st = await liveDaemon(target);
  if (st) {
    printOut(`[web] running on ${st.url}  (theme: ${none(st.theme)}, pid ${none(st.pid)})\n`);
    return 0;
  }
  // EXIT 1, which is the verb's whole contract for a script. The snapshot's `<exit>`
  // column is what gates it.
  printOut('[web] not running.\n');
  return 1;
}

export async function restartDaemon(theme = null, port = 4747, openBrowser = true,
  onlyIfRunning = false) {
  const { target } = webState(theme);
  const st = readDaemon(target);
  const live = (await liveDaemon(target)) !== null;
  if (onlyIfRunning && !live) return 0;
  const usePort = (st && isTruthy(st.port) ? st.port : null) || port;
  let open = openBrowser;
  if (live) {
    // A live daemon means a tab is already open on this (preserved) port and will
    // reconnect on its own — the reference's `ponytail:` note, kept.
    open = false;
    await stopDaemon(theme);
    for (let i = 0; i < 50; i += 1) {
       
      if (!await probe(`http://127.0.0.1:${usePort}`, 0.2)) break;
       
      await sleep(100);
    }
  }
  return startDaemon(theme, usePort, open);
}

