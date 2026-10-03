/**
 * js/hosts/gitref.mjs — "what branch, and is a loop running here", read straight off the
 * filesystem. Never spawns git.
 *
 * ONE OWNER, fs/path ONLY, NOTHING ELSE. Before this module, `currentBranch` and the
 * launched-loop evidence reader were duplicated in `js/hosts/hooks.mjs` (the hook's
 * `loopExempt`) and `js/loop/cli.mjs` (the CLI's commit-message writer) — two copies of the
 * same worktree-following walk that could silently drift apart. Both now import this one.
 * `js/hosts/hooks.mjs` is NOT a safe shared home for it: it pulls in `node:child_process`
 * (`spawnSync`, for the destructive-act guard's own concerns) and the hook-dispatch
 * machinery (`jsonDumpsCompact`, the ledger), none of which `js/loop/cli.mjs` — under a hard
 * `child_process` ban like every other closure that feeds `bin/geneseed-cli.mjs` — may ever
 * import. A module that is fs/path only is importable from anywhere.
 *
 * The OpenCode guard plugin (`adapters/opencode/plugins/geneseed-guard.js`) keeps its own
 * standalone copy — it cannot import from `js/` at all — kept in step by hand, commented as
 * this module's twin.
 */
import { existsSync, statSync, lstatSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';

/**
 * The directory holding `.git` for `cwd` — walking up from `cwd`. A worktree's `.git` is a
 * FILE naming its gitdir elsewhere; LOOP.md always lives beside that FILE, not beside the
 * gitdir it points to, so this is the directory the launched-loop evidence reader looks in.
 * null on anything unexpected.
 */
export function gitRootOf(cwd) {
  try {
    let dir = path.resolve(cwd);
    for (;;) {
      if (existsSync(path.join(dir, '.git'))) return dir;
      const up = path.dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  } catch {
    return null;
  }
}

/**
 * The `.git` DIRECTORY for `root` — itself, or the gitdir a worktree's `.git` FILE names.
 * Throws if `.git` is a file that does not name one: a malformed worktree link is a louder
 * failure than a silent "no gitdir", and every caller here wants to know before it acts on it.
 */
export function gitDirOf(root) {
  const dotgit = path.join(root, '.git');
  if (statSync(dotgit).isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'));
    if (!m) throw new Error(`${dotgit} does not name a gitdir`);
    return path.resolve(root, m[1]);
  }
  return dotgit;
}

/**
 * The branch checked out in `cwd`, read from .git/HEAD without spawning git. null on
 * anything unexpected (detached HEAD, no repo, a malformed worktree link, unreadable) — the
 * caller then falls back to asking, never to allowing.
 */
export function currentBranch(cwd) {
  try {
    const root = gitRootOf(cwd);
    if (!root) return null;
    const ref = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readFileSync(path.join(gitDirOf(root), 'HEAD'), 'utf8'));
    return ref ? ref[1] : null;
  } catch {
    return null;
  }
}

const LOOP_STATE_MARKER = '<!-- loop-state:begin -->';

/**
 * Whether `<root>/LOOP.md` carries the engine's state marker — `geneseed loop init`'s mark
 * that a loop was actually LAUNCHED here, not merely that the branch is named `loop/...`,
 * which anyone can type. `lstatSync` (never `statSync`, which follows a link) must find an
 * ordinary file: a FIFO would block the read, and a symlink could point anywhere outside the
 * repo — either makes "LOOP.md says so" a claim this reader cannot stand behind. Read at
 * most the first 64 KB: the marker is not on the first line (it follows the title and the
 * requirement), so it must appear within those 64 KB — a huge LOOP.md (notes, history) must
 * never make this check slow.
 */
export function loopLaunched(root) {
  let fd;
  try {
    const p = path.join(root, 'LOOP.md');
    if (!lstatSync(p).isFile()) return false;
    fd = openSync(p, 'r');
    const buf = Buffer.alloc(65536);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8', 0, n).includes(LOOP_STATE_MARKER);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already gone */ } }
  }
}
