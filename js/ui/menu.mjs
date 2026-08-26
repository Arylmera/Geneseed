/**
 * `menu` and `home` — `rituals/_harness_menu.py`'s two dispatchers.
 *
 * WHAT CROSSES HERE AND WHAT DOES NOT, said plainly, because this is the one module in the
 * port whose Python twin is 3,398 lines and whose Node twin is ninety.
 *
 * `cmd_menu` is a FORK, not a menu. Off a TTY it prints five lines of command list and
 * returns 0; on a TTY it hands control to `curses.wrapper(_main_menu)` — the full-screen
 * panel, which is P7c's and is not here. The fork's off-TTY arm is what every cell of this
 * port can reach, and it is ported byte for byte.
 *
 * ON A TTY, THIS ENTRY FALLS BACK RATHER THAN INVENTING A SECOND MENU. The reference already
 * has that behaviour: `cmd_menu` wraps the panel in `except Exception`, writes `[menu] TUI
 * unavailable (<reason>)` to stderr and prints the same command list. Node's reason is
 * permanent rather than accidental, and it is stated as such.
 *
 * ⚠ THE REASON THIS HEADER ORIGINALLY GAVE WAS WRONG, and P7b measured it: it said the
 * reference reaches that arm often because "`import curses` fails on stock Windows Python".
 * A bare `import curses` does fail here, but `rituals/_harness_core.py` installs
 * `rituals/_winterm.py` under the name `curses` when it does — so inside the harness the
 * import succeeds, the panel opens, and it is the PORT that has no window. The fallback is
 * still the right shape; only its explanation moved. The alternative that was considered and
 * refused: building a numbered line-menu out of `js/maintain/setup.mjs`'s `askChoice`. That is not a
 * port of `_main_menu` — it is a THIRD user interface, differing from the reference on every
 * screen, unreachable from every cell (no cell has a TTY), and it would have to be deleted
 * the day P7c lands the real panel. The fallback is the reference's own contract for "no
 * full-screen menu available here"; a new UI would not be.
 *
 * `cmd_home` is the default for a bare `geneseed`, and it crosses WHOLE. Its two arms are
 * `_web_first_ok()` — the web console, which is P6h's `startDaemon` and is fully ported —
 * and `cmd_menu` above. Nothing in it was deferred.
 *
 * `_web_first_ok`'s FIVE REFUSALS ARE THE PAYLOAD, and only two of them are reachable from a
 * cell: a cell's stdin is a pipe, so `isTTY` is false and everything past it is dead. The
 * other three (SSH, the Linux display server, the browser) are gated by the corpus in
 * `tests/test_pure_function_parity.py`, which drives this function with `isTTY` FAKED — the
 * one input no cell can vary. See that file's P7a section for what it reaches and what it
 * declares.
 */
import { printOut, printErr } from '../lib/fs.mjs';
import { which } from '../lib/paths.mjs';
import { startDaemon } from '../web/daemon.mjs';

/** `_menu_help` — the off-TTY arm, and the fallback both TTY arms end in. */
function menuHelp() {
  printOut('Geneseed — no interactive menu here. Get started with:  geneseed setup\n');
  printOut('Other commands:  bootstrap · update · build · doctor · diff · tui · web\n');
  printOut('On a VT-capable terminal, a bare `./geneseed` opens the interactive menu of these.\n');
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
 * DECLARED DIVERGENCE: on Linux the reference consults `$BROWSER` and a list of a dozen
 * browser binaries before giving up, so a box with `firefox` on PATH and no `xdg-open`
 * answers True there and false here. It is unreachable from this port's machine (the
 * previous branch already returned false without a display server, and Windows never gets
 * here), and closing it would mean reproducing `webbrowser`'s registry — a table of browser
 * names that would go stale silently, which is the shape this port refuses.
 */
function browserAvailable() {
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  return which('xdg-open') !== null;
}

/**
 * `_web_first_ok` — whether a bare `geneseed` opens the web UI rather than the TUI menu.
 * Deliberately conservative in the reference and here: any doubt falls back to the menu, so
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

/** `cmd_menu`. See this module's header for why the TTY arm falls back. */
export function cmdMenu() {
  if (!process.stdin.isTTY) return menuHelp();
  // The reference's own `except Exception` arm, with a reason that is permanent here rather
  // than machine-dependent. stderr, and CRLF on Windows, because `sys.stderr.write` does.
  //
  // P7b CORRECTED THE REASON RATHER THAN THE ARM. This module's header said the fallback was
  // reached because "`import curses` fails on stock Windows Python", and P7b measured that
  // to be false where it matters: `rituals/_harness_core.py` installs `rituals/_winterm.py`
  // as `sys.modules["curses"]` when the stdlib module is missing, so the reference opens its
  // panel on this machine and `tests/test_tui_boundary.py` drives it doing so. What is
  // missing is on THIS side — there is no window implementation in the port — and that is
  // what the message now says.
  // NOTHING TO POINT AT ANY MORE. The message used to end by sending the reader at the
  // Python panel, and P2 took the pointer out rather than re-aiming it: the panel it named
  // is the Python this migration deletes, and a refusal that sends a user to a file which
  // will not be there is worse than one that simply says the screen does not exist.
  printErr('[menu] TUI unavailable (this entry has no full-screen menu).\n');
  return menuHelp();
}

/** `cmd_home` — the default for a bare `geneseed`. */
export async function cmdHome(args) {
  if (webFirstOk()) {
    printOut('[geneseed] opening the web console — `geneseed menu` for the terminal UI, '
      + 'GENESEED_NO_WEB=1 to disable.\n');
    return startDaemon(null, 4747, true);
  }
  return cmdMenu(args);
}
