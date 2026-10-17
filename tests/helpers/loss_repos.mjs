// Deletion Is Deliberate, calibrated to real loss: ONE policy table, driven through every host's
// gate — the Claude/OpenClaude/Bob hook (`tests/unit/hook_gates.test.mjs`) and the OpenCode guard
// plugin (`tests/plugins/guard.test.mjs`) — against REAL repositories built here, so the two twins
// (js/hosts/loss.mjs and the plugin's copy) are judged by the same rows and cannot drift apart.
//
// Each row is written out: the command, the repository state it runs in, and whether the gate
// must stop it (`stop: true` — ask on Claude, exit 2 on Bob, a block on OpenCode) or let it
// through. `always: true` marks the two acts that lose data in EVERY state (`reflog expire`,
// `gc --prune`): the hook asks for them, and OpenCode leaves them to its static `permission.bash`
// glob (asserted in tests/unit/generate.test.mjs), so the guard lets them through.
//
// Git is ISOLATED: no system or global config (a user's `commit.gpgsign`, hooks, fsmonitor or a
// different default branch would otherwise hang or skew a row), and the same env is what the
// gate's own `git` inherits — pass `GIT_ENV` to a hook child, or set it on `process.env` around
// an in-process guard call.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeSandbox } from './sandbox.mjs';

/**
 * A workspace: `bare.git` (the remote), `repo` (a clone of it on `main`, with `origin/HEAD` ->
 * `develop`, so a non-`main` default branch is protected too), and `outside` (a directory in no
 * repository). `repo` holds tracked `tracked.txt` and `build/out.txt`, an always-present ignored
 * `ignored.log`, and branches `pushed` (tip on origin), `merged` (tip reachable from HEAD, never
 * pushed) and `unpushed` (one commit nowhere else).
 */
export function makeLossWorkspace() {
  const sb = makeSandbox('gsloss-');
  const root = sb.path;
  const gitcfg = path.join(root, 'empty.gitconfig');
  fs.writeFileSync(gitcfg, '');
  const env = {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitcfg,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  };
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
    return r.stdout;
  };
  const bare = path.join(root, 'bare.git');
  const repo = path.join(root, 'repo');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'notes.txt'), 'mine\n');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(root, 'init', '-q', '-b', 'main', repo);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
  fs.mkdirSync(path.join(repo, 'build'));
  fs.writeFileSync(path.join(repo, 'build', 'out.txt'), 'built\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'branch', 'develop');
  git(repo, 'branch', 'pushed');
  git(repo, 'branch', 'merged');
  git(repo, 'push', '-q', 'origin', 'main', 'develop', 'pushed');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
  git(repo, 'checkout', '-q', '-b', 'unpushed');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'only here');
  git(repo, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'ignored.log'), 'noise\n');

  /** Put `repo` into `state` for the length of `fn` — awaited when it returns a promise — then back to clean. */
  function inState(state, fn) {
    const tracked = path.join(repo, 'tracked.txt');
    const untracked = path.join(repo, 'untracked.txt');
    if (state === 'dirty') fs.writeFileSync(tracked, 'one\nchanged\n');
    if (state === 'untracked') fs.writeFileSync(untracked, 'new\n');
    if (state === 'stash') {
      fs.writeFileSync(tracked, 'stashed\n');
      git(repo, 'stash', 'push', '-q');
    }
    const restore = () => {
      fs.writeFileSync(tracked, 'one\n');
      fs.rmSync(untracked, { force: true });
      if (state === 'stash') git(repo, 'stash', 'clear');
    };
    let result;
    try {
      result = fn();
    } catch (e) {
      restore();
      throw e;
    }
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  }

  return { root, repo, outside, env, git, inState, cleanup: sb.cleanup };
}

/** The policy table. `cmd` may name `{outside}`, replaced by the workspace's outside directory. */
export const LOSS_ROWS = [
  // A protected branch — main, master, or a remote's default (origin/HEAD -> develop) — deleted
  // or force-pushed, local or remote.
  { cmd: 'git branch -D main', state: 'clean', stop: true },
  { cmd: 'git branch --delete --force develop', state: 'clean', stop: true },
  { cmd: 'git push --force origin main', state: 'clean', stop: true },
  { cmd: 'git push origin -f develop', state: 'clean', stop: true },
  { cmd: 'git push origin :main', state: 'clean', stop: true },
  { cmd: 'git push --delete origin master', state: 'clean', stop: true },
  { cmd: 'git push origin +HEAD:main', state: 'clean', stop: true },
  { cmd: 'git push --force-with-lease origin main', state: 'clean', stop: true },
  // Any other branch: a force push, or a lease, loses nothing Law IV guards.
  { cmd: 'git push --force origin pushed', state: 'clean', stop: false },
  { cmd: 'git push --force-with-lease origin feature', state: 'clean', stop: false },
  { cmd: 'git push origin +HEAD:feature', state: 'clean', stop: false },
  // `branch -D`: asks only when the branch's commits are on no remote ref and not in HEAD.
  { cmd: 'git branch -D unpushed', state: 'clean', stop: true },
  { cmd: 'git branch -D pushed', state: 'clean', stop: false },
  { cmd: 'git branch -D merged', state: 'clean', stop: false },
  { cmd: 'git branch -df unpushed', state: 'clean', stop: true },
  // Discarding uncommitted work: only when the tree holds some.
  { cmd: 'git reset --hard', state: 'dirty', stop: true },
  { cmd: 'git reset --hard', state: 'clean', stop: false },
  { cmd: 'git reset -q --hard HEAD', state: 'dirty', stop: true },
  { cmd: 'git checkout -- tracked.txt', state: 'dirty', stop: true },
  { cmd: 'git checkout -- tracked.txt', state: 'clean', stop: false },
  { cmd: 'git checkout -- build', state: 'dirty', stop: false },   // the change is elsewhere
  { cmd: 'git checkout -f', state: 'dirty', stop: true },
  { cmd: 'git checkout --force', state: 'clean', stop: false },
  { cmd: 'git switch --discard-changes main', state: 'dirty', stop: true },
  { cmd: 'git switch -f main', state: 'clean', stop: false },
  { cmd: 'git restore tracked.txt', state: 'dirty', stop: true },
  { cmd: 'git restore .', state: 'clean', stop: false },
  { cmd: 'git restore --staged --worktree tracked.txt', state: 'dirty', stop: true },
  { cmd: 'git restore --staged tracked.txt', state: 'dirty', stop: false },
  { cmd: 'git clean -fd', state: 'untracked', stop: true },
  { cmd: 'git clean -fd', state: 'clean', stop: false },   // ignored.log is kept without -x
  { cmd: 'git clean -fdx', state: 'clean', stop: true },   // ...and removed with it
  // A stash: only while one exists.
  { cmd: 'git stash drop', state: 'stash', stop: true },
  { cmd: 'git stash clear', state: 'stash', stop: true },
  { cmd: 'git stash drop', state: 'clean', stop: false },
  // The recovery net itself, in every state.
  { cmd: 'git reflog expire --expire=now --all', state: 'clean', stop: true, always: true },
  { cmd: 'git gc --prune=now', state: 'clean', stop: true, always: true },
  // File removal: only what git can restore — tracked AND unmodified — passes.
  { cmd: 'rm tracked.txt', state: 'clean', stop: false },
  { cmd: 'rm -rf build', state: 'clean', stop: false },
  // Not `-Force`: the OpenCode guard blocks any `Remove-Item -Recurse -Force` as catastrophic,
  // whatever its target (SHELL_BLOCK_RE, unchanged by this calibration).
  { cmd: 'Remove-Item -Recurse build', state: 'clean', stop: false },
  { cmd: 'rm tracked.txt', state: 'dirty', stop: true },
  { cmd: 'rm -f untracked.txt', state: 'untracked', stop: true },
  { cmd: 'ri untracked.txt', state: 'untracked', stop: true },
  { cmd: 'del /q untracked.txt', state: 'untracked', stop: true },
  { cmd: 'rm ignored.log', state: 'clean', stop: true },
  { cmd: 'rm -rf .git', state: 'clean', stop: true },
  { cmd: 'rm -rf {outside}', state: 'clean', stop: true },
  { cmd: 'rm -f missing.txt', state: 'clean', stop: false },  // nothing there, nothing lost
  // Fail closed: what the gate cannot read, it does not pass.
  { cmd: 'rm -rf *.txt', state: 'clean', stop: true },
  { cmd: 'rm "$FILE"', state: 'clean', stop: true },
  { cmd: 'sh -c "rm -rf build"', state: 'clean', stop: true },
  { cmd: 'cd "$DIR" && git reset --hard', state: 'clean', stop: true },
  { cmd: 'git -C {outside} reset --hard', state: 'clean', stop: true },
  // Not a deletion at all.
  { cmd: 'git commit -m "rm -rf everything, reset --hard"', state: 'clean', stop: false },
  { cmd: 'git worktree remove --force ../x', state: 'clean', stop: false },
  { cmd: 'npm rm left-pad', state: 'clean', stop: false },
  { cmd: 'git status', state: 'dirty', stop: false },
];

/** `row.cmd` with `{outside}` filled in (forward slashes: the commands are shell text). */
export const rowCommand = (row, ws) => row.cmd.replaceAll('{outside}', ws.outside.replace(/\\/g, '/'));
