/**
 * `menu` and `home` — the two dispatchers.
 *
 * `cmdMenu` is a FORK, not a menu. Off a TTY it prints five lines of command list and
 * returns 0. On a TTY it falls back to the same command list rather than inventing a
 * second menu: there is no full-screen panel, by decision, and it is stated as such on
 * stderr. A numbered line-menu built out of `js/maintain/setup.mjs`'s `askChoice` was
 * considered and refused: it would be a separate user interface, unreachable from every cell
 * (no cell has a TTY), for a panel that was rejected outright rather than deferred. The
 * off-TTY arm is what every cell can reach.
 *
 * `cmdHome` is the default for a bare `geneseed`. Its two arms are `webFirstOk()` — the
 * web console, started by `startDaemon` — and `cmdMenu` above.
 *
 * `webFirstOk`'s FIVE REFUSALS ARE THE PAYLOAD, and only two of them are reachable from a
 * cell: a cell's stdin is a pipe, so `isTTY` is false and everything past it is dead. The
 * other three (SSH, the Linux display server, the browser) are gated by
 * `tests/unit/web_first.test.mjs`, which drives this function through
 * `tests/fixtures/pure_probe.mjs` with `isTTY` FAKED — the one input no cell can vary.
 */
import { printOut, printErr } from '../lib/fs.mjs';
import { which } from '../lib/paths.mjs';
import { startDaemon } from '../web/daemon.mjs';

/** The off-TTY arm, and the fallback both TTY arms end in. */
function menuHelp() {
  printOut('Geneseed — no interactive menu here. Get started with:  geneseed setup\n');
  printOut('Other commands:  update · build · doctor · diff · web\n');
  printOut('`geneseed --help` lists every command.\n');
  return 0;
}

/**
 * `webbrowser.get()`, which raises `webbrowser.Error` when nothing on the machine can open
 * a URL — and has no Node equivalent, because there is no stdlib registry of browsers.
 *
 * The twin answers the question this program actually needs: can `openUrl` (js/web/server.mjs)
 * do its job? That makes the answer PER PLATFORM and identical to what `openUrl` will run —
 * `cmd /c start` on Windows and `open` on macOS are OS builtins that are always there, and
 * everywhere else it is `xdg-open`, which is not.
 *
 * DECLARED LIMIT: on Linux this does not consult `$BROWSER` or a list of a dozen browser
 * binaries, so a box with `firefox` on PATH and no `xdg-open` answers false. Closing it
 * would mean reproducing `webbrowser`'s registry — a table of browser names that would go
 * stale silently, which is the shape this code refuses.
 */
function browserAvailable() {
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  return which('xdg-open') !== null;
}

/**
 * Whether a bare `geneseed` opens the web UI rather than the TUI menu.
 * Deliberately conservative: any doubt falls back to the menu, so
 * a server box is never dropped into a browser launch that cannot open.
 */
export function webFirstOk() {
  if (process.env.GENESEED_NO_WEB) return false;
  // `process.stdin.isTTY` is `true` or UNDEFINED — never `false` — which is why this is a
  // truthiness test and not a comparison.
  if (!process.stdin.isTTY) return false;
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return false;
  // On Linux a browser needs a display server; macOS/Windows always have a GUI.
  if (process.platform === 'linux'
      && !(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) return false;
  return browserAvailable();
}

/** See this module's header for why the TTY arm falls back. */
export function cmdMenu() {
  if (!process.stdin.isTTY) return menuHelp();
  // stderr, and CRLF on Windows.
  //
  // The reason is on THIS side: there is no window implementation, by decision, and that is
  // what the message says (`tests/unit/no_panel.test.mjs` keeps it so).
  // NOTHING TO POINT AT: a refusal that sends a user to a file which will not be there is
  // worse than one that simply says the screen does not exist.
  printErr('[menu] TUI unavailable (this entry has no full-screen menu).\n');
  return menuHelp();
}

/** `cmd_home` — the default for a bare `geneseed`. */
export async function cmdHome(_args) {
  if (webFirstOk()) {
    printOut('[geneseed] opening the web console — `geneseed menu` for the terminal UI, '
      + 'GENESEED_NO_WEB=1 to disable.\n');
    return startDaemon(null, 4747, true);
  }
  return cmdMenu();
}
