/**
 * The persistent list of folders a harness was deployed into.
 *
 * IT LIVES HERE, NOT IN `bin/build-driver.mjs`. The
 * driver WRITES the registry, one row per per-repo emit; `harness rebuild-all` READS it to
 * find every install it must re-emit, and `bin/geneseed-cli.mjs` may not reach into a driver
 * for a reader. `js/build/generate.mjs` importing `main` from `bin/build-driver.mjs` is not a
 * precedent for it either: `harness build` IS the driver, and a registry reader is not.
 *
 * `tests/golden.mjs` drives
 * `bin/build-driver.mjs` over many cells with `$XDG_CONFIG_HOME` redirected into the sandbox and
 * compares `installs.json` byte-for-byte, so a changed path or a dropped prune fails cells
 * rather than passing quietly.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { expanduser, resolvePath } from '../hosts/hosts.mjs';
import { writeText, isFile, isDir } from '../lib/fs.mjs';
import { parseJson, jsonDumpsIndent } from '../lib/json.mjs';
import { toPlatformPath, within } from '../lib/paths.mjs';
import { machineDir } from '../lib/machine-dir.mjs';

/** `_install_registry._path()` — `$XDG_CONFIG_HOME/geneseed/installs.json`. */
function registryPath() {
  return path.join(machineDir(), 'installs.json');
}

/**
 * Is `root` a scratch install — inside the OS temp dir while the registry is not?
 *
 * Agent sessions emit into scratchpads under `%TEMP%`; recorded, each one is rebuilt by every
 * `rebuild-all` and listed by every `status` for as long as the folder survives. The second
 * clause is what keeps every test and golden cell meaningful: their registry lives in a
 * sandbox under the temp dir too, so their temp roots are not scratch RELATIVE TO IT.
 * `within` is case-insensitive on win32, so `C:\Users\X\AppData\Local\Temp` and its
 * lower-cased spelling are one directory.
 */
export function isScratchRoot(root, registryFile) {
  const tmp = resolvePath(os.tmpdir());
  return within(resolvePath(root), tmp) && !within(resolvePath(registryFile), tmp);
}

/**
 * The rows, or `null` when the file exists and cannot be trusted. Only a missing file is an empty
 * registry: read as `[]`, a refused read made the next save write one root over every install.
 */
function registryLoad() {
  let file;
  try { file = registryPath(); } catch { return null; }   // no home dir: nothing to read or to save over
  try {
    const data = parseJson(readFileSync(file, 'utf8'));
    if (Array.isArray(data)) return data.map(String);
    throw new Error('not a list');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    process.stderr.write(`[geneseed] could not read the install registry ${file}: ${e.message}\n`);
    return null;
  }
}

/**
 * The rename, waited out while Windows refuses it. A process holding the just-written target (real-time
 * scanning, by every sign) fails the replace with EPERM: measured at about 1 rename in 500 under
 * load, gone within moments. Writing in place instead would give up the atomicity: a reader could
 * see a torn file, load `[]`, and save only its own root over every other install. Bounded at about
 * 400 ms. Not gated on the platform: elsewhere these codes are rare and the bound is the same.
 */
const RENAME_WAITS_MS = [10, 30, 90, 270];
const SHARING_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
function renameOver(tmp, file) {
  for (const wait of RENAME_WAITS_MS) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      if (!SHARING_ERRORS.has(e.code)) throw e;
      pause(wait);
    }
  }
  renameSync(tmp, file);
}

/** A failed write must never break a deploy, and is never silent: stderr, since hooks speak on stdout. */
export function registrySave(items) {
  const file = registryPath();
  const tmp = `${file}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    // `jsonDumpsIndent` for the same reason as the manifest: these are absolute paths, and
    // a machine whose username carries an accent writes one here.
    writeText(tmp, `${jsonDumpsIndent(items)}\n`);
    renameOver(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* the report below is the one that matters */ }
    process.stderr.write(`[geneseed] could not update the install registry ${file}: ${e.message}\n`);
  }
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const LOCK_WAITS_MS = [10, 30, 90, 270, 500, 1000];
const LOCK_STALE_MS = 10_000;

/**
 * `fn` under a directory lock, or without it after about 2 s. An atomic rename stops a torn file,
 * not a lost update: two records both load the list, and the later rename drops the other's root,
 * which `rebuild-all` then never reaches. A crashed holder is outwaited by age. Past the bound
 * `fn` runs anyway, reported, because a registry hiccup must never fail a build.
 */
function withRegistryLock(fn) {
  const lock = `${registryPath()}.lock`;
  mkdirSync(path.dirname(lock), { recursive: true });
  let held = false;
  for (const wait of LOCK_WAITS_MS) {
    try {
      mkdirSync(lock);
      held = true;
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' && !SHARING_ERRORS.has(e.code)) throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
      } catch { /* the holder just let go */ }
      pause(wait);
    }
  }
  if (!held) process.stderr.write(`[geneseed] the install registry stayed locked: ${lock}\n`);
  try { return fn(); } finally { if (held) rmSync(lock, { recursive: true, force: true }); }
}

/**
 * Idempotent, best-effort, and it must NEVER raise into a build.
 *
 * `realpathSync` rather than `path.resolve`, because it returns the
 * filesystem's own casing and follows links; `path.resolve` only makes a path absolute. The
 * registry is compared byte-for-byte by `tests/golden.mjs` (XDG is redirected into the
 * sandbox), so a differently-cased entry is a failing cell.
 */
export function registryRecord(dir) {
  try {
    let root;
    try { root = realpathSync.native(dir); } catch { root = path.resolve(dir); }
    if (isScratchRoot(root, registryPath())) return;
    if (registryLoad()?.includes(root)) return;   // the usual case takes no lock
    withRegistryLock(() => {
      const cur = registryLoad();
      if (cur && !cur.includes(root)) registrySave([...cur, root]);
    });
  } catch { /* a registry hiccup must never fail a build */ }
}

/**
 * `_install_registry.roots()` — live registered deploy roots, pruning the file as it reads.
 *
 * The prune is a WRITE, and reproducing it matters: `installs.json` is compared byte-for-byte,
 * so a read that failed to drop a dead row would leave the two implementations holding
 * different registries. The snapshot is taken once on purpose: comparing `kept` against a SECOND
 * read could clobber a root a concurrent `record()` appended between the two. So the write takes
 * the lock and adds what that second read holds and the snapshot did not.
 */
export function registryRoots() {
  const original = registryLoad();
  if (!original) return [];
  const file = registryPath();
  const out = [];
  const kept = [];
  const seen = new Set();
  for (const s of original) {
    // `toPlatformPath` around `expanduser` is where the NORMALISATION happens. `C:/x/other`
    // becomes `C:\x\other` before it is compared, kept, returned and printed, so a registry
    // entry spelled with forward slashes (routine: every tool that writes one from Git Bash)
    // makes the file be rewritten and a backslash path printed, where a raw `expanduser`
    // prints the entry verbatim and leaves installs.json alone. `rebuild-all`'s registry
    // cells seed native spellings; `uninstall`'s inventory prints the root.
    // `expanduser` now REFUSES a `~user` entry (js/hosts/hosts.mjs's docblock) instead of passing
    // it through. This loop scans STORED registry rows, not a fresh CLI argument — a single
    // bad row (hand-edited, or written before this refusal existed) must not abort the scan
    // for every other install, so it is dropped exactly like any other dead row rather than
    // propagated. `rebuild-all`'s contract is "one broken install never blocks the rest".
    let root;
    try { root = toPlatformPath(expanduser(s)); } catch { continue; }
    let key;
    try { key = existsSync(root) ? realpathSync.native(root) : root; } catch { key = root; }
    if (seen.has(key)) continue;
    if (isDir(root) && isFile(path.join(root, '.geneseed-emit')) && !isScratchRoot(root, file)) {
      seen.add(key);
      kept.push(root);
      out.push(root);
    }
  }
  if (kept.length !== original.length || kept.some((v, i) => v !== original[i])) {
    try {
      withRegistryLock(() => {
        registrySave([...kept, ...(registryLoad() ?? []).filter((r) => !original.includes(r))]);
      });
    } catch (e) {   // a lock that cannot be made must not fail the read; the next one prunes
      process.stderr.write(`[geneseed] could not update the install registry ${file}: ${e.message}\n`);
    }
  }
  return out;
}
