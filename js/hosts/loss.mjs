/**
 * js/hosts/loss.mjs — Deletion Is Deliberate, calibrated to REAL loss.
 *
 * WHY THIS EXISTS. The git gate used to ask on every destructive-LOOKING form: `reset --hard`
 * on a clean tree, `branch -D` of a branch already on its remote, a force push to a feature
 * branch. A gate that asks when nothing can be lost teaches the user to click through it, and
 * then it protects nothing (user decision, 2026-10-17). So the boundary now asks only when the
 * command would destroy something nothing else holds:
 *
 *   - a protected branch (`main`, `master`, a remote's default) deleted or force-pushed, local
 *     or remote;
 *   - `branch -D x` while x carries a commit no remote ref and no HEAD reaches;
 *   - uncommitted work discarded (`reset --hard`, `checkout -f`/`-- <paths>`, `switch -f`/
 *     `--discard-changes`, `restore` beyond `--staged` alone, `clean -f`) — and only when the
 *     tree actually holds such work (for `clean`, what `git clean -n` says it would remove);
 *   - only where a protected branch is concerned (user ruling, 2026-10-17): `checkout <paths>`
 *     without `--` and `git rm -f` over changed files while a protected branch is checked out, and
 *     `branch -f`/`checkout -B`/`switch -C` moving a protected branch off commits nothing else
 *     holds — the same forms on a feature branch pass;
 *   - `stash drop`/`stash clear` while a stash exists; `reflog expire` and `gc --prune` always;
 *   - a file removal (`rm`, `rmdir`, `unlink`, `del`, `erase`, `Remove-Item`/`ri`/`rd`) of
 *     anything git cannot bring back: untracked, ignored or modified files, a repository's own
 *     `.git`, or any path outside a git repository.
 *
 * FAIL CLOSED. Anything this reader cannot settle — a glob or a `$variable` in a path it must
 * name, a `cd` it cannot follow, an interpreter (`sh -c`, `xargs`, `eval`, `find -delete`)
 * carrying a removal, a removal that names no path (`… | Remove-Item` takes its paths from the
 * pipe), a wrapper flag whose arity it does not know, ANY program it does not read (`setsid`,
 * `ForEach-Object`, `case`) with a removal named unquoted after it, a git that fails, times out
 * or is missing — asks, and the reason says it could not verify. A command substitution
 * (`$(…)`, backticks) is judged as a command of its own. "Not proven safe" is an ask; only
 * "proven safe" passes.
 *
 * THE ONE SPAWN IN THE GATE PATH, and why it is allowed. Whether a work tree is dirty, which
 * files are untracked, and whether a branch's commits are reachable elsewhere are not readable
 * off disk at any sane cost (the index is a binary format with stat caches; reachability walks
 * compressed objects and packs). So `git` itself answers, through `git()` below — `shell:false`,
 * a timeout, no optional locks (`git status` must never take `index.lock` under the user), no
 * fsmonitor, no terminal prompt. It is reached ONLY after `LOSS_CANDIDATE_RE` matched a
 * destructive-looking form and the parse below found one in program position: an ordinary
 * command never gets here (`js/hosts/hooks.mjs` tests the regex first), so the ~14 ms hook
 * budget is untouched for everything else. Refs, the remote default branch and the stash are
 * still read off disk (`./gitref.mjs`), which costs nothing. One ordinary form does pay: a plain
 * `git checkout <x>` while a protected branch is checked out runs `git rev-parse` to tell a
 * branch switch from a path discard (the branch is read off disk first, so a feature branch
 * never pays it).
 *
 * TWIN: `adapters/opencode/plugins/geneseed-guard.js` carries the same decisions (the plugin is
 * copied whole into an OpenCode install and cannot import this). Keep the two in step;
 * `tests/plugins/guard.test.mjs` drives both through one table of real repositories.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { currentBranch, gitRootOf, protectedBranches, stashExists } from './gitref.mjs';

// ---- loss twin: BEGIN — adapters/opencode/plugins/geneseed-guard.js carries everything down to
// the END marker verbatim, with `export ` dropped (tests/plugins/guard.test.mjs diffs the two).

/**
 * The cheap prefilter: a command that matches neither alternative never reaches the parser or
 * a spawn. A git destructive VERB anywhere after `git` on the same line, or a removal program
 * as a word at a command boundary. Deliberately loose — the parse decides; this only has to be
 * a superset of what the parse acts on.
 */
export const LOSS_CANDIDATE_RE =
  /\bgit\b[^\n]*\b(?:reset|clean|branch|checkout|switch|restore|stash|reflog|gc|push)\b|(?:^|[\s;&|("'`])(?:rm|rmdir|unlink|del|erase|remove-item|ri|rd)(?:\.exe)?(?=[\s;&|)"'`]|$)|(?:^|\s)-delete(?=\s|$)/im;

class Unverified extends Error {}
const unverified = (why) => { throw new Unverified(why); };

const RM_PROGS = new Set(['rm', 'rmdir', 'unlink', 'del', 'erase', 'remove-item', 'ri', 'rd']);
// cmd.exe's own removal verbs take `/s` `/q` switches, which are not paths.
const CMD_SWITCH_PROGS = new Set(['rmdir', 'del', 'erase', 'rd']);
const CD_PROGS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
// A wrapper runs the command after its own flags: `<short flags taking a value>|<short flags taking
// none>`. A flag in neither list (`env -S` runs a string, `env -C`/`sudo -D` change directory,
// `command -v` only looks up) is not guessed at — the segment asks if it names a removal.
const WRAPPERS = new Map([['sudo', 'ughpCUrtT|AbEHiknPSs'], ['doas', 'uC|ns'], ['command', '|p'],
  ['builtin', '|'], ['\\builtin', '|'], ['time', 'fo|pav'], ['nice', 'n|'], ['nohup', '|'],
  ['exec', 'a|cl'], ['env', 'u|i0v'], ['timeout', 'sk|v'], ['ionice', 'cn|t'], ['stdbuf', 'ioe|']]);
const WRAPPER_LONG = new Set(['--preserve-status', '--foreground', '--verbose', '--login', '--preserve-env',
  '--non-interactive', '--ignore-environment', '--null']);
// Shell grammar that may stand before the program word (`(cd x && rm y)`, `if …; then rm y; fi`).
const STRUCTURE = new Set(['(', '((', '{', '!', 'if', 'then', 'elif', 'else', 'do', 'while', 'until']);
// The only programs this reader does not parse that may still name a removal word and pass: their
// `rm`/`del` is their own subcommand (a package, a container), or they never run their arguments
// (a substitution in one is judged on its own). Any other program over a removal word asks.
const INERT = new Set(['npm', 'pnpm', 'yarn', 'bun', 'cargo', 'brew', 'docker', 'podman', 'echo', 'printf',
  'grep', 'egrep', 'fgrep', 'rg', 'findstr', 'select-string', 'which', 'where', 'type', 'man', 'get-command',
  'get-help']);
// Programs that run ANOTHER command from their arguments or stdin: what they would remove is
// not on this command line in a form the parse can read, so a removal word inside one asks.
const INDIRECT = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd',
  'eval', 'xargs', 'find', 'parallel', 'watch', 'invoke-expression', 'iex']);

const OPAQUE = '\u0000';
const GIT_TIMEOUT_MS = 5000;

/**
 * `git -C <dir> …` — THE spawn. Returns `{ status, stdout, stderr }`; throws `Unverified` when
 * git could not run to completion (missing, timed out, output too large), so the caller asks.
 */
function git(dir, args) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  const r = spawnSync('git', ['-C', dir, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: GIT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  if (r.error || r.status === null) {
    unverified(`git ${args[0]} did not finish (${r.error ? /** @type {any} */ (r.error).code || r.error.message : 'killed'})`);
  }
  return r;
}

const firstLine = (s) => String(s || '').trim().split(/\r?\n/)[0] || 'no output';

/** A raw token with its quotes removed, or `OPAQUE`-marked when the shell would rewrite it. */
function word(raw) {
  const opaque = /[`$]|^~|[{}]/.test(raw);
  const s = raw.replace(/"([^"]*)"?|'([^']*)'?/g, (_, a, b) => a ?? b ?? '');
  return opaque ? `${OPAQUE}${s}` : s;
}

/** The segment's words, redirections dropped (`2>/dev/null`, `> out.log`) — they are not operands. */
function words(rawTokens) {
  const out = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i];
    if (/^(?:\d*|&)(?:>>?|<)&?$/.test(t)) { i += 1; continue; }   // a bare operator: drop its target too
    if (/^(?:\d*|&)(?:>>?|<)/.test(t)) continue;
    out.push(word(t));
  }
  return out;
}

/** `p` resolved against `dir`. On Windows a Git Bash `/c/…` path maps to `C:/…`; any other POSIX root cannot. */
function resolveIn(dir, p) {
  if (p.includes(OPAQUE)) unverified(`\`${p.replace(OPAQUE, '')}\` expands in the shell`);
  let q = p;
  if (process.platform === 'win32') {
    const m = /^\/([a-zA-Z])(\/.*)?$/.exec(q);
    if (m) q = `${m[1]}:${m[2] || '/'}`;
    else if (/^\/(?!\/)/.test(q)) unverified(`${p} is a POSIX path this host cannot map`);
  }
  if (!dir && !path.isAbsolute(q)) unverified('the working directory is unknown after a `cd` the gate cannot follow');
  return path.resolve(dir || '', q);
}

function repoRoot(dir) {
  if (!dir) unverified('the working directory is unknown after a `cd` the gate cannot follow');
  return gitRootOf(dir) || unverified(`${dir} is not inside a git repository`);
}

/** Ask if `git status` shows a tracked change (staged or not) under `paths` (all when empty). */
function dirty(dir, paths, act) {
  for (const p of paths) if (p.includes(OPAQUE)) unverified(`\`${p.replace(OPAQUE, '')}\` expands in the shell`);
  repoRoot(dir);
  const r = git(dir, ['status', '--porcelain', '-z', '--untracked-files=no', '--', ...paths]);
  if (r.status !== 0) unverified(`git status failed: ${firstLine(r.stderr)}`);
  const first = r.stdout.split('\0').find(Boolean);
  return first ? `${act} would discard uncommitted changes (${first.slice(3)})` : null;
}

const isCluster = (a) => /^-[a-zA-Z]+$/.test(a);
const hasShort = (a, c) => isCluster(a) && a.includes(c);

/** `git push` — asks only when a protected branch would be force-pushed or deleted. */
function pushAct(rest, dir) {
  let force = false; let del = false; let all = false; let mirror = false; let prune = false;
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { pos.push(...rest.slice(i + 1)); break; }
    if (['-o', '--push-option', '--repo', '--receive-pack', '--exec'].includes(a)) { i += 1; continue; }
    if (a.startsWith('--')) {
      if (/^--force(?:-with-lease)?(?:=|$)/.test(a)) force = true;
      else if (a === '--delete') del = true;
      else if (a === '--all' || a === '--branches') all = true;
      else if (a === '--mirror') mirror = true;
      else if (a === '--prune') prune = true;
      continue;
    }
    if (isCluster(a)) { if (a.includes('f')) force = true; if (a.includes('d')) del = true; continue; }
    pos.push(a);
  }
  const specs = pos.slice(1);
  const forcedSpec = (s) => force || del || s.startsWith('+') || s.startsWith(':');
  if (!force && !del && !mirror && !prune && !specs.some(forcedSpec)) return null;
  if (mirror) return '`git push --mirror` force-pushes and deletes every remote branch to match this repository';
  if (prune) return '`git push --prune` deletes every remote branch with no local counterpart';
  if (all && force) return 'a forced `git push --all` force-pushes every branch, protected ones included';
  const root = repoRoot(dir);
  const protectedSet = protectedBranches(root);
  const verb = del ? 'delete' : 'force-push';
  let targets;
  if (specs.length) {
    targets = [];
    for (const spec of specs) {
      if (spec.includes(OPAQUE)) unverified(`the refspec \`${spec.replace(OPAQUE, '')}\` expands in the shell`);
      if (!forcedSpec(spec)) continue;
      const s = spec.replace(/^\+/, '');
      const colon = s.indexOf(':');
      if (!del && colon === 0) {
        const dst = s.slice(1).replace(/^refs\/heads\//, '');
        if (protectedSet.has(dst)) return `\`git push ${spec}\` would delete the protected branch ${dst}`;
        continue;
      }
      targets.push(del || colon < 0 ? s : s.slice(colon + 1));
    }
  } else {
    targets = defaultPushTargets(dir);
  }
  for (let t of targets) {
    if (t === 'HEAD' || t === '@') t = currentBranch(dir) || unverified('HEAD is detached, so the pushed branch is unknown');
    t = t.replace(/^refs\/heads\//, '');
    if (t.startsWith('refs/')) continue;   // a tag or another namespace, not a branch
    if (/[*?]/.test(t)) unverified(`the refspec target \`${t}\` is a pattern`);
    if (protectedSet.has(t)) return `\`git push\` would ${verb} the protected branch ${t}`;
  }
  return null;
}

/**
 * What a refspec-less forced push targets: the current branch (`simple`/`current`) and its
 * upstream (`upstream`). `matching` pushes every branch and a `remote.*.push` rewrites the
 * target — neither is something this read can bound, so both ask.
 */
function defaultPushTargets(dir) {
  const cur = currentBranch(dir) || unverified('HEAD is detached, so the pushed branch is unknown');
  const esc = cur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const r = git(dir, ['config', '--get-regexp', `^(push\\.default|remote\\..*\\.push|branch\\.${esc}\\.merge)$`]);
  if (r.status !== 0 && r.status !== 1) unverified(`git config failed: ${firstLine(r.stderr)}`);
  const targets = [cur];
  for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
    const [key, value = ''] = line.split(/\s+/, 2);
    if (/^remote\..*\.push$/i.test(key)) unverified(`${key} rewrites what a bare push targets`);
    if (/^push\.default$/i.test(key) && value === 'matching') unverified('push.default=matching pushes every branch');
    if (/\.merge$/i.test(key)) targets.push(value);
  }
  return targets;
}

/**
 * The checked-out branch when it is protected, null when HEAD is detached or unreadable, and
 * undefined when it is a known unprotected branch — read off disk, so a feature branch passes the
 * protected-branch-only forms below without running git (user ruling, 2026-10-17).
 */
function protectedHead(dir) {
  const cur = currentBranch(dir);
  return cur && !protectedBranches(repoRoot(dir)).has(cur) ? undefined : cur;
}

/** `lost` on the protected branch `cur`; an unknown HEAD cannot be cleared as unprotected, so it asks. */
function onProtected(cur, lost) {
  if (!lost) return null;
  if (!cur) unverified('HEAD is detached or unreadable, so the gate cannot tell whether a protected branch is checked out');
  return `${lost} on the protected branch ${cur}`;
}

/**
 * `branch -f`, `checkout -B`, `switch -C` moving `name` to `start` (HEAD when absent): stops when
 * `name` is protected and its old tip holds a commit neither `start` nor any remote ref reaches.
 * A branch that does not exist yet is created, which loses nothing.
 */
function forceMove(dir, name, start, act) {
  if (name === undefined) return null;   // git refuses the command on its own
  if (name.includes(OPAQUE)) unverified(`the branch name \`${name.replace(OPAQUE, '')}\` expands in the shell`);
  if (!protectedBranches(repoRoot(dir)).has(name)) return null;
  const tip = git(dir, ['rev-parse', '-q', '--verify', `refs/heads/${name}`]);
  if (tip.status === 1) return null;
  if (tip.status !== 0) unverified(`cannot read the branch ${name}: ${firstLine(tip.stderr)}`);
  const to = start ?? 'HEAD';
  if (to.includes(OPAQUE)) unverified(`the start point \`${to.replace(OPAQUE, '')}\` expands in the shell`);
  const r = git(dir, ['rev-list', '-n1', `refs/heads/${name}`, '--not', to, '--remotes']);
  if (r.status !== 0) unverified(`cannot compare ${name} with ${to}: ${firstLine(r.stderr)}`);
  return r.stdout.trim() ? `${act} ${name} would strand commits no remote and not ${to} holds` : null;
}

/**
 * `git checkout` with no `--` and no force: `-B <protected>` force-moves it; otherwise, on a
 * protected branch, positionals naming files (the first one is not a commit, or follows one)
 * discard their changes. A lone commit-ish is a branch switch, which refuses to overwrite work.
 */
function checkoutAct(rest, dir) {
  const pos = [];
  let reset;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-b' || a === '--orphan') return null;   // a new branch: additive
    if (a === '-B') { reset = rest[i + 1]; i += 1; continue; }
    if (a.startsWith('--pathspec-from-file')) unverified('checkout reads its paths from a file');
    if (!a.startsWith('-')) pos.push(a);
  }
  if (reset !== undefined) return forceMove(dir, reset, pos[0], '`git checkout -B`');
  if (!pos.length) return null;
  const cur = protectedHead(dir);
  if (cur === undefined) return null;
  let paths = pos;
  if (!pos[0].includes(OPAQUE) && git(dir, ['rev-parse', '-q', '--verify', `${pos[0]}^{commit}`]).status === 0) {
    if (pos.length === 1) return null;
    paths = pos.slice(1);
  }
  return onProtected(cur, dirty(dir, paths, '`git checkout <paths>`'));
}

/** `git branch` — a forced delete asks for a protected branch or one whose commits live nowhere else. */
function branchAct(rest, dir) {
  const opts = rest.filter((a) => a.startsWith('-'));
  const del = opts.some((a) => a === '--delete' || a === '-D' || hasShort(a, 'd') || hasShort(a, 'D'));
  const force = opts.some((a) => a === '--force' || a === '-D' || hasShort(a, 'f') || hasShort(a, 'D'));
  if (!force) return null;   // an un-forced delete refuses an unmerged branch on its own
  const names = rest.filter((a) => !a.startsWith('-'));
  if (!del) {
    // `branch -f <name> [<start>]`; a forced rename or copy (-M, -C) is another form.
    if (opts.some((a) => a === '--move' || a === '--copy' || [...'mMcC'].some((c) => hasShort(a, c)))) return null;
    return forceMove(dir, names[0], names[1], '`git branch -f`');
  }
  if (opts.some((a) => a === '-r' || a === '--remotes')) return null;   // a remote-tracking ref; `fetch` restores it
  const root = repoRoot(dir);
  const protectedSet = protectedBranches(root);
  for (const n of names) {
    if (n.includes(OPAQUE)) unverified(`the branch name \`${n.replace(OPAQUE, '')}\` expands in the shell`);
    if (protectedSet.has(n)) return `\`git branch -D ${n}\` deletes the protected branch ${n}`;
    // Empty output: every commit of `n` is reachable from a remote ref or from HEAD.
    const r = git(dir, ['rev-list', '-n1', `refs/heads/${n}`, '--not', '--remotes', 'HEAD']);
    if (r.status !== 0) unverified(`cannot read the branch ${n}: ${firstLine(r.stderr)}`);
    if (r.stdout.trim()) return `\`git branch -D ${n}\` deletes commits no remote and no HEAD holds`;
  }
  return null;
}

/** `git clean` — forced, it asks when `git clean -n` with the same selection lists anything. */
function cleanAct(rest, dir) {
  const forced = rest.some((a) => a === '--force' || hasShort(a, 'f'));
  if (!forced) return null;
  const dry = [];
  for (const a of rest) {
    if (a.includes(OPAQUE)) unverified(`\`${a.replace(OPAQUE, '')}\` expands in the shell`);
    if (a === '--force' || a === '--interactive') continue;
    if (isCluster(a)) {
      const kept = a.replace(/[fin]/g, '');
      if (kept !== '-') dry.push(kept);
      continue;
    }
    dry.push(a);
  }
  repoRoot(dir);
  const r = git(dir, ['clean', '-n', ...dry]);
  if (r.status !== 0) unverified(`git clean -n failed: ${firstLine(r.stderr)}`);
  const first = firstLine(r.stdout);
  return r.stdout.trim() ? `\`git clean\` would delete untracked files (${first.replace(/^Would remove /, '')})` : null;
}

/** One `git …` segment: the verdict for its verb, or null. */
function gitAct(args, dir, always) {
  let d = dir;
  let i = 0;
  let redirected = false;
  for (; i < args.length; i++) {
    const a = args[i];
    // A `-C` the gate cannot resolve leaves the directory unknown; only a destructive verb asks for it.
    if (a === '-C') { try { d = resolveIn(d, args[i + 1] ?? OPAQUE); } catch { d = null; } i += 1; continue; }
    if (a === '-c') { i += 1; continue; }
    if (/^--(?:git-dir|work-tree)(?:=|$)/.test(a)) { redirected = true; if (!a.includes('=')) i += 1; continue; }
    if (a.startsWith('-')) continue;
    break;
  }
  const verb = args[i];
  const rest = args.slice(i + 1);
  const act = () => {
    switch (verb) {
      case 'reset':
        return rest.includes('--hard') ? dirty(d, [], '`git reset --hard`') : null;
      case 'checkout': {
        const forced = rest.some((a) => a === '--force' || hasShort(a, 'f')) && dirty(d, [], '`git checkout --force`');
        if (forced) return forced;
        const dd = rest.indexOf('--');
        if (dd < 0) return checkoutAct(rest, d);
        const paths = rest.slice(dd + 1);
        return paths.length ? dirty(d, paths, '`git checkout --`') : null;
      }
      case 'switch': {
        const c = rest.findIndex((a) => a === '-C' || a === '--force-create');
        const pos = c < 0 ? [] : rest.slice(c + 1).filter((a) => !a.startsWith('-'));
        return (c >= 0 && forceMove(d, pos[0], pos[1], '`git switch -C`'))
          || (rest.some((a) => a === '--force' || a === '--discard-changes' || hasShort(a, 'f'))
            ? dirty(d, [], '`git switch --discard-changes`') : null);
      }
      case 'rm': {
        // Only a forced removal discards changes: git refuses a modified file without -f, and
        // `--cached` or `-n` keep the file. Protected branch only (user ruling, 2026-10-17).
        if (!rest.some((a) => a === '--force' || hasShort(a, 'f'))) return null;
        if (rest.some((a) => a === '--cached' || a === '--dry-run' || hasShort(a, 'n'))) return null;
        if (rest.some((a) => a.startsWith('--pathspec-from-file'))) unverified('git rm reads its paths from a file');
        const paths = rest.filter((a) => !a.startsWith('-'));
        const cur = paths.length ? protectedHead(d) : undefined;
        return cur === undefined ? null : onProtected(cur, dirty(d, paths, '`git rm -f`'));
      }
      case 'restore': {
        const staged = rest.some((a) => a === '--staged' || hasShort(a, 'S'));
        const worktree = rest.some((a) => a === '--worktree' || hasShort(a, 'W'));
        if (staged && !worktree) return null;   // unstaging only: the change stays in the tree
        if (rest.some((a) => a.startsWith('--pathspec-from-file'))) unverified('restore reads its paths from a file');
        const paths = [];
        for (let j = 0; j < rest.length; j++) {
          const a = rest[j];
          if (a === '-s' || a === '--source') { j += 1; continue; }
          if (a === '--') continue;
          if (!a.startsWith('-')) paths.push(a);
        }
        return paths.length ? dirty(d, paths, '`git restore`') : null;
      }
      case 'clean':
        return cleanAct(rest, d);
      case 'stash': {
        const sub = rest.find((a) => !a.startsWith('-'));
        if (sub !== 'drop' && sub !== 'clear') return null;
        return stashExists(repoRoot(d)) ? `\`git stash ${sub}\` deletes stashed work` : null;
      }
      case 'reflog':
        return always && rest.includes('expire') ? '`git reflog expire` deletes the reflog recovery depends on' : null;
      case 'gc':
        return always && rest.some((a) => a.startsWith('--prune'))
          ? '`git gc --prune` deletes the unreachable commits recovery depends on' : null;
      case 'branch':
        return branchAct(rest, d);
      case 'push':
        return pushAct(rest, d);
      default:
        return null;
    }
  };
  const verdict = act();
  if (verdict && redirected) return `${verdict} (and --git-dir/--work-tree points it at a repository the gate did not read)`;
  return verdict;
}

/** One removal segment: asks unless every operand is tracked AND unmodified in a git work tree. */
function rmAct(prog, args, dir) {
  const targets = [];
  let opts = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (opts && a === '--') { opts = false; continue; }
    if (opts && /^-(?:path|literalpath)$/i.test(a)) { targets.push(args[i + 1] ?? OPAQUE); i += 1; continue; }
    const bound = opts && /^-(?:path|literalpath)[:=](.+)$/i.exec(a);
    if (bound) { targets.push(bound[1]); continue; }
    if (opts && /^-(?:filter|include|exclude)(?:[:=]|$)/i.test(a)) unverified(`\`${prog} ${a}\` selects files the gate cannot list`);
    if (opts && a.length > 1 && a.startsWith('-')) continue;
    if (opts && CMD_SWITCH_PROGS.has(prog) && /^\/[a-zA-Z?]$/.test(a)) continue;
    targets.push(a);
  }
  // `… | Remove-Item`, `ri -Force`: the paths come from the pipe, which this reader cannot see.
  if (!targets.length) unverified(`\`${prog}\` names no path, so what it removes comes from elsewhere`);
  const groups = new Map();
  for (const t of targets) {
    const shown = t.replace(OPAQUE, '');
    if (t.includes(OPAQUE) || /[*?[\],]/.test(t)) unverified(`\`${shown}\` expands in the shell, so the gate cannot list what it names`);
    const abs = resolveIn(dir, t);
    if (abs.split(/[\\/]+/).includes('.git')) return `\`${prog} ${shown}\` deletes git's own data`;
    // Nothing there, nothing lost: `rm -f build.log` on a clean tree is routine cleanup.
    try { lstatSync(abs); } catch (e) {
      if (e && e.code === 'ENOENT') continue;
      unverified(`cannot read ${shown}: ${e && e.code}`);
    }
    const root = gitRootOf(abs);
    if (!root) return `\`${prog} ${shown}\` deletes a path outside any git repository, which nothing could restore`;
    if (path.resolve(root) === path.resolve(abs)) return `\`${prog} ${shown}\` deletes a whole repository or worktree`;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push({ shown, rel });
  }
  const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  for (const [root, list] of groups) {
    const r = git(root, ['ls-files', '-z', '-t', '--cached', '--others', '--modified', '--directory',
      '--', ...list.map((x) => `:(literal)${x.rel}`)]);
    if (r.status !== 0) unverified(`git ls-files failed: ${firstLine(r.stderr)}`);
    const entries = r.stdout.split('\0').filter(Boolean).map((e) => ({ tag: e[0], p: fold(e.slice(2)) }));
    for (const { shown, rel } of list) {
      const key = fold(rel);
      const mine = entries.filter((e) => e.p === key || e.p.startsWith(`${key}/`) || e.p === `${key}/`);
      if (!mine.length) return `\`${prog} ${shown}\` deletes something git does not track, which nothing could restore`;
      const bad = mine.find((e) => e.tag !== 'H');
      if (bad) {
        const what = bad.tag === '?' ? 'untracked or ignored' : 'modified or otherwise not restorable';
        return `\`${prog} ${shown}\` deletes ${what} files (${bad.p}), which git cannot restore`;
      }
    }
  }
  return null;
}

/** The program word, stripped of its path and `.exe`, lowercased (PowerShell and cmd are case-blind). */
const progOf = (w) => w.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');

/**
 * A segment's RAW tokens with the shell grammar around its command dropped: leading `(`, `{`,
 * `!`, `then`, `do`… (a `(` glued to the first word too) and a closing `)`/`}`. Without it
 * `(git reset --hard)` has `(git` for its program and `--hard)` for its flag. `rootScan`
 * shares it, so `(find / …)` is a scan.
 */
export function stripStructure(raw) {
  const t = raw.slice();
  while (t.length) {
    if (STRUCTURE.has(t[0])) t.shift();
    else if (/^\(+./.test(t[0])) t[0] = t[0].replace(/^\(+/, '');
    else break;
  }
  while (t.length && (t[t.length - 1] === '}' || /^\)+$/.test(t[t.length - 1]))) t.pop();
  if (t.length) t[t.length - 1] = t[t.length - 1].replace(/\)+$/, '');
  return t;
}

/**
 * The bodies of the command substitutions in `text` (`$(…)`, backticks, `<(…)`, `>(…)`) —
 * single quotes hide them, double quotes do not. An unclosed one runs to the end of the text:
 * the splitter already cut an unquoted `$(a; b)` at its `;`.
 */
function substitutions(text) {
  const out = [];
  let sq = false; let dq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (sq) { if (c === "'") sq = false; continue; }
    if (c === "'" && !dq) { sq = true; continue; }
    if (c === '"') { dq = !dq; continue; }
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      out.push(text.slice(i + 1, end < 0 ? text.length : end));
      i = end < 0 ? text.length : end;
    } else if ('$<>'.includes(c) && text[i + 1] === '(') {
      let depth = 1; let j = i + 2;
      for (; j < text.length && depth; j++) depth += text[j] === '(' ? 1 : text[j] === ')' ? -1 : 0;
      out.push(text.slice(i + 2, depth ? text.length : j - 1));
      i = j - 1;
    }
  }
  return out;
}

/** `w` past wrapper `name`'s own flags (and `timeout`'s duration), or null when a flag is unknown. */
function pastWrapper(name, w) {
  const [takes, plain] = WRAPPERS.get(name).split('|');
  let i = 0;
  for (; i < w.length && w[i].length > 1 && w[i].startsWith('-'); i++) {
    const a = w[i];
    if (a === '--') { i += 1; break; }
    if (a.startsWith('--')) { if (a.includes('=') || WRAPPER_LONG.has(a)) continue; return null; }
    if (name === 'nice' && /^-\d+$/.test(a)) continue;
    for (let j = 1; j < a.length; j++) {
      if (takes.includes(a[j])) { if (j === a.length - 1) i += 1; break; }   // the value: the rest, or the next word
      if (!plain.includes(a[j])) return null;
    }
  }
  if (name === 'timeout' && /^\d/.test(w[i] || '')) i += 1;
  return w.slice(i);
}

/**
 * The verdict for a whole command, given its segments as RAW token arrays (quotes still on —
 * `js/hosts/hooks.mjs` cuts and tokenises with the same lexer `rootScan` uses, so a quoted
 * `;` or a heredoc body is never a segment). Returns the reason it would lose data, or null
 * when it provably would not. What it cannot settle — a glob, a git that fails — is a "could not
 * verify" reason, never a throw. A BUG still throws, on purpose: `guardGate` turns it into a
 * `gate-error` (an ask on Claude, a warning on Bob) and the OpenCode guard logs and allows it —
 * each host's ceiling for a crashed gate (docs/adr/0007-gates-fail-closed-per-host-ceiling.md).
 * `always: false` skips the two acts that lose data in every state (`reflog expire`, `gc --prune`)
 * — the OpenCode guard passes it, because a static `permission.bash` glob already asks for those.
 * `split` cuts a command substitution's body into segments the same way (both callers pass their
 * splitter); without it, a substitution that names a removal asks.
 * @param {string[][]} segments
 * @param {string} cwd
 * @param {{ always?: boolean, split?: (text: string) => string[][] }} [options]
 */
export function lossReason(segments, cwd, { always = true, split } = {}) {
  /** The first loss among `segs`, run from `start`; a substitution body is judged as a command. */
  const judge = (segs, start, depth = 0) => {
    let dir = start;
    for (const raw of segs.map(stripStructure)) {
      const text = raw.join(' ');
      const named = LOSS_CANDIDATE_RE.test(text);
      for (const body of named ? substitutions(text) : []) {
        if (!LOSS_CANDIDATE_RE.test(body)) continue;
        // Bounded: `$($($(…` nested past any real command would rescan the text once per level.
        if (!split || depth >= 4) unverified('a command substitution names a removal');
        const v = judge(split(body), dir, depth + 1);
        if (v) return v;
      }
      let w = words(raw);
      while (w && w.length && (/^\w+=/.test(w[0]) || WRAPPERS.has(progOf(w[0])))) {
        const wrapper = progOf(w[0]);
        w = /^\w+=/.test(w[0]) ? w.slice(1) : pastWrapper(wrapper, w.slice(1));
        if (!w && named) unverified(`\`${wrapper}\` takes a flag the gate does not know`);
      }
      if (!w || !w.length) continue;
      const prog = progOf(w[0]);
      const args = w.slice(1);
      if (CD_PROGS.has(prog)) {
        const target = args.find((a) => !a.startsWith('-') && !/^\/d$/i.test(a));
        try { dir = target && target !== '-' ? resolveIn(dir, target) : null; } catch { dir = null; }
        continue;
      }
      let verdict = null;
      if (prog === 'git') verdict = gitAct(args, dir, always);
      else if (RM_PROGS.has(prog)) verdict = rmAct(prog, args, dir);
      else if (INDIRECT.has(prog) && LOSS_CANDIDATE_RE.test(args.join(' '))) {
        unverified(`\`${prog}\` runs a command the gate cannot read`);
      } else if (named && !INERT.has(prog)
        && LOSS_CANDIDATE_RE.test(raw.map((t) => t.replace(/"[^"]*"?|'[^']*'?/g, ' ')).join(' '))) {
        // A program this reader does not know (a wrapper, a loop, shell syntax) over an unquoted
        // removal word: it may run it, so it is not proven safe. A quoted word is data.
        unverified(`\`${w[0].replace(OPAQUE, '')}\` is not a program the gate reads, and a removal follows it`);
      }
      if (verdict) return verdict;
    }
    return null;
  };
  try {
    return judge(segments, cwd);
  } catch (e) {
    if (!(e instanceof Unverified)) throw e;
    return `the gate could not verify what this command would lose (${e.message})`;
  }
}

/**
 * THE CATASTROPHIC CLASS — what no state can make safe: a recursive removal of a filesystem root,
 * a drive root or the home directory, a device format or raw-disk overwrite, a fork bomb. Unlike
 * `lossReason` it reads no state, and it stands whatever the deletion gate's switch says (user
 * decision 2026-10-18): `--no-deletion-gate` silences the real-loss check, never this one. Judged
 * in PROGRAM position, segment by segment after `stripStructure` and the wrappers, so `true & rm
 * -rf /`, `sudo rm -rf /`, `(rm -rf /)` and `rm -rf /;` are caught and a commit message that only
 * names `rm -rf /` is not. A shell or `eval` (`bash -c '…'`, `pwsh -Command …`) and a `$(…)` body
 * are judged as commands of their own, and so is what a shell reads on stdin: a heredoc or
 * here-string fed to `bash`/`sh`/`pwsh`/`cmd`… (`bash <<'EOF'` over `rm -rf /`). One fed to any
 * other program (`cat <<EOF`, `git commit -F - <<EOF`) is data. The fork bomb spans `|`/`&`/`;`, so
 * it is tested on the whole command. `split` cuts a command into raw-token segments, as for
 * `lossReason`. Returns the offending text, or null.
 */
const CATASTROPHIC_CANDIDATE_RE = /(?:^|[^\w-])(?:rm|rmdir|rd|del|erase|remove-item|ri|mkfs(?:\.\w+)?|dd|format)(?:\.exe)?(?![\w-])|:\(\)/i;
const FORK_BOMB_RE = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;
// `/`, a Git Bash or WSL drive (`/c`, `/mnt/c`), a Windows drive (`C:`, `C:\`), the home dir — globbed or not.
const ROOT_TARGET_RE = /^(?:\/|~[\\/]?|\$\{?HOME\}?[\\/]?|\/[a-z]\/?|\/mnt\/[a-z]\/?|[a-z]:[\\/]?)\*?$/i;
const RM_RECURSE_RE = /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/;
// PowerShell's `-Recurse` (or any prefix of it) and cmd.exe's `/s`, alone or glued (`/s/q`).
const PS_CMD_RECURSE_RE = /^(?:-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?|(?:\/[a-z]+)*\/s(?:\/[a-z]+)*)$/i;
const leadingFlags = (w) => { let i = 0; while (i < w.length && /^[-/][\w-]+$/.test(w[i])) i += 1; return w.slice(i); };
// The programs that run what they read on stdin as commands.
const STDIN_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd']);
// The same lexer as the splitter's (a comment, a quoted run, a heredoc opener, a newline), so the
// openers it finds are the ones left in the segments' tokens, in the same order.
const HEREDOC_SCAN_RE = /(?<![^\s;|&(])#[^\n]*|"[^"]*"?|'[^']*'?|(?<!<)<<(?!<)(-?)[ \t]*(["']?)([A-Za-z_]\w*)\2|\n/g;
/** Every heredoc body in `command`, in opener order; an unterminated one runs to the end, as in bash. */
function heredocBodies(command) {
  const out = [];
  const tags = [];
  const re = new RegExp(HEREDOC_SCAN_RE);
  let m;
  while ((m = re.exec(command))) {
    if (m[3]) { tags.push([m[1], m[3]]); continue; }
    if (m[0] !== '\n' || !tags.length) continue;
    let start = re.lastIndex;
    while (tags.length) {
      const [dash, tag] = tags.shift();
      const body = [];
      while (start < command.length) {
        const end = command.indexOf('\n', start);
        const line = command.slice(start, end < 0 ? command.length : end).replace(/\r$/, '');
        start = end < 0 ? command.length : end + 1;
        if ((dash ? line.replace(/^\t+/, '') : line) === tag) break;
        body.push(line);
      }
      out.push(body.join('\n'));
    }
    re.lastIndex = start;
  }
  return out;
}
export function catastrophic(command, split, depth = 0) {
  if (!CATASTROPHIC_CANDIDATE_RE.test(command)) return null;
  if (FORK_BOMB_RE.test(command)) return command.trim();
  const bodies = command.includes('<<') ? heredocBodies(command) : [];
  let next = 0;
  for (const raw of split(command).map(stripStructure)) {
    const text = raw.join(' ');
    // What this segment feeds on stdin: each heredoc opener takes the next body, a here-string its word.
    const fed = [];
    raw.forEach((t, i) => {
      if (t.startsWith('<<<')) fed.push(word(t.length > 3 ? t.slice(3) : raw[i + 1] || '').replace(OPAQUE, ''));
      else if (t.startsWith('<<')) fed.push(bodies[next++] ?? '');
    });
    for (const body of depth < 4 ? substitutions(text) : []) {
      const v = catastrophic(body, split, depth + 1);
      if (v) return v;
    }
    let w = words(raw).map((t) => t.replace(OPAQUE, ''));
    while (w.length && (/^\w+=/.test(w[0]) || WRAPPERS.has(progOf(w[0])))) {
      w = /^\w+=/.test(w[0]) ? w.slice(1) : pastWrapper(progOf(w[0]), w.slice(1)) || leadingFlags(w.slice(1));
    }
    if (!w.length) continue;
    const prog = progOf(w[0]);
    for (const body of STDIN_SHELLS.has(prog) && depth < 4 ? fed : []) {
      const v = catastrophic(body, split, depth + 1);
      if (v) return v;
    }
    const args = w.slice(1).map((a) => a.replace(/^-(?:literal)?path[=:]/i, ''));
    // cmd.exe's `/s` `/q` are switches, not the Git Bash drives `/s` `/q`.
    const root = () => args.some((a) => ROOT_TARGET_RE.test(a) && !(CMD_SWITCH_PROGS.has(prog) && /^\/[a-z]$/i.test(a)));
    let hit = false;
    if (prog === 'rm') hit = args.some((a) => RM_RECURSE_RE.test(a)) && root();
    else if (RM_PROGS.has(prog)) hit = args.some((a) => PS_CMD_RECURSE_RE.test(a)) && root();
    else if (/^mkfs(?:\.\w+)?$/.test(prog)) hit = args.some((a) => a.startsWith('/dev/'));
    else if (prog === 'dd') hit = args.some((a) => /^of=\/dev\/(?:sd|nvme|hd|disk)/.test(a));
    else if (prog === 'format') hit = args.some((a) => /^[a-z]:/i.test(a));
    else if (INDIRECT.has(prog) && depth < 4) {
      const v = catastrophic(leadingFlags(w.slice(1)).join(' '), split, depth + 1);
      if (v) return v;
    }
    if (hit) return text.trim();
  }
  return null;
}
// ---- loss twin: END
