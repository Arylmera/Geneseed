/**
 * The loop engine: a state machine over a brick graph, persisted as a JSON block in LOOP.md.
 *
 * WHY THE MODEL NEVER DECIDES. Every transition, ceiling, score and stop is computed here; the
 * `loop` skill only runs the node it is handed and reports the brick's outcome. That is what
 * makes four hosts behave identically, and what makes a stopped loop explainable afterwards.
 *
 * WHY A BLOCKING STOP ENDS THE RUN. A background task cannot wait for a person. So "blocking"
 * is `status: awaiting` written to LOOP.md and the run ending; the user's answer relaunches it
 * through `decide`. Crash recovery is the same path: relaunch from the branch and LOOP.md.
 *
 * UNITS. Work closes into a commit whenever the graph re-enters the iteration loop's head, so
 * setup work before the loop (a reproduction test) is its own unit — iteration 0 — and never
 * pollutes iteration 1's write set. Every cycle inside a unit is bounded by re-entry counting:
 * `counters` is keyed by node name (not loop name), incremented on every transition into a
 * non-terminal, non-head node, and capped at `1 + the largest max of a non-iteration loop
 * containing that node` (or just `1` — no re-entry at all — when no such loop covers it). That
 * bounds a cycle through a node the model forgot to put in an inner loop (a sibling brick
 * looping back into a retry node it isn't declared inside), not only the loop the author
 * remembered to declare. LOOP.md itself — the engine's own state file, rewritten by every CLI
 * action — is excluded from every score and every read-brick porcelain check: it is never part
 * of the work being scored, and including it would make every action's own bookkeeping look
 * like an undeclared file touch.
 */
import { declaredRisk, actualRisk, decide, worst, PRESETS, DEFAULT_PRESET } from './score.mjs';
import { iterationLoop, ENGINE_MAX_ITERATIONS } from './graph.mjs';

const BEGIN = '<!-- loop-state:begin -->';
const END = '<!-- loop-state:end -->';
export const VERIFY_COMMAND = 'git add -A && git diff --cached --numstat | geneseed loop score --diff';
export const LOOP_FILE = 'LOOP.md';
const slash = (p) => String(p).replaceAll('\\', '/');

export function renderLoopFile(state) {
  return `# Loop — ${state.title}\n\n${state.requirement}\n\n`
    + 'The block below belongs to the engine. You may change `preset` (prudent, balanced, '
    + 'aggressive) or `contracts`: they apply from the next score on.\n\n'
    + `${BEGIN}\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n${END}\n`;
}

export function parseLoopFile(text) {
  const t = String(text).replace(/\r\n/g, '\n');
  const a = t.indexOf(BEGIN); const b = t.lastIndexOf(END);
  if (a < 0 || b < a) throw new Error('LOOP.md has no loop-state block');
  const inner = t.slice(a + BEGIN.length, b).replace(/^\s*```json\s*/, '').replace(/\s*```\s*$/, '');
  return JSON.parse(inner);
}

const head = (state) => iterationLoop(state.graph).nodes[0];
const fmt = (n) => Number(n).toFixed(1);

export function initState({ title, requirement, graph, preset = DEFAULT_PRESET }) {
  if (!PRESETS[preset]) throw new Error(`unknown preset ${JSON.stringify(preset)}`);
  const loop = iterationLoop(graph);
  const state = {
    v: 1, title, requirement, preset, contracts: [], graph, node: graph.start,
    status: 'running', awaiting: null, reason: null,
    iteration: loop.nodes.includes(graph.start) ? 1 : 0,
    card: null, validated: false, pendingVerify: false, closing: false, counters: {},
    resplit: false, emptyStreak: 0, snapshot: '', visited: [], tests: 'n/a', current: {},
    notes: [], history: [],
  };
  if (preset === 'prudent') { state.status = 'awaiting'; state.awaiting = { kind: 'launch' }; }
  return state;
}

function stop(state, reason) {
  state.status = 'stopped'; state.reason = reason;
  return { stopped: reason };
}

function resetUnit(state) {
  state.card = null; state.validated = false; state.counters = {}; state.visited = [];
  state.current = {}; state.tests = 'n/a';
}

function summary(state) {
  return {
    iterations: state.history.length,
    review: state.history.filter((h) => h.decision === 'soft').map((h) => ({ iteration: h.iteration, intent: h.intent })),
    notes: state.notes,
  };
}

export function trailers(state) {
  const [silent, soft] = PRESETS[state.preset];
  const declared = state.current.declared ?? 0;
  return [
    `Loop-Iteration: ${state.iteration}`,
    `Loop-Bricks: ${[...new Set(state.visited)].join(',')}`,
    `Loop-Risk-Declared: ${fmt(declared)}`,
    `Loop-Risk-Actual: ${fmt(state.current.actual ?? declared)}`,
    `Loop-Threshold: ${state.preset} ${fmt(silent)}/${fmt(soft)}`,
    `Loop-Decision: ${state.current.decision ?? 'silent'}${state.current.amended ? ' (amended)' : ''}`,
    `Loop-Tests: ${state.tests}`,
  ].join('\n');
}

function finishUnit(state, committed) {
  if (committed) {
    state.history.push({
      iteration: state.iteration, bricks: [...new Set(state.visited)],
      declared: state.current.declared ?? 0, actual: state.current.actual ?? state.current.declared ?? 0,
      decision: state.current.decision ?? 'silent', tests: state.tests, intent: state.card?.intent ?? '',
    });
  }
  // The unit is committed (or was empty): the tree is clean again, so the read-brick check
  // compares the next node against a clean status, not the last pre-commit one.
  state.pendingVerify = false; state.resplit = false; state.snapshot = '';
  resetUnit(state);
  state.iteration += 1;
  if (state.closing) { state.status = 'done'; state.node = '$close'; return; }
  state.node = head(state);
  const ceiling = Math.min(iterationLoop(state.graph).max, ENGINE_MAX_ITERATIONS);
  if (state.iteration > ceiling) stop(state, `iteration ceiling of ${ceiling} reached`);
}

function commitUnit(state) {
  const t = trailers(state); const iteration = state.iteration;
  finishUnit(state, true);
  return { commit: true, trailers: t, iteration };
}

function assertRunning(state) {
  if (state.status !== 'running') throw new Error(`the loop is ${state.status}, not running`);
}

export function nextStep(state, bricks) {
  if (state.status === 'awaiting') return { awaiting: state.awaiting, preset: state.preset };
  if (state.status === 'done') return { terminal: '$close', summary: summary(state) };
  if (state.status === 'stopped') return { terminal: '$stop', reason: state.reason, summary: summary(state) };
  if (state.pendingVerify) return { verify: true, iteration: state.iteration, run: VERIFY_COMMAND };
  const brick = bricks.get(state.node);
  if (!brick) throw new Error(`no brick named ${state.node} in the catalogue`);
  return {
    node: state.node, iteration: state.iteration, effect: brick.effect, agent: brick.agent,
    skill: brick.skill, outcomes: brick.outcomes, prompt: brick.body, card: state.card,
    notes: state.notes, validate: brick.effect === 'mutate' && !state.validated,
  };
}

export function scoreDeclared(state, { actions = null, writeSet = null, intent = null } = {}) {
  assertRunning(state);
  if (actions) {
    state.card = {
      ...(state.card ?? {}), intent: intent ?? state.card?.intent ?? state.node,
      actions, writeSet: writeSet ?? state.card?.writeSet ?? [],
    };
  }
  if (!state.card?.actions?.length) {
    throw new Error('no declared actions: the identify brick records a card, or pass --actions');
  }
  const score = declaredRisk(state.card.actions, state.graph.weights);
  const decision = decide(score, state.preset);
  state.validated = true;
  state.current.declared = score;
  state.current.decision = worst(state.current.decision, decision);
  if (decision === 'blocking') {
    state.status = 'awaiting';
    state.awaiting = { kind: 'declared', iteration: state.iteration, score, threshold: PRESETS[state.preset], card: state.card };
  }
  return { score, preset: state.preset, threshold: [...PRESETS[state.preset]], decision };
}

export function scoreDiff(state, files) {
  assertRunning(state);
  if (!state.pendingVerify) throw new Error('no iteration to verify: `geneseed loop next` has not asked for one');
  if (!Array.isArray(state.contracts) || state.contracts.some((c) => typeof c !== 'string')) {
    throw new Error('LOOP.md: contracts must be a list of file paths');
  }
  const scored = files.filter((f) => slash(f.file) !== LOOP_FILE);
  if (!scored.length) {
    // A closing unit (reached $close with a mutate already visited) finishes as done even
    // when this is its second empty diff in a row: there is nothing left to retry into.
    if (state.closing) { finishUnit(state, false); return { empty: true, commit: false }; }
    state.emptyStreak += 1;
    if (state.emptyStreak >= 2) return stop(state, 'two consecutive iterations produced no diff');
    finishUnit(state, false);
    return { empty: true, commit: false };
  }
  state.emptyStreak = 0;
  const { score, reasons } = actualRisk(state.current.declared ?? 0, scored, {
    writeSet: state.card?.writeSet ?? [], contracts: state.contracts ?? [], overrides: state.graph.weights,
  });
  const decision = decide(score, state.preset);
  state.current.actual = score;
  state.current.decision = worst(state.current.decision, decision);
  if (decision === 'blocking') {
    state.status = 'awaiting';
    state.awaiting = { kind: 'actual', iteration: state.iteration, score, reasons, threshold: PRESETS[state.preset] };
    return { score, decision, reasons, commit: false };
  }
  return commitUnit(state);
}

function exhaust(state, loop) {
  if (state.resplit) {
    return stop(state, `${loop.name} exhausted its max of ${loop.max} twice in iteration ${state.iteration}`);
  }
  state.notes.push(`iteration ${state.iteration}: ${loop.name} exhausted its max of ${loop.max}; re-split once`);
  resetUnit(state);
  state.resplit = true; state.snapshot = '';   // the skill stashes the attempt: clean tree
  state.node = head(state);
  return { discard: true, resplit: true };
}

// How many times node `v` may be entered in one unit: 1, plus the largest `max` of any
// non-iteration loop that declares it — or just 1 (no re-entry) when no loop covers it.
function allowedEntries(graph, v) {
  const iteration = iterationLoop(graph);
  let widest = null;
  for (const m of graph.loops) {
    if (m === iteration || !m.nodes.includes(v)) continue;
    if (!widest || m.max > widest.max) widest = m;
  }
  return { allowed: widest ? 1 + widest.max : 1, loop: widest };
}

// Porcelain lines are `XY <path>`; strip the 2-char status + space, slash-normalise, drop
// LOOP.md rows (the engine rewrites it on every action — it is never part of the scored work).
function filterPorcelain(porcelain) {
  const lines = porcelain.split(/\r?\n/).filter((line) => {
    if (!line) return false;
    const path = line.slice(3).replace(/^"|"$/g, '');
    return slash(path) !== LOOP_FILE;
  });
  return lines.join('\n').trimEnd();
}

// Setup work (iteration 0, graph.start outside the iteration loop) is its own unit; rejecting
// it has nowhere to retry back into, so it stops the loop instead of looping to the head.
function isSetupUnit(state) {
  return state.iteration === 0 && !iterationLoop(state.graph).nodes.includes(state.graph.start);
}

export function recordOutcome(state, bricks, outcome, { card = null, porcelain = null } = {}) {
  assertRunning(state);
  if (state.pendingVerify) throw new Error('the iteration is closed: run `geneseed loop score --diff` first');
  const from = state.node;
  const brick = bricks.get(from);
  if (!brick) throw new Error(`no brick named ${from} in the catalogue`);
  if (!brick.outcomes.includes(outcome)) {
    throw new Error(`${from} cannot report ${JSON.stringify(outcome)} — one of ${brick.outcomes.join(', ')}`);
  }
  if (brick.effect === 'mutate' && !state.validated) {
    throw new Error(`${from} modifies code: run \`geneseed loop score --declared\` before it, then record`);
  }
  const filteredPorcelain = porcelain === null ? null : filterPorcelain(porcelain);
  if (brick.effect === 'read' && filteredPorcelain !== null && filteredPorcelain !== state.snapshot) {
    return stop(state, `read-brick-wrote: ${from} changed the working tree`);
  }
  if (filteredPorcelain !== null) state.snapshot = filteredPorcelain;
  if (card) state.card = card;
  if (from === 'test') state.tests = outcome;
  state.visited.push(from);

  const edge = state.graph.edges.find((e) => e.from === from && e.on === outcome);
  if (!edge) throw new Error(`no edge from ${from} on ${outcome}`);
  if (edge.to === '$stop') return stop(state, `${from} reported ${outcome}`);
  const mutated = state.visited.some((n) => bricks.get(n)?.effect === 'mutate');
  if (edge.to === '$close') {
    if (mutated) { state.closing = true; state.pendingVerify = true; return { verify: true }; }
    state.status = 'done'; state.node = '$close';
    return { done: true };
  }
  const h = head(state);
  if (edge.to === h) {
    if (mutated) { state.pendingVerify = true; state.node = h; return { verify: true }; }
    // A read-only setup brick (no mutate visited) closes without asking for a diff score.
    finishUnit(state, false);
    return { node: state.node };
  }
  state.counters[edge.to] = (state.counters[edge.to] ?? 0) + 1;
  const { allowed, loop } = allowedEntries(state.graph, edge.to);
  if (state.counters[edge.to] > allowed) return exhaust(state, loop ?? { name: edge.to, max: 0 });
  state.node = edge.to;
  return { node: edge.to };
}

export function decideAwaiting(state, bricks, verdict, note = '') {
  if (state.status !== 'awaiting') throw new Error('nothing is awaiting a decision');
  if (!['ok', 'no', 'amend'].includes(verdict)) throw new Error(`verdict must be ok, no or amend, not ${JSON.stringify(verdict)}`);
  const { kind } = state.awaiting;
  state.awaiting = null; state.status = 'running';
  if (note) state.notes.push(`iteration ${state.iteration} (${kind}, ${verdict}): ${note}`);
  if (kind === 'launch') {
    return verdict === 'ok' ? { resumed: true } : stop(state, `graph ${verdict === 'no' ? 'rejected' : 'to amend'}${note ? `: ${note}` : ''}`);
  }
  if (kind === 'declared') {
    if (verdict === 'ok') return { resumed: true };
    if (verdict === 'amend') { state.card = { ...state.card, amend: note }; state.current.amended = true; return { resumed: true }; }
    if (isSetupUnit(state)) return stop(state, `setup rejected${note ? `: ${note}` : ''}`);
    resetUnit(state); state.node = head(state);
    return { dropped: true };
  }
  // kind === 'actual': the diff exists, uncommitted
  if (verdict === 'ok') return commitUnit(state);
  state.pendingVerify = false; state.closing = false;
  if (verdict === 'amend') {
    state.card = { ...state.card, amend: note };
    // The user intervened: the decision stands as blocking, said so, and the retry budget
    // for this unit restarts (reset counters) now that the amendment changes what it does.
    state.current = { declared: state.current.declared, decision: 'blocking', amended: true };
    state.counters = {};
    state.node = iterationLoop(state.graph).nodes.find((n) => bricks.get(n)?.effect === 'mutate') ?? head(state);
    return { resumed: true };
  }
  if (isSetupUnit(state)) return stop(state, `setup rejected${note ? `: ${note}` : ''}`);
  resetUnit(state); state.node = head(state); state.snapshot = '';
  return { discard: true };
}
