/**
 * The `geneseed web` VERB — the UI-bundle decision, the npm build, `serve()` and the CLI
 * entry. The request handler and the static route are in `handler.mjs`, the route
 * declarations in `routes.mjs`, the daemon record and lifecycle in `daemon.mjs`; this file
 * binds a socket and wires the three together.
 *
 * MODULE BOUNDARY: the dependency runs one way, `server → daemon`. `probe`, `liveDaemon`,
 * `spawnDetached`, `start|stop|status|restartDaemon`, `openUrl` and `requestRestart` are in
 * `daemon.mjs`; `npmBuild`, `buildPlan`, `serve` and `cmdWeb` are here — `npmBuild` stays with
 * `serve` rather than moving with the rest of the daemon lifecycle, which is why the split
 * does not produce a two-way import.
 *
 * `bin/geneseed-cli.mjs` imports `cmdWeb` statically, which is what put this tree on the
 * CLI's import graph and moved `js/web/jobs.mjs`'s `ALLOWED_SPAWNS` row to `entry: "cli"` —
 * and it is why a runtime dependency reached from here would load on EVERY `geneseed`
 * invocation.
 *
 * WHAT WAS STILL NOT HERE, SINCE P6i UNTIL 2026-08-27: `/api/pick-folder`, DECLINED rather
 * than deferred — an OS-native folder chooser had no Node twin that was not a new GUI
 * dependency. The user overrode that decline; the endpoint now dispatches inline from
 * `js/web/handler.mjs`'s `doPost` (see `apiPickFolder` in `js/web/actions.mjs`). With it, the
 * port's NOT_PORTED / DECLINED partition emptied for good and was retired — the declared
 * surface now lives in `js/web/routes.mjs` and `tests/unit/web_server.test.mjs`.
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

const ROOT = pathResolve(import.meta.dirname, '..', '..');

// Re-exported so the console's state lives in one place and its importers are unchanged.
export { webState };

// ---- serve -----------------------------------------------------------------

/**
 * Pure: what `serve()` should do about the UI bundle, decided before anything else since it
 * decides whether a server starts at all. `interactive` is a plain argument rather than a
 * read of `process.stdin.isTTY` inside this function, which is what keeps it callable from a
 * test without mocking stdin.
 */
export function buildPlan(dist, webDir, npm, interactive) {
  if (isFile(join(dist, 'index.html'))) return 'serve';
  if (!isFile(join(webDir, 'package.json'))) return 'no-source';
  if (!npm) return 'no-npm';
  if (!interactive) return 'no-tty';
  return 'ask';
}

/**
 * `npm install` then `npm run build` in `web/`, streams inherited — one of the spawns this
 * module declares, and the one NO test reaches.
 *
 * THAT IS A DECLARED GAP, not an omission. `web/dist/index.html` is TRACKED (asserted by
 * `tests/unit/web_daemon.test.mjs` against `git ls-files`, so the claim cannot rot), which
 * means `buildPlan` answers `serve` in any checkout a test can build against, and the `ask`
 * arm is reachable only from a partial checkout on an interactive terminal. There is no npm
 * library to call instead of the real thing.
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
  // `process.stdin.isTTY` is `undefined` rather than false on a pipe — the same trap
  // `cmdSetup` documents.
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
    // EOF is the arm that matters: treated as an empty string it would fall into the
    // empty-answer arm below (which defaults to yes) and start an npm install nobody asked
    // for. `promptLine` returns null for exactly that case — see its docblock in
    // js/maintain/setup.mjs — which is why `null` maps to `'n'` here.
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
  // The console's job list survives a reload and a restart because it is a FILE on disk,
  // not held in process memory.
  const jm = new JobManager(join(state.target, '.geneseed-web-runs.json'));
  const srv = createServer(makeHandler(state, jm, token, dist, holder));
  holder.srv = srv;
  return new Promise((done) => {
    srv.on('error', () => {
      // On a listen error, retry with port 0 so the OS picks a free one.
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
      // Node kills on SIGINT by default, which would skip this message and the record
      // cleanup in `srv.on('close', ...)` below — a foreground `--daemon-internal` server
      // stopped with Ctrl-C would otherwise leave a record pointing at a dead port.
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
 * `cmdWeb` — the verb `bin/geneseed-cli.mjs` dispatches to, and the reason this module is
 * on the CLI's import graph at all (which is what moved `js/web/jobs.mjs`'s
 * `ALLOWED_SPAWNS` row from `entry: "web"` to `entry: "cli"`).
 *
 * The import above is static rather than dynamic on purpose: a static import is what lets the
 * spawn-graph walk find the two spawning modules under `js/web/`. The cost is parsing the web
 * tree on every CLI invocation; `bin/geneseed-cli.mjs` is user-invoked and carries no latency
 * budget (the hook entry, which does, is a different binary for exactly this reason).
 */
export async function cmdWeb(args) {
  // `bin/geneseed-cli.mjs`'s `ints` column refuses a non-integer before this runs — so
  // `parseIntStrict` cannot be null here.
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
// Not a duplicate of `cmdWeb` above: this lets `node js/web/server.mjs` be run directly,
// which is what a debugging session reaches for when the CLI's own argument layer is the
// thing under suspicion.

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
