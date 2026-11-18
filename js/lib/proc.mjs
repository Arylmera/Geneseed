/**
 * The spawn flag — one rule for every child process this tool starts, in one place.
 *
 * Windows gives every console child of a CONSOLE-LESS parent a brand-new console window.
 * The web daemon is console-less by design (`DETACHED_PROCESS`), so without this flag every
 * short-lived process it shells out to pops a window and closes it — the Doctor page is the
 * worst case, running `node --check` once per plugin, and it is what a user actually sees:
 * seven consoles flashing on a dashboard load.
 *
 * WHY IT LIVES HERE AND NOT IN `js/maintain/update.mjs`, WHICH DEFINED IT FIRST. It was private to
 * that module and six of its spawns used it, so the four spawn sites in `js/inspect/checks-authoring.mjs`,
 * `js/hosts/hooks.mjs`, `js/maintain/setup.mjs` and `js/hosts/link.mjs` each had to remember the flag on their
 * own. Two of them did not — and the miss is BYTE-INVISIBLE: a console window is not
 * something the CLI prints, so every cell of `tests/golden.mjs --cli` stays green while the
 * windows pop. The property under test never reaches the comparison, which is why a byte
 * comparison cannot be the gate here. A shared constant plus
 * `tests/unit/spawn_hygiene.test.mjs` is what makes the next spawn site inherit the answer
 * instead of re-deciding it.
 *
 * CAPTURING SPAWNS ONLY, and the asymmetry is deliberate. The rule was measured on Windows:
 * a process that sets `STARTF_USESTDHANDLES` only when a stream is redirected gives an
 * INHERITING child spawned with `CREATE_NO_WINDOW` a fresh hidden console and discards
 * everything it prints — `geneseed build > log.txt` wrote an empty file. That is the
 * `CREATE_NO_WINDOW` creation flag. Node's `windowsHide` is a different mechanism, and libuv
 * always passes the handles explicitly, so on an INHERITING spawn it is harmless: the child
 * writes to the parent's handles. A few inheriting sites set it (`js/hosts/link.mjs`,
 * `js/maintain/update.mjs`) and are correct — `tests/unit/spawn_hygiene.test.mjs` explains why
 * it asserts no inverse rule.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export const NO_WINDOW = { windowsHide: process.platform === 'win32' };

/** The extensions the model spawn can run on Windows: an executable, or a `cmd.exe` batch shim. */
const WIN_RUNNABLE = ['.exe', '.com', '.cmd', '.bat'];

/**
 * The file `word` names as a command, or null: what a spawn of it can actually run, and the one answer
 * `learn`'s spawn and `doctor`'s PATH note share (spec 2026-11-18-learn-model-row, F5).
 *
 * On Windows `CreateProcess` finds only `.exe` on PATH, so an npm-installed CLI (`claude.cmd`,
 * `openclaude.cmd`) is "not found" to a plain `spawn`: the word is resolved here against `PATH` and
 * `PATHEXT`, and only `.exe`, `.com`, `.cmd` and `.bat` count (a `.ps1` or `.vbs` in PATHEXT cannot be
 * run by this spawn). Elsewhere the OS resolves the word at spawn time, so this only reports whether a
 * file of that name sits on `PATH`. `exists` and `platform` are parameters so a table can state every row.
 */
export function resolveCommand(word, env = process.env, exists = existsSync, platform = process.platform) {
  if (!word) return null;
  const win = platform === 'win32';
  const sep = win ? /[\\/]/ : /\//;
  const dirs = sep.test(word) ? [''] : String(env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean);
  let exts = [''];
  if (win) {
    const listed = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase());
    const has = WIN_RUNNABLE.find((e) => word.toLowerCase().endsWith(e));
    exts = has ? [''] : listed.filter((e) => WIN_RUNNABLE.includes(e));
  }
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = dir ? path.join(dir, word + ext) : word + ext;
      if (exists(file)) return file;
    }
  }
  return null;
}
