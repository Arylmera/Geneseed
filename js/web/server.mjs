/**
 * The web console's HTTP shell — `rituals/_web_server.py`'s handler, static route and
 * `serve()` entry. P6a: the shell and `/api/ping`, and nothing that answers a real
 * endpoint.
 *
 * WHY THE SHELL FIRST, AND ALONE. `_web_server.py` is 654 lines and none of it is an API
 * function: it is routing, two security guards, gzip negotiation, the static route with
 * its per-request token injection, and the daemon record. Every one of those is invisible
 * to a test that calls `api_X(state)` in process — which is how `tests/test_web.py`
 * reaches all 136 of its assertions — so the shell is both the part with no existing
 * coverage and the part every later sub-phase builds on. `tests/web_golden.py` is its
 * gate and was written before this file.
 *
 * THE SERIALISER, WHICH TOUCHES ALL 29 PATHS. `_send_json` is a bare `json.dumps(obj)`:
 * Python's DEFAULT separators, `(', ', ': ')`, and `ensure_ascii=True`. That is exactly
 * `jsonDumpsCompact` — whose name says "compact" meaning "no indent", not "no spaces";
 * read its body, it joins on `', '`. So the twin needs no new helper and the response
 * bodies stay byte-comparable.
 *
 * Its one condition is the int/float distinction. `formatValue` refuses a BARE JS number
 * because `json.loads` tells `20` from `1.0` and `JSON.parse` does not — but the numbers
 * in a response body are not parsed from JSON, they are computed here (counts, a port, a
 * pid, a unix second), and every one of them is a Python `int`, which renders identically
 * in both languages. `bareInts` says that out loud rather than wrapping several dozen
 * call sites in a factory. A Python float would be the counter-example — `1.0` against
 * JS's `1` — and the byte gate over every endpoint body is what would catch one.
 *
 * P6h FINISHED IT, and the file grew a second half rather than a second module. The
 * reference keeps the handler and the daemon lifecycle in ONE file under a
 * `# ---- daemon mode` banner, and splitting them here would have made `serve()` (which
 * needs `npmBuild`) and the launcher (which needs `readDaemon`) import each other. So
 * `_probe`, `_live_daemon`, `_spawn_detached`, `start|stop|status|restart_daemon`,
 * `_npm_build` and `cmd_web` all live below, and `bin/geneseed-cli.mjs` is finally a
 * caller — which is what put this tree on the CLI's import graph and moved
 * `js/web/jobs.mjs`'s spawn row to `entry: "cli"`.
 *
 * WHAT IS STILL NOT HERE, SINCE P6i: `/api/pick-folder` alone, and it is DECLINED rather than
 * deferred — an OS-native folder chooser has no Node twin that is not a new GUI dependency.
 * `NOT_PORTED_POST` is empty and stays declared, because an empty half of a partition is the
 * partition asserting there is nothing left; `DECLINED_POST` is what still has a member.
 */
import { GLOBAL_MANIFEST, resolvePath } from '../hosts/hosts.mjs';
import { printOut } from '../lib/fs.mjs';
import { which } from '../lib/paths.mjs';
import { parseIntStrict } from '../lib/text.mjs';
import { promptLine } from '../maintain/setup.mjs';
import { webState } from './api.mjs';
import { clearDaemon, openUrl, readDaemon, restartDaemon, startDaemon, statusDaemon, stopDaemon, writeDaemon } from './daemon.mjs';
import { isFile, makeHandler } from './handler.mjs';
import { JobManager } from './jobs.mjs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = pathResolve(fileURLToPath(import.meta.url), '..', '..', '..');

// Re-exported so the console's state lives in one place and its importers are unchanged.
export { webState };

// ---- serve -----------------------------------------------------------------

/**
 * Pure: what `serve()` should do about the UI bundle. Ported ahead of the rest of the
 * verb because it decides whether a server starts at all, and because it is the second
 * interactive prompt in this port — `interactive` is an ARGUMENT, which is what makes it
 * gateable by a corpus rather than only by a cell.
 *
 * P6h GAVE IT BOTH KINDS OF GATE AND FOUND THE CLAIM ABOVE HAD NEVER BEEN PAID. It had a
 * Python unit test (`tests/test_web.py`) and nothing cross-implementation until now: the
 * corpus in `tests/test_pure_function_parity.py` covers all five answers, and two
 * `harness_golden` cells cover the two arms that TERMINATE — which are also the only two
 * that let a `web` cell exist at all, since every other arm of `serve` binds a socket.
 */
export function buildPlan(dist, webDir, npm, interactive) {
  if (isFile(join(dist, 'index.html'))) return 'serve';
  if (!isFile(join(webDir, 'package.json'))) return 'no-source';
  if (!npm) return 'no-npm';
  if (!interactive) return 'no-tty';
  return 'ask';
}

/**
 * `npm install` then `npm run build` in `web/`, streams inherited — the third spawn this
 * module declares, and the one NO test reaches.
 *
 * THAT IS A DECLARED PARTITION, not an omission. `web/dist/index.html` is TRACKED (asserted
 * by `tests/test_web_daemon.py` against `git ls-files`, so the claim cannot rot), which
 * means `buildPlan` answers `serve` in every checkout a cell can build and the `ask` arm is
 * reachable only from a partial checkout on an interactive terminal. There is no npm
 * library to call instead; a Node twin that reimplemented `npm install` is not a thing that
 * exists.
 *
 * `shell` ON WINDOWS, and it is required rather than stylistic: `which('npm')` resolves
 * to `npm.CMD` through PATHEXT, and Node refuses to `spawn` a `.cmd` directly. The path is
 * quoted because Node wraps the whole command in one more pair and `cmd /s` strips only
 * the outermost — `C:\Program Files\…` would otherwise split at the space.
 */
export function npmBuild(npm, webDir) {
  const win = process.platform === 'win32';
  for (const step of [['install'], ['run', 'build']]) {
    printOut(`[web] npm ${step.join(' ')} ...\n`);
    const r = spawnSync(win ? `"${npm}"` : npm, step, {
      cwd: webDir, stdio: 'inherit', shell: win,
    });
    const code = r.status === null || r.status === undefined ? 1 : r.status;
    if (code) {
      printOut(`[web] npm ${step.join(' ')} failed (exit ${code}).\n`);
      return code;
    }
  }
  return 0;
}

export async function serve({ theme = null, port = 4747, openBrowser = true,
  daemon = false } = {}) {
  const dist = join(ROOT, 'web', 'dist');
  const webDir = join(ROOT, 'web');
  const manual = '        cd web && npm install && npm run build';
  // `sys.stdin.isatty()`. `process.stdin.isTTY` is `undefined` rather than false on a pipe,
  // which is the same trap `cmdSetup` documents.
  const plan = buildPlan(dist, webDir, which('npm'), Boolean(process.stdin.isTTY));
  if (plan === 'no-source') {
    printOut(`[web] web/ sources are missing from ${ROOT}.\n`);
    printOut('      Run `geneseed upgrade` to fetch them (twice on installs whose\n');
    printOut('      updater predates web/ in the sync list).\n');
    return 1;
  }
  if (plan === 'no-npm') {
    printOut('[web] web/dist is missing and npm was not found. Install Node.js,\n');
    printOut('      then build the UI:\n');
    printOut(`${manual}\n`);
    return 1;
  }
  if (plan === 'no-tty') {
    printOut('[web] web/dist is missing. Build the UI first:\n');
    printOut(`${manual}\n`);
    return 1;
  }
  if (plan === 'ask') {
    // `except (EOFError, KeyboardInterrupt): answer = "n"`. EOF is the arm that matters and
    // it is the one a naive port gets backwards: `input()` RAISES at EOF, so the reference
    // reads it as "no", while a read that returned `''` would fall into the empty-answer
    // arm and start an npm install nobody asked for. `promptLine` returns null for exactly
    // that case — see its docblock in js/maintain/setup.mjs.
    const line = promptLine('[web] UI not built — run npm install && npm run build now? [Y/n] ');
    const answer = line === null ? 'n' : line;
    if (['', 'y', 'yes'].includes(answer.trim().toLowerCase())) {
      const code = npmBuild(which('npm'), webDir);
      if (code) return code;
    } else {
      printOut('[web] skipped. Build the UI manually:\n');
      printOut(`${manual}\n`);
      return 0;
    }
  }
  const state = webState(theme);
  if (!existsSync(join(state.target, GLOBAL_MANIFEST))) {
    printOut(`[web] no deployed harness at ${state.target}.\n`);
    printOut('      Run `geneseed setup` first — serving anyway (read-only UI).\n');
  }
  const token = randomBytes(24).toString('base64url');
  const holder = {};
  // `JobManager(history_path=state.target / ".geneseed-web-runs.json")` — the console's job
  // list survives a reload and a restart because it is a FILE, not a process's memory.
  const jm = new JobManager(join(state.target, '.geneseed-web-runs.json'));
  const srv = createServer(makeHandler(state, jm, token, dist, holder));
  holder.srv = srv;
  return new Promise((done) => {
    srv.on('error', () => {
      // The reference retries on port 0; the same fallback, one level in.
      srv.listen(0, '127.0.0.1', () => ready());
    });
    srv.listen(port, '127.0.0.1', () => ready());

    function ready() {
      const hostPort = srv.address().port;
      const url = `http://127.0.0.1:${hostPort}`;
      if (daemon) {
        writeDaemon(state.target, {
          pid: process.pid, port: hostPort, url,
          token, theme: state.theme, started: Math.floor(Date.now() / 1000),
        });
      }
      printOut(`[web] Geneseed UI on ${url}  (theme: ${state.theme})\n`);
      printOut(daemon ? '[web] daemon ready.\n' : '[web] Ctrl-C to stop.\n');
      if (openBrowser) openUrl(url);
      // `except KeyboardInterrupt: print("\n[web] stopped.")` around `serve_forever`. Node
      // kills on SIGINT by default, which would skip the message AND the record cleanup in
      // the `finally` below — a foreground `--daemon-internal` server stopped with Ctrl-C
      // would leave a record pointing at a dead port.
      process.on('SIGINT', () => {
        printOut('\n[web] stopped.\n');
        srv.close();
        srv.closeAllConnections();
      });
      srv.on('close', () => {
        if (daemon) {
          const st = readDaemon(state.target);
          if (!st || st.pid === process.pid) clearDaemon(state.target);
        }
        done(0);
      });
    }
  });
}

/**
 * `cmd_web` — the verb `bin/geneseed-cli.mjs` dispatches to, and the reason this module is
 * on the CLI's import graph at all (which is what moved `js/web/jobs.mjs`'s
 * `_ALLOWED_SPAWNS` row from `entry: "web"` to `entry: "cli"`).
 *
 * The reference's `cmd_web` does `import web` INSIDE the function; the ESM equivalent would
 * be a dynamic `import()`, and it is deliberately NOT used — a static import is what lets
 * `test_the_cli_reaches_child_process_only_where_it_is_declared` walk the CLI's graph and
 * find the two spawning modules under `js/web/`. The cost is parsing the web tree on every
 * CLI invocation; `bin/geneseed-cli.mjs` is user-invoked and carries no latency budget (the
 * hook entry, which does, is a different binary for exactly this reason).
 */
export async function cmdWeb(args) {
  // `--port` is `type=int` on the reference, and `bin/geneseed-cli.mjs`'s `ints` column
  // refuses a non-integer before this runs — so `parseIntStrict` cannot be null here.
  const port = args.port === null ? 4747 : parseIntStrict(args.port);
  const openBrowser = !args.noBrowser;
  if (args.action === 'start') return startDaemon(args.theme, port, openBrowser);
  if (args.action === 'stop') return stopDaemon(args.theme);
  if (args.action === 'restart') return restartDaemon(args.theme, port, openBrowser);
  if (args.action === 'status') return statusDaemon(args.theme);
  return serve({ theme: args.theme, port, openBrowser, daemon: args.daemonInternal });
}

// ---- entry -----------------------------------------------------------------
//
// KEPT AFTER P6h, and it is not a duplicate of the verb above. `tests/web_golden.py` drove
// this module directly for all of P6a–P6g, and its 95 cells are what license the MOVE: the
// same matrix now runs against `node bin/geneseed-cli.mjs web` as well, and a byte gate
// that passed against one command proves nothing about the other until it is re-aimed. The
// module entry is also what a debugging session reaches for when the CLI's argument layer
// is the thing under suspicion.

async function main(argv) {
  let theme = null;
  let port = 4747;
  let daemon = false;
  let openBrowser = true;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--theme') { theme = argv[i + 1]; i += 1; } else if (argv[i] === '--port') { port = parseIntStrict(String(argv[i + 1])) ?? 4747; i += 1; } else if (argv[i] === '--daemon-internal') daemon = true;
    else if (argv[i] === '--no-browser') openBrowser = false;
  }
  return serve({ theme, port, openBrowser, daemon });
}

if (process.argv[1] && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
