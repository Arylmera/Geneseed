/**
 * `geneseed factory <action>` — the factory engine's only face, built as `geneseed loop` is
 * (`js/loop/cli.mjs`): one JSON object per action, exit 1 on any refusal, no spawn. git and
 * `gh`/`glab` are the model's job; the porcelain reaches `record` on stdin, and a TTY stdin reads
 * as `null` ("none given"), never as a clean tree.
 *
 * FACTORY.md LIVES AT THE GIT ROOT, beside LOOP.md, for the same reason LOOP.md does: the loop
 * engine filters both out of every diff by their root-relative name (`ENGINE_FILES`). So the root
 * is found by walking up to `.git`, never taken from the caller. The same root answers R3: the
 * status in the LOOP.md there (`loopStatus`) goes to the engine, which refuses while it is neither
 * `done` nor `stopped`, holds a loop stage's outcome to it (R2: stopped is fail, done is pass), and
 * refuses `next` on a loop stage while any LOOP.md is left. A loop that ends on `$stop` leaves its
 * LOOP.md in place, so without that read R2 could never be recorded. A LOOP.md that does not parse
 * counts as running: refusing is the safe side, and `loop` itself refuses it too. Its graph name
 * (`loopTemplate`) and the HEAD commit (`headCommit`, read off disk) go along: `next` on a loop
 * stage stores the launch in FACTORY.md with the time now, so `next` writes, and `record` checks
 * the loop against it — with the loop registry's last `loop init` time for this root
 * (`loopInitAt`, a read of `loops.json`, no write), which a `pass` with no LOOP.md left needs.
 *
 * THE PORCELAIN IS TRUSTED AS PIPED. A TTY stdin is `null` and the engine refuses it after a
 * stage outside a loop (J5); an empty pipe (or a null device) reads as a clean tree, and nothing
 * here can tell it from one. The Rite writes `git status --porcelain --untracked-files=all` to a
 * temp file on its own line, then records with that file on stdin (`< file`) on a second line, so
 * a new spec reaches the engine as its own path, and no record line holds the word `git` (F1).
 *
 * `--spec` IS READ HERE, not in the state module: the engine stays pure, and the CLI is the one
 * layer that may read files. The path is stored root-relative with forward slashes, the form a
 * porcelain line carries it in, and a path outside the root is refused before it is read.
 *
 * EVERY PATH ARGUMENT RESOLVES AGAINST THE CURRENT DIRECTORY (M6): `--spec`, `--factory <file>`,
 * `--carry-file` and `--note-file`, as `geneseed loop`'s `--note-file` does and as a shell user
 * means a relative path. Only FACTORY.md itself is found at the git root. `--spec` resolved
 * against the root once, so the same relative path named two files depending on the flag.
 *
 * `--carry-file` AND `--note-file` (M7) take the text from a file, never the command line
 * (`textArg`, shared with `geneseed loop`): `GIT_GATE_RE` asks on any line that holds the word
 * `git` and, anywhere on it, the word `commit` or `push`, and free text can hold all three.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readText, isFile, printOut } from '../lib/fs.mjs';
import { gitRootOf, headCommit, currentBranch } from '../hosts/gitref.mjs';
import { loadCatalog } from '../loop/catalog.mjs';
import { LOOP_FILE, parseLoopFile } from '../loop/state.mjs';
import { loopInitAt } from '../loop/registry.mjs';
import { textArg } from '../loop/cli.mjs';
import { recordFactory } from './registry.mjs';
import { checkFactory, factoryCatalogProblems } from './graph.mjs';
import {
  FACTORY_FILE, initFactory, nextStage, recordStage, decideFactory, writeFactoryFile, parseFactoryFile,
  validateFactoryState, countSpecTasks,
} from './state.mjs';

const emit = (obj) => { printOut(`${JSON.stringify(obj)}\n`); return obj.error || obj.ok === false ? 1 : 0; };
const stdin = () => (process.stdin.isTTY ? null : readFileSync(0, 'utf8'));
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);


/** R3: the LOOP.md at `root` — its status (`running` when it does not parse) and graph name; nulls without one. */
function loopFileOf(root) {
  const file = path.join(root, LOOP_FILE);
  if (!isFile(file)) return { loopStatus: null, loopTemplate: null };
  try {
    const loop = parseLoopFile(readText(file));
    return { loopStatus: String(loop?.status ?? 'running'), loopTemplate: loop?.graph?.name ?? null };
  } catch { return { loopStatus: 'running', loopTemplate: null }; }
}

function requireRoot() {
  const root = gitRootOf(process.cwd());
  if (!root) throw new Error('not inside a git repository');
  return root;
}

/**
 * R4: an unreadable FACTORY.md throws in `parseFactoryFile` or `validateFactoryState`, before `fn`
 * runs or anything is written.
 */
function withState(fn) {
  const root = requireRoot();
  const file = path.join(root, FACTORY_FILE);
  if (!isFile(file)) throw new Error(`${file} does not exist — run \`geneseed factory init\` first`);
  const state = parseFactoryFile(readText(file));
  const catalog = loadCatalog({ projectRoot: root });
  validateFactoryState(state, catalog);
  const result = fn(state, catalog, { root, head: headCommit(root), ...loopFileOf(root) });
  writeFactoryFile(file, state);
  return result;
}

function resolveFactory(spec, catalog) {
  if (spec.endsWith('.json')) return JSON.parse(readText(path.resolve(spec)));
  const f = catalog.factories.get(spec);
  if (!f) {
    // M8: a file of that name that does not load is why, and is named; it never falls back to a lower level's factory
    const why = catalog.factoryProblems.filter((p) => p.startsWith(`factories/${spec}.json (`));
    throw new Error(`no factory named ${JSON.stringify(spec)}${why.length ? `: ${why.join('; ')}` : ''}`);
  }
  const { origin, ...factory } = f;
  return factory;
}

const ACTIONS = {
  check(args) {
    const root = gitRootOf(process.cwd()) ?? process.cwd();
    const catalog = loadCatalog({ projectRoot: root });
    if (args.factory) {
      const problems = checkFactory(resolveFactory(args.factory, catalog), catalog);
      return { ok: !problems.length, problems };
    }
    const problems = factoryCatalogProblems(catalog);
    return {
      ok: !problems.length, problems, factories: [...catalog.factories.keys()].sort(byName),
      ...(catalog.factoryOverridden.length ? { overridden: catalog.factoryOverridden } : {}),
    };
  },
  list() {
    const root = gitRootOf(process.cwd()) ?? process.cwd();
    const { factories } = loadCatalog({ projectRoot: root });
    return {
      factories: [...factories.values()].sort((a, b) => byName(a.name, b.name)).map((f) => ({
        name: f.name, description: f.description ?? '', category: f.category ?? null, origin: f.origin,
      })),
    };
  },
  init(args) {
    const root = requireRoot();
    const file = path.join(root, FACTORY_FILE);
    if (isFile(file)) throw new Error(`${file} already exists — a factory is already running here`);
    if (!args.title || !args.requirement || !args.factory) throw new Error('init needs --title, --requirement and --factory');
    const catalog = loadCatalog({ projectRoot: root });
    const factory = resolveFactory(args.factory, catalog);
    const problems = checkFactory(factory, catalog);
    if (problems.length) return { error: 'the factory does not pass factory check', problems };
    const state = initFactory({ title: args.title, requirement: args.requirement, factory, input: args.input ?? null });
    writeFactoryFile(file, state);
    // Best-effort, as `loop init`'s `recordLoop`: the registry is how the console finds the run.
    recordFactory({ root, branch: currentBranch(root), factory: factory.name, title: args.title });
    return { file, factory: factory.name, stage: state.stage, status: state.status };
  },
  next: () => withState((s, c, { loopStatus, head }) => nextStage(s, c, { loopStatus, head, now: new Date().toISOString() })),
  record(args) {
    if (!args.outcome) throw new Error('record needs --outcome');
    const carry = textArg(args, 'carry', 'carry', 'record');
    const porcelain = stdin();
    return withState((s, c, { root, loopStatus, loopTemplate, head }) => {
      let specPath = null; let taskCount = null;
      if (args.spec) {
        const abs = path.resolve(args.spec);
        const rel = path.relative(root, abs);
        if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`--spec ${args.spec} is outside the worktree`);
        let text;
        try { text = readText(abs); } catch (e) { throw new Error(`cannot read --spec ${args.spec}: ${e.message}`, { cause: e }); }
        specPath = rel.replaceAll('\\', '/');
        taskCount = countSpecTasks(text);
      }
      return recordStage(s, c, args.outcome, {
        porcelain: porcelain === null ? null : porcelain.replace(/\r\n/g, '\n').trimEnd(),
        specPath, taskCount, carry, loopStatus, loopTemplate, head,
        loopInitAt: loopInitAt(root),
      });
    });
  },
  decide(args) {
    const note = textArg(args, 'note', 'note', 'decide') ?? '';
    return withState((s, c) => decideFactory(s, c, args.verdict, note));
  },
};

export function cmdFactory(args) {
  try {
    return emit(ACTIONS[args.action](args));
  } catch (e) {
    return emit({ error: e.message });
  }
}
