/**
 * `_install_registry.py` — the persistent list of folders a harness was deployed into.
 *
 * MOVED OUT OF `bin/geneseed.mjs` IN P5f, for the third time the same arithmetic has decided
 * a module boundary in this port (P5c took the host resolvers, P5d the checkout paths). The
 * driver WRITES the registry, one row per per-repo emit; `harness rebuild-all` READS it to
 * find every install it must re-emit, and `bin/geneseed-cli.mjs` may not reach into a driver
 * for a reader. `js/generate.mjs` importing `main` from `bin/geneseed.mjs` is not a
 * precedent for it either: `harness build` IS the driver, and a registry reader is not.
 *
 * The move is licensed the same way the two before it were: `tests/golden.py` drives
 * `bin/geneseed.mjs` over 259 cells with `$XDG_CONFIG_HOME` redirected into the sandbox and
 * compares `installs.json` byte-for-byte, so a changed path or a dropped prune fails cells
 * rather than passing quietly.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { expanduser } from '../hosts/hosts.mjs';
import { writeText, parseJson, jsonDumpsIndent, pyPathStr } from '../lib/fs.mjs';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** `_install_registry._path()` — `$XDG_CONFIG_HOME/geneseed/installs.json`. */
export function registryPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'geneseed', 'installs.json');
}

export function registryLoad() {
  try {
    const data = parseJson(readFileSync(registryPath(), 'utf8'));
    return Array.isArray(data) ? data.map(String) : [];
  } catch { return []; }
}

export function registrySave(items) {
  try {
    const file = registryPath();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    // `jsonDumpsIndent` for the same reason as the manifest: these are absolute paths, and
    // a machine whose username carries an accent writes one here.
    writeText(tmp, `${jsonDumpsIndent(items)}\n`);
    renameSync(tmp, file);
  } catch { /* best-effort: a registry hiccup must never break a deploy */ }
}

/**
 * `_install_registry.record` — idempotent, best-effort, and it must NEVER raise into a build.
 *
 * `realpathSync` rather than `path.resolve`, because Python's `Path.resolve()` returns the
 * filesystem's own casing and follows links; `path.resolve` only makes a path absolute. The
 * registry is compared byte-for-byte by `tests/golden.py` (XDG is redirected into the
 * sandbox), so a differently-cased entry is a failing cell.
 */
export function registryRecord(dir) {
  try {
    let root;
    try { root = realpathSync.native(dir); } catch { root = path.resolve(dir); }
    const cur = registryLoad();
    if (!cur.includes(root)) registrySave([...cur, root]);
  } catch { /* a registry hiccup must never fail a build */ }
}

/**
 * `_install_registry.roots()` — live registered deploy roots, pruning the file as it reads.
 *
 * The prune is a WRITE, and reproducing it matters: `installs.json` is compared byte-for-byte,
 * so a read that failed to drop a dead row would leave the two implementations holding
 * different registries. The snapshot is taken once on purpose (its own comment says why):
 * comparing `kept` against a SECOND read could clobber a root a concurrent `record()`
 * appended between the two.
 */
export function registryRoots() {
  const original = registryLoad();
  const out = [];
  const kept = [];
  const seen = new Set();
  for (const s of original) {
    // `Path(s).expanduser()`, and `pyPathStr` is the `str()` around it — which is where the
    // NORMALISATION happens. Python turns `C:/x/other` into `C:\x\other` before it is
    // compared, kept, returned and printed, so a registry entry spelled with forward slashes
    // (routine: every tool that writes one from Git Bash) makes Python rewrite the file and
    // print a backslash path while a raw `expanduser` prints the entry verbatim and leaves
    // installs.json alone. Invisible to every cell before P5h, because `rebuild-all`'s
    // registry cells seed native spellings; `uninstall`'s inventory prints the root.
    // `expanduser` now REFUSES a `~user` entry (js/hosts.mjs's docblock) instead of passing
    // it through. This loop scans STORED registry rows, not a fresh CLI argument — a single
    // bad row (hand-edited, or written before this refusal existed) must not abort the scan
    // for every other install, so it is dropped exactly like any other dead row rather than
    // propagated. `rebuild-all`'s contract is "one broken install never blocks the rest".
    let root;
    try { root = pyPathStr(expanduser(s)); } catch { continue; }
    let key;
    try { key = existsSync(root) ? realpathSync.native(root) : root; } catch { key = root; }
    if (seen.has(key)) continue;
    if (isDir(root) && isFile(path.join(root, '.geneseed-emit'))) {
      seen.add(key);
      kept.push(root);
      out.push(root);
    }
  }
  if (kept.length !== original.length || kept.some((v, i) => v !== original[i])) {
    registrySave(kept);
  }
  return out;
}
