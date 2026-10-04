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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readText, writeText, isFile, printOut } from '../lib/fs.mjs';
import { loadCatalog, catalogProblems, parseBrick } from './catalog.mjs';
import { checkGraph } from './graph.mjs';
import { parseNumstat, DEFAULT_PRESET } from './score.mjs';
import { gitRootOf, gitDirOf, currentBranch } from '../hosts/gitref.mjs';
import {
  initState, nextStep, scoreDeclared, scoreDiff, recordOutcome, decideAwaiting,
  writeLoopFile, parseLoopFile, LOOP_FILE,
} from './state.mjs';
import { recordLoop } from './registry.mjs';

const emit = (obj) => { printOut(`${JSON.stringify(obj)}\n`); return obj.error || obj.ok === false ? 1 : 0; };
const stdin = () => (process.stdin.isTTY ? '' : readFileSync(0, 'utf8'));
const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : null);

function requireRoot() {
  const root = gitRootOf(process.cwd());
  if (!root) throw new Error('not inside a git repository');
  return root;
}

/**
 * When `score --diff`/`decide` closes a unit (`commit: true`), write the commit message to
 * `<gitdir>/LOOP_COMMIT_MSG` — never tracked, never part of any diff — so the loop's own
 * automation never has to quote a message on a command line (`js/hosts/hooks.mjs`'s
 * `loopExempt` only whitelists `git commit -F <path>`).
 *
 * `gitdir` is RESOLVED BY THE CALLER, before `withState` ran the state change (X6, fix round
 * 2): a malformed `.git` FILE makes `gitDirOf` throw, and that throw must abort the action
 * before anything about the loop's state has moved, not after. Adds `message_file` to the
 * result for the skill to read back, with forward slashes (`C:/...`) even on Windows — Git
 * Bash and git itself both accept that form on every platform, and a backslash-laden path
 * breaks when a later shell command tries to use it unquoted.
 */
function writeCommitMessage(root, gitdir, result) {
  if (!result || result.commit !== true) return result;
  const branch = currentBranch(root);
  const slug = branch && branch.startsWith('loop/') ? branch.slice('loop/'.length) : 'loop';
  const file = path.join(gitdir, 'LOOP_COMMIT_MSG');
  writeText(file, `loop(${slug}): iteration ${result.iteration} — ${result.intent || 'setup'}\n\n${result.trailers}\n`);
  return { ...result, message_file: file.replaceAll('\\', '/') };
}

function withState(fn) {
  const root = requireRoot();
  const file = path.join(root, LOOP_FILE);
  if (!isFile(file)) throw new Error(`${file} does not exist — run \`geneseed loop init\` first`);
  const state = parseLoopFile(readText(file));
  const { bricks } = loadCatalog({ projectRoot: root });
  const result = fn(state, bricks);
  writeLoopFile(file, state);
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
    // The bare check doubles as the catalogue LISTING the loop skill composes a free graph
    // from — frontmatter only: a brick's body reaches the model through `next`, for the node
    // the engine chose, never as a menu.
    const problems = catalogProblems({ projectRoot: process.cwd() });
    const { bricks, templates, overridden } = loadCatalog({ projectRoot: process.cwd() });
    const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    return {
      ok: !problems.length, problems,
      templates: [...templates.keys()].sort(byName),
      bricks: [...bricks.values()].sort((a, b) => byName(a.name, b.name))
        .map(({ body, available, reason, ...b }) => ({ ...b, available, ...(reason ? { reason } : {}) })),
      overridden,
    };
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
    const state = initState({
      title: args.title, requirement: args.requirement, graph, preset: args.preset || DEFAULT_PRESET,
      contracts: list(args.contracts) ?? [],
    });
    writeLoopFile(file, state);
    // Best-effort: the registry is how the Active tab discovers this loop, but a registry
    // hiccup must never fail the init the loop itself just succeeded at.
    recordLoop({ root, branch: currentBranch(root), title: args.title });
    return { file, graph: graph.name, preset: state.preset, status: state.status };
  },
  next: () => withState((s, b) => nextStep(s, b)),
  score(args) {
    if (args.diff) {
      // X6: resolve (and validate) the gitdir BEFORE withState runs the state change, so a
      // malformed `.git` file errors without advancing the loop.
      const root = requireRoot();
      const gitdir = gitDirOf(root);
      return writeCommitMessage(root, gitdir, withState((s) => scoreDiff(s, parseNumstat(stdin()))));
    }
    if (!args.declared) throw new Error('score needs --declared or --diff');
    return withState((s) => scoreDeclared(s, {
      actions: list(args.actions), writeSet: list(args.writeSet), intent: args.intent ?? null,
    }));
  },
  record(args) {
    if (!args.outcome) throw new Error('record needs --outcome');
    if (args.note && args.noteFile) throw new Error('record takes --note or --note-file, not both');
    let note = args.note ?? '';
    if (args.noteFile) {
      // A note too long for a shell argument, or one that mentions `git … commit`/`push` (and
      // would otherwise sit inside the command line GIT_GATE_RE matches whole), goes through a
      // file instead — never through the shell at all. CRLF-folded and trimmed the same way the
      // porcelain stdin below is, so a Windows-authored file round-trips identically.
      let raw;
      try { raw = readText(path.resolve(args.noteFile)); } catch (e) {
        throw new Error(`cannot read --note-file ${args.noteFile}: ${e.message}`, { cause: e });
      }
      note = raw.replace(/\r\n/g, '\n').trimEnd();
    }
    const card = args.card ? JSON.parse(args.card) : null;
    const porcelain = stdin();
    return withState((s, b) => recordOutcome(s, b, args.outcome, {
      card, porcelain: porcelain ? porcelain.replace(/\r\n/g, '\n').trimEnd() : null, note,
    }));
  },
  decide(args) {
    // X6: same ordering as `score --diff` above.
    const root = requireRoot();
    const gitdir = gitDirOf(root);
    return writeCommitMessage(root, gitdir, withState((s, b) => decideAwaiting(s, b, args.verdict, args.note ?? '')));
  },
};

export function cmdLoop(args) {
  try {
    return emit(ACTIONS[args.action](args));
  } catch (e) {
    return emit({ error: e.message });
  }
}
