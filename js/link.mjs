/**
 * `harness link` / `harness unlink` — run-from-anywhere, and the phase that had to decide
 * whether they should exist at all under npm.
 *
 * ---------------------------------------------------------------------------------------
 * DO THEY SHIP? YES — AND NOT FOR THE REASON THE HANDOFF PREDICTED.
 *
 * The case against was strong and it was measured, not assumed. `npm i -g geneseed` already
 * puts `geneseed`, `geneseed-hook` and `geneseed-build` on PATH through npm's own bin
 * linking, so `geneseed link` from an npm install writes a SECOND `geneseed.cmd` — into
 * `%LOCALAPPDATA%\Geneseed\bin` rather than `%APPDATA%\npm` — and edits the persistent USER
 * Path to reach it. `npm uninstall -g` removes neither. That is PATH litter with a registry
 * edit behind it, for a job the package manager already did.
 *
 * What decided it against that was the WEB CONSOLE, not the CLI. `web/src/pages/Settings`
 * has "Run from anywhere" and its inverse as two buttons; both POST `/api/actions/link` and
 * `/api/actions/unlink`; and the Node job runner can only answer them by spawning
 * `node bin/geneseed-cli.mjs link`. So the honest options were exactly two:
 *
 *   * PORT THE VERBS — the npm package gains a command that duplicates what npm did; or
 *   * DELETE THE TWO ACTIONS from `action_commands` in BOTH implementations, delete the two
 *     buttons, and rebuild the tracked `web/dist`.
 *
 * The second removes a working feature from every GIT-CHECKOUT user — for whom `link` is
 * the only thing that puts `geneseed` on PATH, because there is no package manager in that
 * story — in order to spare npm users a duplicate. It also spends a `web/dist` rebuild on a
 * deletion. So: they ship, they port, and `NOT_PORTED_ACTIONS` empties.
 *
 * The npm duplication is left as it is rather than papered over with a new "you already have
 * this" refusal: that would be a REDESIGN of the verb, the reference has no such arm, and a
 * divergence invented by the port is worse than one it inherited.
 *
 * ---------------------------------------------------------------------------------------
 * THE ONE DIVERGENCE, AND IT IS P5b's, NOT A NEW ONE.
 *
 * On Windows the verb writes a shim naming an INTERPRETER and an ENTRY. The reference names
 * `sys.executable` and `rituals/harness.py`; a Node process cannot know which Python would
 * have run, and inventing one writes a shim that names an interpreter the user may not have.
 * P5b settled this shape for the hook shim — "Node bakes node" — and P3a settled the gate:
 * the shim is byte-comparable once runner and entry are ARGUMENTS. So this bakes
 * `process.execPath` + `bin/geneseed-cli.mjs`, `tests/harness_golden.py` normalises the
 * shim's argv line the way `js/web/jobs.mjs` normalises the job runner's, and each side's
 * real content is asserted ABSOLUTELY in `tests/test_win_user_path.py`. A shim written by
 * the Node CLI reaches sixteen verbs rather than twenty-four; that is the cost of the port
 * being a port, and it disappears when P7 lands `tui`/`menu`/`home`.
 *
 * THE DOUBLE CARRIAGE RETURN IS NOT A TYPO. The reference builds the shim with explicit
 * `\r\n` and writes it with `Path.write_text`, whose default newline handling then turns
 * each `\n` into `\r\n` again — the file on disk really is `@echo off\r\r\n`. `writeText`
 * carries exactly that rule (it is why the helper exists), so passing the same string
 * through it reproduces the same bytes. cmd.exe does not care; the byte gate does.
 *
 * ---------------------------------------------------------------------------------------
 * NO TEST IN THIS REPO MAY TOUCH THE REAL USER PATH.
 *
 * `winUserPath` writes to the registry through PowerShell. That is not sandboxable and a
 * cell that ran it would edit the developer's machine, so the module is shaped so the gate
 * never needs to:
 *
 *   * `winUserPathScript` is PURE — the escaping, the split and the idempotence live there
 *     and `tests/test_win_user_path.py` runs it over a corpus (apostrophes, trailing
 *     separators, UNC roots) against the Python twin, byte for byte.
 *   * `cmdLink` SHORT-CIRCUITS when the bin dir is already on `PATH`, so a cell that seeds
 *     `PATH` with its own sandboxed bin dir exercises the whole verb and never spawns.
 *   * `cmdUnlink` has no such short-circuit, so its cells seed a `PATH` with no `powershell`
 *     on it: the spawn fails to launch, `winUserPath` returns false through the ENOENT arm,
 *     and the verb takes its "removed the shim, said nothing about PATH" branch. A real arm,
 *     reached honestly, with the registry untouched.
 *
 * THE SUCCESS ARM OF `winUserPath` IS THEREFORE UNGATED, DELIBERATELY, IN BOTH
 * IMPLEMENTATIONS — declared here rather than faked, because the only way to gate it is to
 * edit the machine running the gate.
 */
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

import { ROOT } from './checkout.mjs';
import { readMaybe } from './installs.mjs';
import { pyPathStr, pyPrint, pyPrintErr, writeText } from './lib/fs.mjs';

const IS_WIN = process.platform === 'win32';

/** `_harness_lifecycle._win_bin_dir`. */
export function winBinDir() {
  // `os.environ.get(...) or str(Path.home())` — an EMPTY LOCALAPPDATA falls back too,
  // which `??` would not do.
  const base = process.env.LOCALAPPDATA || os.homedir();
  return path.join(base, 'Geneseed', 'bin');
}

/**
 * `_harness_lifecycle._win_user_path_script` — the PowerShell one-liner, built but not run.
 *
 * Every quoting hazard in this verb is in this string, which is why it is a separate
 * function on both sides: `''` is PowerShell's single-quote escape, the `;` split drops
 * empty segments so a trailing separator cannot append an empty entry, and `-notcontains`
 * is what makes `link` idempotent.
 */
export function winUserPathScript(action, directory) {
  const d = directory.replaceAll("'", "''");   // PS single-quote escape (O'Brien)
  if (action === 'add') {
    return `$d='${d}';`
      + "$p=[Environment]::GetEnvironmentVariable('Path','User');"
      + "if (-not $p) {$p=''};"
      + "$parts=$p.Split(';') | Where-Object {$_ -ne ''};"
      + 'if ($parts -notcontains $d) {'
      + "  $np=(@($parts)+$d) -join ';';"
      + "  [Environment]::SetEnvironmentVariable('Path',$np,'User')}";
  }
  return `$d='${d}';`
    + "$p=[Environment]::GetEnvironmentVariable('Path','User');"
    + 'if ($p) {'
    + "  $np=(($p.Split(';') | Where-Object {$_ -ne '' -and $_ -ne $d}) -join ';');"
    + "  [Environment]::SetEnvironmentVariable('Path',$np,'User')}";
}

/**
 * `_harness_lifecycle._win_user_path` — the spawn, and the sixth row of `_ALLOWED_SPAWNS`.
 *
 * There is no in-process equivalent: the persistent USER Path lives in the registry
 * (`HKCU\Environment`), not in this process's environment, and Node has no registry API.
 * `[Environment]::SetEnvironmentVariable(...,'User')` also broadcasts `WM_SETTINGCHANGE`,
 * which a hand-rolled `reg add` would not — so even a registry binding would be the wrong
 * primitive.
 *
 * `except OSError -> False`: Python raises when the executable cannot be launched at all.
 * Node reports the same condition in `r.error` instead of throwing, so the two arms are
 * spelled differently and mean the same thing — a `powershell` that is not on PATH returns
 * false rather than crashing the verb.
 */
function winUserPath(action, directory) {
  const r = spawnSync('powershell',
    ['-NoProfile', '-Command', winUserPathScript(action, directory)],
    { stdio: 'inherit', windowsHide: true });
  if (r.error) return false;
  return r.status === 0;
}

/** `_harness_lifecycle.cmd_link` — put `geneseed` on PATH so it runs from any directory. */
export function cmdLink(args) {
  const here = ROOT;
  if (IS_WIN) {
    const bindir = winBinDir();
    const shim = path.join(bindir, 'geneseed.cmd');
    try {
      mkdirSync(bindir, { recursive: true });
      // The running runtime, not a bare name — the reference's reason (a bare `python` may
      // be missing or resolve to the Microsoft Store alias stub) applies to `node` too, and
      // an npm install is exactly where a second Node on PATH is likeliest.
      writeText(shim, '@echo off\r\n'
        + `"${process.execPath}" "${path.join(here, 'bin', 'geneseed-cli.mjs')}" %*\r\n`);
    } catch (e) {
      pyPrintErr(`geneseed: could not write ${shim} (${pyOsError(e)})\n`);
      return 1;
    }
    pyPrint(`geneseed: wrote shim ${shim}\n`);
    const on_path = (process.env.PATH || '').toLowerCase().includes(bindir.toLowerCase());
    if (on_path || winUserPath('add', bindir)) {
      pyPrint(`geneseed: '${bindir}' is on your user PATH — open a NEW terminal, then run \`geneseed\`.\n`);
    } else {
      pyPrint(`geneseed: add '${bindir}' to your PATH manually, then run \`geneseed\` from anywhere.\n`);
    }
    return 0;
  }
  // Unix: write a shim into a bin dir (default ~/.local/bin, no sudo). See the shim
  // comment below for why this is no longer a symlink to `ROOT/geneseed`.
  // `Path(args.dir)` — and `pyPathStr` is that conversion, not decoration. The reference
  // builds a `Path` here and prints `str(target_dir)` twice (the PATH notice and the `export
  // PATH=` line) as well as comparing it against `PATH.split(os.pathsep)`, so an argument
  // that is not already normalised diverges in three places at once. A trailing slash is the
  // cheapest one: `str(Path('/x/bin/'))` is `/x/bin` and the raw string is not.
  // `harness_golden`'s `link/an-explicit-dir-argument-is-used-instead-of-the-default` passes
  // one, and it is the cell that found this.
  let targetDir = args.dir ? pyPathStr(args.dir) : null;
  if (targetDir === null) {
    const local = path.join(os.homedir(), '.local', 'bin');
    try {
      mkdirSync(local, { recursive: true });
      targetDir = local;
    } catch {
      targetDir = '/usr/local/bin';
    }
  }
  const dest = path.join(targetDir, 'geneseed');
  const entry = path.join(here, 'bin', 'geneseed-cli.mjs');
  try {
    mkdirSync(targetDir, { recursive: true });
    // `dest.is_symlink() or dest.exists()` — the first half is what catches a BROKEN
    // symlink, which `existsSync` follows and reports absent.
    if (isSymlink(dest) || existsSync(dest)) rmSync(dest, { force: true });
    // A WRITTEN SHIM, not a symlink to `ROOT/geneseed`. The bash launcher execs a Python
    // interpreter, so symlinking it puts Python on PATH from the Node verb. The Windows
    // arm above has always written a shim; this is the same shape. `GENESEED_LINK_SHIM`
    // is the marker `cmdUnlink` recognises — without it, unlink cannot tell our file from
    // a stranger's and would have to refuse every regular file, which is a no-op.
    writeText(dest, '#!/bin/sh\n'
      + '# GENESEED_LINK_SHIM\n'
      + `exec "${process.execPath}" "${entry}" "$@"\n`);
    chmodSync(dest, 0o755);
  } catch (e) {
    pyPrintErr(`geneseed: could not write ${dest} (${pyOsError(e)}) — pick a writable dir: `
      + 'geneseed link <dir>\n');
    return 1;
  }
  pyPrint(`geneseed: linked ${dest} -> ${entry}\n`);
  if ((process.env.PATH || '').split(path.delimiter).includes(targetDir)) {
    pyPrint(`geneseed: '${targetDir}' is on PATH — run 'geneseed' from anywhere.\n`);
  } else {
    pyPrint(`geneseed: NOTE '${targetDir}' is not on your PATH. Add it, e.g.:\n`);
    pyPrint(`  echo 'export PATH="${targetDir}:$PATH"' >> ~/.zshrc   # or ~/.bashrc\n`);
  }
  return 0;
}

/** `_harness_lifecycle.cmd_unlink`. */
export function cmdUnlink() {
  if (IS_WIN) {
    const bindir = winBinDir();
    const shim = path.join(bindir, 'geneseed.cmd');
    let removed = false;
    if (existsSync(shim)) {
      try {
        rmSync(shim);
        removed = true;
        pyPrint(`geneseed: removed ${shim}\n`);
      } catch (e) {
        pyPrintErr(`geneseed: could not remove ${shim} (${pyOsError(e)})\n`);
      }
    }
    if (winUserPath('remove', bindir)) {
      pyPrint(`geneseed: removed '${bindir}' from your user PATH (open a new terminal).\n`);
    }
    if (!removed) pyPrint('geneseed: no linked launcher found.\n');
    return 0;
  }
  let removed = false;
  const candidates = [path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin'];
  for (const d of (process.env.PATH || '').split(path.delimiter)) if (d) candidates.push(d);
  const seen = new Set();
  for (const d of candidates) {
    if (seen.has(d)) continue;
    seen.add(d);
    const f = path.join(d, 'geneseed');
    // TWO shapes, because two shapes exist on disk. (a) `os.readlink(f)` raw, then `.name`
    // — NOT a resolved path: the reference asks whether the link's own target BASENAME is
    // `geneseed`, so a symlink pointing at some other program that happens to sit in a
    // `geneseed` directory is left alone. That is every install made before the shim.
    // (b) a regular file we wrote, identified by its marker — never "any regular file
    // called geneseed", which would delete a stranger's program.
    const ours = (isSymlink(f) && path.basename(readlinkSync(f)) === 'geneseed')
      || (!isSymlink(f) && existsSync(f) && (readMaybe(f) ?? '').includes('GENESEED_LINK_SHIM'));
    if (ours) {
      try {
        rmSync(f);
        pyPrint(`geneseed: removed ${f}\n`);
        removed = true;
      } catch { /* `except OSError: pass` */ }
    }
  }
  if (!removed) pyPrint('geneseed: no linked launcher found on PATH\n');
  return 0;
}

/** `Path.is_symlink()` — false for a path that does not exist, never a throw. */
function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * `str(OSError)` — what Python interpolates into these two messages.
 *
 * `[Errno 13] Permission denied: 'C:\\...'`, and Node's `e.message` is the same three parts
 * in a different order. Not byte-reproducible and not worth pretending otherwise: both cells
 * that can reach it assert the arm, not the errno text.
 */
function pyOsError(e) {
  return e && e.message ? e.message : String(e);
}
