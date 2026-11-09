/**
 * The factory engine: a state machine over a factory graph (`js/factory/graph.mjs`), persisted as
 * a JSON block in FACTORY.md — the loop engine's model (`js/loop/state.mjs`) one level up.
 *
 * ONE STATE FILE PER LEVEL (D5). FACTORY.md sits beside LOOP.md in the same worktree; a `loop:`
 * stage is a whole child loop with its own LOOP.md, and this engine never reads or writes inside
 * it. The child engine is unchanged: it only learned to treat FACTORY.md as bookkeeping
 * (`ENGINE_FILES`) and to start from the factory's `carry` (`initState`'s `notes`, D16).
 *
 * WHY THE MODEL NEVER DECIDES. As in the loop engine, every transition, counter and stop is
 * computed here; the `factory` Rite runs the stage it is handed and reports the outcome.
 *
 * WHICH CYCLE A BACK-ROUTE SPENDS. Cycles are declared as node sets (J6). An edge spends the
 * smallest cycle whose FIRST stage is the edge's target and which also holds its source — the loop
 * engine's `repairRing` convention, so `{ nodes: ["loop:bugfix", "pr-open", "merge-gate"] }` is
 * spent by `merge-gate --fail--> loop:bugfix`, once per lap. `checkFactory` refuses a graph where
 * that convention would miscount: a cycle entered anywhere but its first stage, or a lap that
 * crosses no spending edge (a route back into the middle of a cycle).
 *
 * NO SCORING, AND A CLEAN TREE. Risk is the loop engine's job (J5). A stage outside a loop records
 * only on a clean worktree — a mutate brick such as a `docs-update` lane (D12) commits its change
 * first — so `recordStage` refuses a dirty porcelain after one — engine files and
 * the run's spec at `specs/<slug>/spec.md` excepted (the one being recorded, else the one on
 * record: it is uncommitted until the gate approves it, and the Rite commits it then, before the
 * first loop, whose first read brick would stop on it otherwise) — instead of carrying
 * uncommitted work into the next loop. The porcelain must be
 * `git status --porcelain --untracked-files=all`: plain `--porcelain` folds a new directory into `?? specs/`, which no exemption can match.
 * A path git C-quotes (a non-ASCII slug, under the default core.quotePath) is unquoted first (M11). No porcelain
 * at all (`null`, a TTY stdin) is refused too: it proves nothing. The limit: an empty pipe reads
 * as a clean tree, so the engine trusts whoever pipes it.
 *
 * A LOOP STAGE REPORTS WHAT ITS LOOP DID (R2). `next` on a loop stage stores the launch
 * (`launched`: the stage, its template, the HEAD commit and the time then). `record` on it then
 * needs evidence. With a LOOP.md left, the evidence is that file: its template must be the stage's,
 * and its status must match the outcome (stopped is fail, done is pass). With no LOOP.md left, HEAD
 * must have moved since the launch (the loop's close commit, or the commit that removed a stopped
 * loop's LOOP.md), and `fail` needs nothing more. `pass` also needs the loop registry
 * (`js/loop/registry.mjs`): its row for this worktree must carry an `initAt` later than the launch,
 * so a `geneseed loop init` ran here after `next`, and with no LOOP.md left that loop has ended.
 * What this does NOT prove: that the ended loop closed rather than stopped (the registry keeps no
 * status), or that it ran the stage's template. A stopped loop whose LOOP.md was removed by hand
 * can still pass. The registry row's `started` cannot serve: it is set once per worktree, so a
 * re-entered loop would never pass.
 *
 * R4 COVERS WHAT A HAND CAN EDIT. FACTORY.md is a file; `validateFactoryState` refuses counters
 * that are not non-negative integers, a ceiling above 1200, a task block out of its bounds, a gate
 * amend count above 3, a `lane` no fork of the factory leads to, a status the engine does not
 * write, a `stage`, `tasks.stage`, `launched.stage` or `awaiting` gate the graph does not hold,
 * an `awaiting` that disagrees with `status`, a `history` or `factory.cycles` that is not a list, and a factory that no longer passes
 * `checkFactory` — the termination argument below holds only for a state this engine could have
 * written.
 *
 * LANES (D11, D13). A fork is a brick stage with named outcomes (`isFork`, `js/factory/graph.mjs`).
 * `next` hands it `lanes` (each outcome with the stage it leads to), and `record` on it stores the
 * stage its outcome's edge reaches as `lane`. An edge to `$lane` resolves to that stage, and spends
 * the cycle `spentCycle` names for the literal `$lane` target, the rule `checkFactory` proves the
 * graph against. A route to `$lane` with no lane on record (a state `check` cannot produce) is
 * refused before the state changes, on `record` and on a gate's `ok` alike: never guessed.
 *
 * TASKS (D9). A stage that writes a spec records its path and task count (`tasks`). The first
 * `loop:` stage recorded after it owns the tasks (`tasks.stage`) and alone is replayed once per
 * task, `index` 1 to `count`; a fix loop that runs in between follows its own edges. A task the
 * run reaches for the FIRST time starts with fresh cycle counters and a fresh per-task ceiling
 * (J6); `taskHigh` is the highest index reached, so a spec re-recorded after a route back (index
 * back to 1) gives no task a second fresh budget. A route back into the owner after its last task
 * (J7: red CI at `merge-gate`) is ONE EXTRA TASK: `next` marks it `extra`, read off `history`
 * alone, and it reaches no task never reached, so it spends the route's cycle and both ceilings
 * like any lap and resets nothing.
 *
 * TERMINATION BY CONSTRUCTION (J3, R8). `transitions` counts per task and resets with it. On top,
 * `runTransitions` counts every transition of the run, never resets, and stops the run past
 * `runCeiling`: `FACTORY_MAX_TRANSITIONS` until a spec is recorded, then
 * `FACTORY_MAX_TRANSITIONS` x its task count. Until the first loop launches, each --spec record
 * sets the count and the ceiling again: the spec's gate comes after its record, and an amend there
 * may add tasks (G3). That window spends no fresh budget — no task has been reached, so the
 * per-task count never resets in it — and the gate's amend cap bounds it. Once a loop has
 * launched (`launched`, or a `loop:` stage in `history`, which never shrinks) the count is frozen:
 * a later --spec record may keep or lower it, never raise it, so no lap can buy a task, a fresh
 * budget or a higher ceiling. And it is capped at `FACTORY_MAX_TASKS` (20), so the
 * ceiling is at most 1200 transitions: past twenty tasks a requirement is a project, to be split
 * into several factory runs a human can review, not one run nobody reads to the end.
 */
import { writeText } from '../lib/fs.mjs';
import { renameWithRetry, filterPorcelain } from '../loop/state.mjs';
import { loopOf, stageOutcomes, checkFactory, LANE, isFork, lanesOf, laneTargets, spentCycle, edgeFor } from './graph.mjs';

const BEGIN = '<!-- factory-state:begin -->';
const END = '<!-- factory-state:end -->';
export const FACTORY_FILE = 'FACTORY.md';
// 60, not 30: `checks` and `review-panel` add two stages, and a lap back through both, to every factory (D15).
export const FACTORY_MAX_TRANSITIONS = 60;
export const FACTORY_MAX_TASKS = 20;
const GATE_MAX_AMENDS = 3;
const STATUSES = ['running', 'awaiting', 'done', 'stopped'];
const PORCELAIN = 'git status --porcelain --untracked-files=all';
const slash = (p) => String(p).replaceAll('\\', '/');

export function renderFactoryFile(state) {
  return `# Factory — ${state.title}\n\n${state.requirement}\n\n`
    + 'The block below belongs to the engine: `geneseed factory` rewrites it on every action.\n\n'
    + `${BEGIN}\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n${END}\n`;
}

/** R4: anything that is not a well-formed block throws, so every action refuses and none repairs. */
export function parseFactoryFile(text) {
  const t = String(text).replace(/\r\n/g, '\n');
  const a = t.indexOf(BEGIN); const b = t.lastIndexOf(END);
  if (a < 0 || b < a) throw new Error('FACTORY.md has no factory-state block');
  const inner = t.slice(a + BEGIN.length, b).replace(/^\s*```json\s*/, '').replace(/\s*```\s*$/, '');
  let state;
  try { state = JSON.parse(inner); } catch (e) {
    throw new Error(`FACTORY.md is unreadable: ${e.message}`, { cause: e });
  }
  if (state?.v !== 1) throw new Error('FACTORY.md is unreadable: no state of version 1');
  return state;
}

const count = (v) => Number.isInteger(v) && v >= 0;
const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * R4, past the JSON: a state this engine could have written, and a factory that still passes
 * `checkFactory` against today's catalogue. Throws "FACTORY.md is unreadable: ..." like the parse.
 */
export function validateFactoryState(state, catalog) {
  const bad = (what) => { throw new Error(`FACTORY.md is unreadable: ${what}`); };
  for (const k of ['transitions', 'runTransitions', 'runCeiling', 'taskHigh']) {
    if (!count(state[k])) bad(`${k} must be a non-negative integer`);
  }
  if (state.runCeiling > FACTORY_MAX_TRANSITIONS * FACTORY_MAX_TASKS) {
    bad(`runCeiling must be ${FACTORY_MAX_TRANSITIONS * FACTORY_MAX_TASKS} at most`);
  }
  if (!plainObject(state.counters) || !Object.values(state.counters).every(count)) {
    bad('counters must map each cycle to a non-negative integer');
  }
  const { taskCount, tasks, launched } = state;
  if (taskCount !== null && !(Number.isInteger(taskCount) && taskCount >= 1 && taskCount <= FACTORY_MAX_TASKS)) {
    bad(`taskCount must be null or an integer from 1 to ${FACTORY_MAX_TASKS}`);
  }
  if (tasks !== null && !(plainObject(tasks) && SPEC_PATH.test(tasks.path) && Number.isInteger(tasks.count)
    && tasks.count >= 1 && tasks.count <= (taskCount ?? 0) && Number.isInteger(tasks.index) && tasks.index >= 1
    && tasks.index <= tasks.count && (tasks.stage === null || typeof tasks.stage === 'string'))) {
    bad('tasks must be null or a spec path with 1 <= index <= count <= taskCount');
  }
  if (launched != null && !(plainObject(launched) && typeof launched.stage === 'string'
    && typeof launched.template === 'string' && (launched.head === null || typeof launched.head === 'string')
    && (launched.at == null || typeof launched.at === 'string'))) {
    bad('launched must be null or a stage, a template, a head and a time');
  }
  if (!STATUSES.includes(state.status)) bad(`status must be one of ${STATUSES.join(', ')}`);
  if (!Array.isArray(state.history)) bad('history must be a list');
  if (!plainObject(state.gateAmends) || !Object.values(state.gateAmends).every((n) => count(n) && n <= GATE_MAX_AMENDS)) {
    bad(`gateAmends must map each gate to an integer from 0 to ${GATE_MAX_AMENDS}`);
  }
  // `cycles` may be absent (`transition` reads it `?? []`), never another shape: `checkFactory`
  // reads a non-list as no cycles, and `transition` would then throw iterating it.
  if (plainObject(state.factory) && state.factory.cycles !== undefined && !Array.isArray(state.factory.cycles)) {
    bad('factory.cycles must be a list');
  }
  const problems = checkFactory(state.factory, catalog);
  if (problems.length) bad(`its factory no longer passes factory check: ${problems.join('; ')}`);
  // M5: every stage the state names is one of the graph's, so no action meets a stage it cannot run
  const stages = new Set(state.factory.stages);
  if (!(stages.has(state.stage) || (state.stage === '$close' && state.status === 'done'))) {
    bad('stage must be a stage of the factory');
  }
  if (tasks?.stage != null && !(stages.has(tasks.stage) && loopOf(tasks.stage) !== null)) {
    bad('tasks.stage must be null or a loop stage of the factory');
  }
  if (launched != null && !(stages.has(launched.stage) && loopOf(launched.stage) === launched.template)) {
    bad('launched.stage must be a loop stage of the factory, and launched.template its loop');
  }
  const { awaiting } = state;
  if ((state.status === 'awaiting') !== (awaiting != null)) bad('awaiting must be set when, and only when, status is awaiting');
  if (awaiting != null && !(plainObject(awaiting) && awaiting.kind === 'gate' && stages.has(awaiting.stage)
    && (stageOutcomes(awaiting.stage, catalog.bricks) ?? []).includes(awaiting.outcome))) {
    bad('awaiting must be a gate at a stage of the factory, with one of its outcomes');
  }
  // absent in a state written before lanes existed: that reads as none on record
  if (state.lane != null && !laneTargets(state.factory, catalog.bricks).has(state.lane)) {
    bad('lane must be null or a stage a fork of the factory leads to');
  }
}

/** `<file>.tmp` then `renameWithRetry`, as `writeLoopFile`: a killed write never tears FACTORY.md. */
export function writeFactoryFile(file, state) {
  const tmp = `${file}.tmp`;
  writeText(tmp, renderFactoryFile(state));
  renameWithRetry(tmp, file);
}

/**
 * The tasks of a spec (`specs/<slug>/spec.md`, the `spec` brick's format): the numbered items
 * (`1.` or `1)`, indented 3 spaces at most) under the first heading that names tasks, up to the
 * next heading of the same or a higher level. A numbered line is a sub-item, as CommonMark nests
 * it, only when its indent reaches the content offset of the task before it (that task's indent,
 * its marker, one space): `1. a` / ` 2. b` and `9. a` / `10. b` / `   11. c` are siblings,
 * `1. a` / `   1. b` nest. Headings are ATX (`#`,
 * indented 3 spaces at most) and setext (a paragraph line underlined with `=` or `-`; under a
 * list item's own text that line is a thematic break, not a heading). A fenced block (``` or ~~~,
 * closed by the same fence) is skipped whole; a backtick fence whose info string holds a backtick
 * is no fence, as in CommonMark.
 * shortcut: a line scanner, not a CommonMark parser (no block quotes, no HTML blocks, no tabs as
 * indentation); a spec written as the `spec` brick says is inside what it reads right.
 */
export function countSpecTasks(text) {
  let level = 0; let count = 0; let offset = -1; let fence = null;
  let para = false; let inItem = false;   // the line before is a paragraph line / a list item's text
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      continue;
    }
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) { fence = f[1]; para = false; continue; }
    if (!line.trim()) { para = false; inItem = false; continue; }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
    const setext = para && /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    const h = atx ? [atx[1].length, atx[2] ?? ''] : setext ? [setext[1][0] === '=' ? 1 : 2, para] : null;
    if (h) {
      if (level && h[0] <= level) break;
      if (!level && /\btasks?\b/i.test(h[1])) level = h[0];
      para = false; inItem = false; continue;
    }
    const item = /^( {0,3})(\d{1,9}[.)])[ \t]+\S/.exec(line);
    if (item || /^ {0,3}[-*+][ \t]+\S/.test(line)) { para = false; inItem = true; } else { para = inItem ? false : line; }
    if (!item || !level) continue;
    if (offset >= 0 && item[1].length >= offset) continue;   // inside the last task's content: a sub-item
    count += 1; offset = item[1].length + item[2].length + 1;
  }
  return count;
}

export function initFactory({ title, requirement, factory, input = null }) {
  return {
    v: 1, title, requirement, input, factory, stage: factory.start,
    status: 'running', awaiting: null, reason: null,
    counters: {}, transitions: 0, runTransitions: 0, runCeiling: FACTORY_MAX_TRANSITIONS, taskHigh: 0, taskCount: null,
    lane: null, tasks: null, carry: null, launched: null,
    history: [], gateAmends: {},
  };
}

const taskNo = (state) => state.tasks?.index ?? 0;
// G3: the task count is frozen once any loop has launched (docblock: TERMINATION BY CONSTRUCTION).
const tasksFrozen = (state) => state.launched != null || state.history.some((h) => loopOf(h?.stage) !== null);
// The task as `next` and a replay hand it out: the owning stage is the engine's bookkeeping.
const taskOut = ({ stage: _owner, ...task }) => task;

function stop(state, reason) {
  state.status = 'stopped'; state.reason = reason;
  return { stopped: reason };
}

const summary = (state) => ({ transitions: state.transitions, history: state.history });

function assertRunning(state) {
  if (state.status !== 'running') throw new Error(`the factory is ${state.status}, not running`);
}

// R3: the child loop owns the worktree while its LOOP.md says neither `done` nor `stopped`.
// `loopStatus` is that status as the CLI read it, null when there is no LOOP.md; a LOOP.md that
// does not parse reaches here as running.
const ENDED = ['done', 'stopped'];
function assertNoLoop(loopStatus) {
  if (loopStatus !== null && !ENDED.includes(loopStatus)) {
    throw new Error('a loop is still running in this worktree (LOOP.md exists): finish it with '
      + '`geneseed loop next` and its final commit before the factory moves on');
  }
}

// What every stage receives from the factory itself: its `rules`, and the `protected` paths `checks` refuses to see changed.
const rulesOf = ({ factory }) => ({
  ...(factory.rules?.length ? { rules: factory.rules } : {}),
  ...(factory.protected?.length ? { protected: factory.protected } : {}),
});

/**
 * `loopStatus`: the status in the LOOP.md at the worktree root, or null (the CLI looks; this stays
 * pure). A loop stage refuses ANY LOOP.md: `loop init` refuses to overwrite one, and a stopped
 * loop leaves its own behind, tracked, so the error names the removal. On a loop stage it stores
 * the launch with `head` (the HEAD commit, null when unreadable) and `at` (`now`, an ISO time the
 * CLI passes; null leaves `pass` with no LOOP.md unprovable) — once per stage visit, so a second
 * `next` after the loop committed does not move the baseline `record` compares with.
 */
export function nextStage(state, { bricks }, { loopStatus = null, head = null, now = null } = {}) {
  if (state.status === 'awaiting') return { awaiting: state.awaiting };
  if (state.status === 'done') return { terminal: '$close', summary: summary(state) };
  if (state.status === 'stopped') return { terminal: '$stop', reason: state.reason, summary: summary(state) };
  assertNoLoop(loopStatus);
  const { stage } = state;
  const loop = loopOf(stage);
  if (loop !== null) {
    if (loopStatus !== null) {
      throw new Error('the previous loop left its LOOP.md at the worktree root: run `git rm -f LOOP.md` and commit '
        + `that removal before \`geneseed loop init\` starts ${stage}`);
    }
    const owned = state.tasks && (state.tasks.stage === null || state.tasks.stage === stage);
    if (state.launched?.stage !== stage) state.launched = { stage, template: loop, head, at: now };
    // J7: the owner, recorded since the spec, entered by an edge rather than its own replay, has
    // passed its last task: this visit is one extra task, to fix what the stage before reported.
    const last = state.history.at(-1);
    const extra = owned && state.tasks.stage === stage && state.tasks.index === state.tasks.count && last?.stage !== stage
      ? { extra: `${last.stage} reported ${last.outcome ?? last.verdict}` } : {};
    return {
      stage, loop, notes: state.carry ? [state.carry] : [],
      ...(owned ? { task: { ...taskOut(state.tasks), ...extra } } : {}), ...rulesOf(state),
    };
  }
  const brick = bricks.get(stage);
  if (!brick) throw new Error(`no brick named ${stage} in the catalogue`);
  return {
    stage, effect: brick.effect, agent: brick.agent, skill: brick.skill, outcomes: brick.outcomes,
    prompt: brick.body, requirement: state.requirement, input: state.input, carry: state.carry,
    // D11: a fork picks from its own edges; the factory is their one writer, so the stage reads them here
    ...(isFork(stage, bricks) ? { lanes: lanesOf(state.factory, stage) } : {}),
    ...rulesOf(state),
  };
}

// J5: the porcelain after a stage outside a loop, minus engine files and the run's spec — at the
// `spec` brick's own path only (one slug segment, never `.` or `..`).
const SPEC_PATH = /^specs\/(?!\.\.?\/)[^/]+\/spec\.md$/;
// R2: a loop init strictly after the launch; an absent or unparsable time on either side proves nothing.
const initedSince = (initAt, launchAt) => {
  const a = Date.parse(initAt ?? ''); const b = Date.parse(launchAt ?? '');
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
};
function dirtyLines(porcelain, specPath) {
  const exempt = specPath !== null && SPEC_PATH.test(specPath) ? specPath : null;
  return filterPorcelain(porcelain).split('\n').filter((l) => l && slash(unquotePath(l.slice(3))) !== exempt);
}

// M11: git C-quotes a path with a byte it will not print as is (core.quotePath, on by default):
// `"specs/caf\303\251/spec.md"` is `specs/café/spec.md`. Octal escapes are UTF-8 bytes.
const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
export function unquotePath(p) {
  if (!(p.length >= 2 && p.startsWith('"') && p.endsWith('"'))) return p;
  const bytes = [];
  for (let i = 1; i < p.length - 1; i += 1) {
    const c = p[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const oct = /^[0-7]{3}/.exec(p.slice(i + 1));
    if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; continue; }
    const n = C_ESCAPES[p[i + 1]];
    bytes.push(n ?? 92); if (n !== undefined) i += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Record the current stage's outcome and follow its edge. On a fork, the stage the outcome's edge
 * reaches becomes the run's `lane`. `specPath`
 * with `taskCount` (a stage that wrote a spec), `carry` (the reason the next stage — above all a
 * re-entered loop — must hear). `loopTemplate` is the graph name in the LOOP.md the CLI read,
 * `head` the HEAD commit now, `loopInitAt` the registry row's last `loop init` time for this
 * worktree, or null (R2). Every refusal throws before the state changes.
 */
export function recordStage(state, { bricks }, outcome, {
  porcelain = null, specPath = null, taskCount = null, carry = null, loopStatus = null,
  loopTemplate = null, head = null, loopInitAt = null,
} = {}) {
  assertRunning(state);
  assertNoLoop(loopStatus);
  const from = state.stage;
  const outcomes = stageOutcomes(from, bricks);
  if (!outcomes) throw new Error(`no brick named ${from} in the catalogue`);
  if (!outcomes.includes(outcome)) {
    throw new Error(`${from} cannot report ${JSON.stringify(outcome)} — one of ${outcomes.join(', ')}`);
  }
  const isLoop = loopOf(from) !== null;
  if (specPath !== null && isLoop) throw new Error('--spec is recorded by a stage outside a loop');
  // R4 holds `tasks.path` to SPEC_PATH: stored, any other path would make every later action refuse FACTORY.md.
  if (specPath !== null && !SPEC_PATH.test(specPath)) {
    throw new Error(`--spec ${specPath} is not a spec the engine can keep: record a file named spec.md one folder under specs/ (specs/<slug>/spec.md; the folder may have any name but . or ..)`);
  }
  if (isLoop) {
    // R2: the loop's evidence — its own LOOP.md, or the commit it closed with (docblock above).
    const launch = state.launched;
    if (launch?.stage !== from) throw new Error(`${from} was never launched: run \`geneseed factory next\` before its loop, then record`);
    const said = { stopped: 'fail', done: 'pass' }[loopStatus];
    if (said) {
      if (loopTemplate !== launch.template) {
        throw new Error(`the LOOP.md at the worktree root ran ${loopTemplate ?? 'an unnamed graph'}, not ${launch.template}: it is not ${from}'s loop`);
      }
      if (outcome !== said) {
        throw new Error(`${from} cannot report ${outcome}: its LOOP.md says the loop ${loopStatus === 'done' ? 'is done' : 'stopped'} — report ${said}`);
      }
    } else if (head === null || head === launch.head) {
      // shortcut: "moved" is "differs", not "descends from"; an fs-only reader cannot walk ancestry.
      throw new Error(`${from} cannot report ${outcome}: no LOOP.md is left and HEAD has not moved since \`factory next\` — `
        + 'record after the loop\'s close commit, or after the commit that removes a stopped loop\'s LOOP.md');
    } else if (outcome === 'pass' && !initedSince(loopInitAt, launch.at)) {
      throw new Error(`${from} cannot report pass on a HEAD move alone: no LOOP.md is left, and the loop registry `
        + 'records no `geneseed loop init` in this worktree since `factory next` — report fail, or record pass '
        + 'while the done LOOP.md is still at the root');
    }
  } else {
    if (porcelain === null) {
      throw new Error(`${from} is a stage outside a loop: pipe \`${PORCELAIN}\` into record, so the engine can see the tree is clean`);
    }
    const dirty = dirtyLines(porcelain, specPath ?? state.tasks?.path ?? null);
    if (dirty.length) {
      const folded = dirty.some((l) => /\/"?$/.test(l))
        ? ` — a path ending in / is a whole untracked directory: pipe \`${PORCELAIN}\`, which lists each file` : '';
      throw new Error(`${from} left the worktree dirty, and a stage outside a loop records only on a clean tree, so a brick `
        + `that changes files commits them first: ${dirty.join('; ')}${folded}`);
    }
  }
  const edge = edgeFor(state.factory, from, outcome);
  if (specPath !== null) {
    if (!Number.isInteger(taskCount) || taskCount < 1) throw new Error(`${specPath} has no ordered task list under a Tasks heading`);
    if (taskCount > FACTORY_MAX_TASKS) {
      throw new Error(`${specPath} lists ${taskCount} tasks; a factory runs ${FACTORY_MAX_TASKS} at most — split the requirement`);
    }
    if (state.taskCount !== null && tasksFrozen(state) && taskCount > state.taskCount) {
      throw new Error(`${specPath} lists ${taskCount} tasks, more than the ${state.taskCount} frozen when the first loop launched`);
    }
  }
  if (!edge) throw new Error(`no edge from ${from} on ${outcome}`);
  assertLane(state, edge);

  // M10: every fork record sets the lane, a terminal outcome to none: a gated fork re-run on an
  // amend must not keep the lane its first answer chose.
  if (isFork(from, bricks)) state.lane = state.factory.stages.includes(edge.to) ? edge.to : null;
  if (isLoop) state.launched = null;
  if (specPath !== null) {
    if (state.taskCount === null || !tasksFrozen(state)) { state.taskCount = taskCount; state.runCeiling = FACTORY_MAX_TRANSITIONS * taskCount; }
    state.tasks = { path: specPath, count: taskCount, index: 1, stage: null };
    state.taskHigh = Math.max(state.taskHigh, 1);
  }
  if (isLoop && state.tasks && state.tasks.stage === null) state.tasks.stage = from;
  state.carry = carry || null;
  state.history.push({
    stage: from, outcome, task: taskNo(state), ...(carry ? { carry } : {}),
  });
  const brick = isLoop ? null : bricks.get(from);
  if (brick?.gate === 'human' && (!brick.gateOn || brick.gateOn.includes(outcome))) {
    state.status = 'awaiting';
    state.awaiting = { kind: 'gate', stage: from, outcome, ...(carry ? { note: carry } : {}) };
    return { awaiting: state.awaiting };
  }
  // D9: a passed task replays the same loop stage for the next one; only a task never reached
  // before gets fresh budgets (J6), so a re-recorded spec cannot reset its way into a lap forever.
  if (isLoop && outcome === 'pass' && state.tasks?.stage === from && state.tasks.index < state.tasks.count) {
    state.tasks.index += 1; state.carry = null;
    if (state.tasks.index > state.taskHigh) {
      state.taskHigh = state.tasks.index; state.counters = {}; state.transitions = 0;
    }
    return { stage: from, task: taskOut(state.tasks) };
  }
  return transition(state, from, edge, bricks);
}

// D13: an edge to `$lane` needs a lane on record; checked before any state changes.
function assertLane(state, edge) {
  if (edge.to === LANE && state.lane == null) {
    throw new Error(`${edge.from} routes to ${LANE}, but no fork has chosen a lane in this run`);
  }
}

function transition(state, from, edge, bricks) {
  if (edge.to === '$stop') return stop(state, `${from} reported ${edge.on}`);
  if (edge.to === '$close') { state.status = 'done'; state.stage = '$close'; return { done: true }; }
  state.transitions += 1; state.runTransitions += 1;
  if (state.transitions > FACTORY_MAX_TRANSITIONS) return stop(state, `transition ceiling of ${FACTORY_MAX_TRANSITIONS} reached`);
  if (state.runTransitions > state.runCeiling) {
    return stop(state, `run-wide transition ceiling of ${state.runCeiling} reached (${FACTORY_MAX_TRANSITIONS} per task)`);
  }
  const cycle = spentCycle(state.factory.cycles ?? [], from, edge.to, laneTargets(state.factory, bricks));
  if (cycle) {
    state.counters[cycle.name] = (state.counters[cycle.name] ?? 0) + 1;
    if (state.counters[cycle.name] > cycle.max) return stop(state, `cycle ${cycle.name} exhausted its max of ${cycle.max}`);
  }
  const to = edge.to === LANE ? state.lane : edge.to;
  state.stage = to;
  return { stage: to };
}

/**
 * The answer to a held `gate: human` stage (D14: the loop engine's gate and verdicts, reused).
 * `ok` follows the held edge; `no` stops; `amend` re-runs the stage with the note as its `carry`,
 * `GATE_MAX_AMENDS` times per stage per task.
 */
export function decideFactory(state, { bricks }, verdict, note = '') {
  if (state.status !== 'awaiting') throw new Error('nothing is awaiting a decision');
  if (!['ok', 'no', 'amend'].includes(verdict)) throw new Error(`verdict must be ok, no or amend, not ${JSON.stringify(verdict)}`);
  const { stage, outcome } = state.awaiting;
  const edge = edgeFor(state.factory, stage, outcome) ?? { from: stage, on: outcome, to: '$stop' };
  if (verdict === 'ok') assertLane(state, edge);
  state.awaiting = null; state.status = 'running';
  state.history.push({ stage, verdict, task: taskNo(state), ...(note ? { note } : {}) });
  if (verdict === 'no') return stop(state, `gate rejected at ${stage}${note ? `: ${note}` : ''}`);
  if (verdict === 'amend') {
    const key = `${stage}@${taskNo(state)}`;
    // Checked before the count moves, so a stored count never passes the cap R4 holds it to.
    const spent = state.gateAmends?.[key] ?? 0;
    if (spent >= GATE_MAX_AMENDS) return stop(state, `gate amended ${GATE_MAX_AMENDS} times at ${stage}`);
    state.gateAmends = { ...state.gateAmends, [key]: spent + 1 };
    state.stage = stage; state.carry = note || null;
    return { resumed: true };
  }
  return transition(state, stage, edge, bricks);
}
