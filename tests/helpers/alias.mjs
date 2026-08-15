// A DIRECTORY REACHABLE UNDER TWO SPELLINGS — the fixture that manufactures the one environment
// this project's worst path bugs all live in, and which no developer machine produces on its own.
//
// ONE OWNER, because it now has two callers and the second one exists BECAUSE the first was not
// reusable. `tests/unit/sandbox.test.mjs` built this inline to gate `makeSandbox`; the falsifier
// then reverted a real historical defect in `resolveOut` and nothing went red, because the
// fixture that could have seen it was locked inside a test about a different function.
//
// TWO MECHANISMS ON WINDOWS, AND THE ORDER IS ITSELF A LESSON. The 8.3 short name is what
// GitHub's runner actually holds and is the only spelling `fs.realpathSync` does NOT collapse;
// a directory junction is the fallback for a volume where `fsutil 8dot3name` has switched short
// names off. An earlier draft used the junction ALONE, and because `realpathSync` resolves
// junctions the gate was green in exactly the configuration that was broken.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Through the Scripting.FileSystemObject rather than a `cmd.exe` `for /%~s` round trip, whose
// quoting produced `C:\"C:` in an earlier draft.
function shortName(dir) {
  try {
    return execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${dir}').ShortPath`],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function aliasOf(real) {
  if (process.platform === 'win32') {
    const short = shortName(real);
    if (short && short !== real) return { path: short, kind: '8.3', remove: () => {} };
  }
  const link = `${real}-alias`;
  try {
    fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    return {
      path: link,
      kind: 'link',
      remove: () => { try { fs.unlinkSync(link); } catch { /* already gone */ } },
    };
  } catch { return null; }
}

/**
 * A temp directory reachable under two spellings, or null if this platform cannot make one.
 *
 * The name carries spaces and components longer than eight characters so the 8.3 form really
 * does differ — a short-name lookup on an already-short path returns it unchanged, and a test
 * built on one of those is green for the wrong reason.
 */
export function aliasedTemp() {
  // `.native` on BOTH calls. On `windows-latest` the runner's own TEMP is already the 8.3 form,
  // so a plain `realpathSync` leaves `C:\Users\RUNNER~1\…` as this fixture's idea of the
  // canonical path while `.native` on the alias returns the long one — the gate then fails on
  // its own baseline rather than on anything it gates.
  const real = fs.realpathSync.native(fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), 'geneseed alias case ')));
  const a = aliasOf(real);
  if (a === null || a.path === real) {
    fs.rmSync(real, { recursive: true, force: true });
    return null;
  }
  return {
    real,
    alias: a.path,
    kind: a.kind,
    done: () => {
      a.remove();
      fs.rmSync(real, { recursive: true, force: true });
    },
  };
}

export const ALIAS_SKIP = 'this platform/volume cannot produce a second path spelling';
