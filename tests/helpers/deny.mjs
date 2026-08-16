// MAKE A REAL PATH REFUSE A REAL OPERATION — pattern 3.5, in its THIRD register.
//
// `retry_gap.test.mjs`'s `jam()` was the first (a file that refuses to be unlinked),
// `generate.test.mjs`'s `deny()` the second (a read that fails, a write that fails), and
// `atomic_config.test.mjs` the third. Extracted here on that third caller, because the knowledge
// is not about any of them: it is the measured answer to "what actually blocks an operation on
// each platform", and three plausible mechanisms do NOT work on Windows — an open handle (libuv
// passes FILE_SHARE_DELETE), the read-only attribute, and a read-only parent.
//
// A MOCK PROVES THE HANDLER CATCHES THE EXCEPTION SOMEONE DECIDED TO THROW; AN ACL PROVES IT
// CATCHES THE ONE THE OS RAISES. That is the whole argument for paying for this fixture, and it
// has already found a difference the mock could not: a denied ACL on Windows raises EPERM,
// "operation not permitted", where the reference asserted "Permission denied" — the wording
// belongs to the platform, so what is portable is the errno prefix Node puts at the front.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export const DENY_SKIP = 'this platform cannot make a real path refuse a real operation';

/**
 * Deny `right` on `p`, and return a release function — or `null` so the caller skips LOUDLY.
 *
 * `(D)` denies delete, `(R)` denies read, `(W)` denies the create of a temp file inside a
 * directory. `probe` must attempt the operation being denied: running elevated, or on a
 * filesystem that ignores ACLs, the deny is a no-op and every assertion downstream silently
 * becomes one about an ordinary success.
 */
export function deny(p, right, probe) {
  const user = process.env.USERNAME || process.env.USER || '';
  let release;
  if (process.platform === 'win32') {
    if (spawnSync('icacls', [p, '/deny', `${user}:(${right})`], { encoding: 'utf8' }).status !== 0) {
      return null;
    }
    release = () => { spawnSync('icacls', [p, '/remove:d', user], { encoding: 'utf8' }); };
  } else {
    const mode = fs.statSync(p).mode;
    fs.chmodSync(p, right === 'R' ? 0o000 : 0o555);
    release = () => { fs.chmodSync(p, mode); };
  }
  // PROVE IT TOOK.
  let blocked = false;
  try { probe(); } catch { blocked = true; }
  if (!blocked) { release(); return null; }
  return release;
}
