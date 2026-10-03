/**
 * `geneseed loop <action>` — the loop engine's only face. Every action prints exactly one JSON
 * object: the loop skill is a model reading stdout, and a JSON error it can quote beats a
 * stack trace it has to interpret. Exit 1 on any refusal so a script can still branch on it.
 *
 * NO SPAWN. The CLI's closure may not start processes, so git is the model's job: it pipes
 * `git diff --cached --numstat` into `score --diff` and `git status --porcelain` into `record`.
 * stdin is read only when it is not a TTY — a hand-run `geneseed loop record` must not hang.
 *
 * NO `--file`. `state.mjs`'s `LOOP_FILE` constant is the ROOT-RELATIVE path the engine filters
 * out of every diff and porcelain check, so LOOP.md has to live at the git root of the worktree
 * for that filter to mean anything. This entry finds that root itself — walking up from the cwd
 * to the first directory holding `.git` (a directory for a normal clone, a FILE for a worktree
 * or submodule) — rather than taking a path the caller could point anywhere.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { readText, writeText, isFile, printOut } from '../lib/fs.mjs';
import { loadCatalog, catalogProblems, parseBrick } from './catalog.mjs';
import { checkGraph } from './graph.mjs';
import { parseNumstat, DEFAULT_PRESET } from './score.mjs';
import { currentBranch } from '../hosts/hooks.mjs';
import {
  initState, nextStep, scoreDeclared, scoreDiff, recordOutcome, decideAwaiting,
  renderLoopFile, parseLoopFile, LOOP_FILE,
} from './state.mjs';

const emit = (obj) => { printOut(`${JSON.stringify(obj)}\n`); return obj.error || obj.ok === false ? 1 : 0; };
const stdin = () => (process.stdin.isTTY ? '' : readFileSync(0, 'utf8'));
const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : null);

function gitRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function requireRoot() {
  const root = gitRoot(process.cwd());
  if (!root) throw new Error('not inside a git repository');
  return root;
}

/**
 * The `.git` DIRECTORY for `root` — itself, or the gitdir a worktree's `.git` FILE names.
 * Same resolution as `js/hosts/hooks.mjs`'s `currentBranch` (gitdir half): LOOP_COMMIT_MSG has
 * to live where the loop's own worktree keeps its git state, never in a shared main repo's.
 */
function gitDirOf(root) {
  const dotgit = path.join(root, '.git');
  if (statSync(dotgit).isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'));
    if (!m) throw new Error(`${dotgit} does not name a gitdir`);
    return path.resolve(root, m[1]);
  }
  return dotgit;
}

/**
 * When `score --diff`/`decide` closes a unit (`commit: true`), write the commit message to
 * `<gitdir>/LOOP_COMMIT_MSG` — never tracked, never part of any diff — so the loop's own
 * automation never has to quote a message on a command line (`js/hosts/hooks.mjs`'s
 * `loopExempt` only whitelists `git commit -F <path>`). Adds `message_file` to the result for
 * the skill to read back.
 */
function writeCommitMessage(root, result) {
  if (!result || result.commit !== true) return result;
  const branch = currentBranch(root);
  const slug = branch && branch.startsWith('loop/') ? branch.slice('loop/'.length) : 'loop';
  const file = path.join(gitDirOf(root), 'LOOP_COMMIT_MSG');
  writeText(file, `loop(${slug}): iteration ${result.iteration} — ${result.intent || 'setup'}\n\n${result.trailers}\n`);
  return { ...result, message_file: file };
}

function withState(fn) {
  const root = requireRoot();
  const file = path.join(root, LOOP_FILE);
  if (!isFile(file)) throw new Error(`${file} does not exist — run \`geneseed loop init\` first`);
  const state = parseLoopFile(readText(file));
  const { bricks } = loadCatalog({ projectRoot: root });
  const result = fn(state, bricks);
  writeText(file, renderLoopFile(state));
  return result;
}

function resolveGraph(spec, catalog) {
  if (spec && spec.endsWith('.json')) return JSON.parse(readText(path.resolve(spec)));
  const g = catalog.templates.get(spec);
  if (!g) throw new Error(`no loop template named ${JSON.stringify(spec)}`);
  const { origin, ...graph } = g;
  return graph;
}

const ACTIONS = {
  check(args) {
    if (args.brick) {
      const { problems } = parseBrick(readText(path.resolve(args.brick)), 'checked');
      return { ok: !problems.length, problems };
    }
    if (args.graph) {
      const catalog = loadCatalog({ projectRoot: process.cwd() });
      const problems = checkGraph(resolveGraph(args.graph, catalog), catalog.bricks);
      return { ok: !problems.length, problems };
    }
    const problems = catalogProblems({ projectRoot: process.cwd() });
    return { ok: !problems.length, problems };
  },
  init(args) {
    const root = requireRoot();
    const file = path.join(root, LOOP_FILE);
    if (isFile(file)) throw new Error(`${file} already exists — a loop is already running here`);
    if (!args.title || !args.requirement || !args.graph) throw new Error('init needs --title, --requirement and --graph');
    const catalog = loadCatalog({ projectRoot: root });
    const graph = resolveGraph(args.graph, catalog);
    const problems = checkGraph(graph, catalog.bricks);
    if (problems.length) return { error: 'the graph does not pass loop check', problems };
    const state = initState({ title: args.title, requirement: args.requirement, graph, preset: args.preset || DEFAULT_PRESET });
    writeText(file, renderLoopFile(state));
    return { file, graph: graph.name, preset: state.preset, status: state.status };
  },
  next: () => withState((s, b) => nextStep(s, b)),
  score(args) {
    if (args.diff) return writeCommitMessage(requireRoot(), withState((s) => scoreDiff(s, parseNumstat(stdin()))));
    if (!args.declared) throw new Error('score needs --declared or --diff');
    return withState((s) => scoreDeclared(s, {
      actions: list(args.actions), writeSet: list(args.writeSet), intent: args.intent ?? null,
    }));
  },
  record(args) {
    if (!args.outcome) throw new Error('record needs --outcome');
    const card = args.card ? JSON.parse(args.card) : null;
    const raw = stdin();
    return withState((s, b) => recordOutcome(s, b, args.outcome, { card, porcelain: raw ? raw.replace(/\r\n/g, '\n').trimEnd() : null }));
  },
  decide(args) {
    return writeCommitMessage(requireRoot(), withState((s, b) => decideAwaiting(s, b, args.verdict, args.note ?? '')));
  },
};

export function cmdLoop(args) {
  try {
    return emit(ACTIONS[args.action](args));
  } catch (e) {
    return emit({ error: e.message });
  }
}
