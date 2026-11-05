/**
 * The machine-wide Geneseed directory: `$XDG_CONFIG_HOME/geneseed`, default `~/.config/geneseed`.
 *
 * ONE WRITER PER VALUE. The install registry, the user loop bricks and the shared tier all live
 * under this directory; each used to spell the XDG computation itself, and a spelling that drifts
 * in one place sends that file to a different directory than its neighbours. This module is the
 * only home of the computation and of the names beneath it.
 *
 * Builtins only and no spawn: the hook and the build driver may import it, and both are under a
 * `child_process` ban. `process.env` is read at CALL time, so a sandbox that sets
 * `XDG_CONFIG_HOME` after import is honoured.
 */
import os from 'node:os';
import path from 'node:path';

/**
 * The wiki manifest's names, newest first. The last two are earlier seeds', read with no end date:
 * nothing yet tells a user an install missed the rename, so dropping one would lose a wiki in
 * silence. The OpenCode plugins carry a copy (tests/unit/claude.test.mjs holds the context one equal).
 */
export const WIKI_NAMES = ['geneseed-wiki.jsonc', 'wiki.jsonc', 'wiki.json'];

export function machineDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'geneseed');
}

/**
 * The tier's root as a render spells it: `/`-separated on every platform, as a global Bob skill
 * pointer is, so a doctor can compare strings. null when the account has no home directory.
 */
export function renderedSharedRoot() {
  try { return machineDir().split(path.sep).join('/'); } catch { return null; }
}

/** Every file or directory the machine tier names, resolved under `machineDir()`. */
export function sharedPaths() {
  const root = machineDir();
  return {
    root,
    memory: path.join(root, 'memory'),
    rules: path.join(root, 'user-rules.md'),
    profile: path.join(root, 'PROFILE.md'),
    wiki: path.join(root, 'geneseed-wiki.jsonc'),
    excludes: path.join(root, 'excludes.json'),
    notes: path.join(root, 'notes'),
    draft: path.join(root, 'user-rules.draft.md'),
    foldState: path.join(root, '.fold-state.json'),
  };
}
