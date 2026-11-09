/**
 * The rules a factory graph must satisfy before a single stage runs: `geneseed factory check`,
 * `factory init` (R7: an unknown factory or loop is refused before anything runs) and the doctor
 * over the shipped factories all call `checkFactory`, so a graph the doctor never sees (a user's
 * `.geneseed/factories/<name>.json`) meets the same rules.
 *
 * A FACTORY IS A LOOP GRAPH ONE LEVEL UP. A stage is a brick name or `loop:<template>` (a whole
 * loop run as one stage, outcomes `pass` and `fail`: the loop closed or it stopped). A failure may
 * route back to an earlier stage (D7), so the graph has cycles, and every cycle must sit inside a
 * declared `cycles` entry with a `max`: the loop engine's own rule 4, reused (`undeclaredCycles`)
 * rather than copied, so the two engines cannot drift on what "declared" means.
 *
 * FORKS AND `$lane` (D11, D13). A fork is a brick stage that declares an outcome other than
 * `pass`, `fail`, `error`, `none` or `needs-info` — a named outcome, such as `triage`'s `bug` or `docs`. Each
 * outcome has its own edge (rule 3), so the edges out of a fork ARE its lanes: an outcome whose
 * edge reaches a stage. An edge target or a cycle node may be `$lane`: the stage the run's most
 * recent fork chose, which the engine records in FACTORY.md and resolves at runtime. Statically,
 * `$lane` stands for EVERY lane of every fork (`laneTargets`): reachability, declared cycles and
 * the lap rule all run over the edges with `$lane` expanded that way, an over-approximation, so a
 * graph that passes holds for whichever lane a run takes. A cycle whose first stage is `$lane` is
 * entered at any lane, and spent only by an edge whose literal target is `$lane` (`spentCycle`,
 * which the engine calls too). Such an edge always revisits a stage: the lane is the first stage
 * after its fork. The `loops` allowlist and `loop:$triaged` (D6) are retired: `check` names each
 * with its replacement, and never rewrites a user's file (D15).
 *
 * `max` IS CAPPED AT 5. A factory cycle re-runs whole loops; five laps of "CI is red, fix it" is
 * already a conversation for the user, not a loop, and the per-task ceiling of 60 transitions
 * (`FACTORY_MAX_TRANSITIONS`, J3) sits on top of it.
 *
 * A CYCLE IS ENTERED AT ITS FIRST STAGE, AND EVERY LAP SPENDS ONE. The engine spends a cycle on an
 * edge whose target is the cycle's `nodes[0]` and whose source the cycle holds (`transition`,
 * `js/factory/state.mjs`). That counts laps right only when (a) every way into the cycle — an edge
 * from a stage outside it, or `start` inside it — lands on `nodes[0]`, else the forward edge into
 * `nodes[0]` spends on the first pass; and (b) with every spending edge removed the graph has no
 * cycle left, else some lap (a route back into the middle of a cycle) spends nothing. The rule is
 * topological, never read from the order of `stages`, which is authoring order. (b) runs only when
 * every cycle is declared, so an undeclared one is reported once, not twice.
 *
 * Problems come in a fixed order (shape, stages, edges, outcomes, reachability, cycles,
 * lanes, rules, protected paths, review seats) so a test writes the expected list out instead of sorting it. A malformed
 * `cycles` or `edges` entry (an edge needs a string `from`, `on` and `to`) is reported by the shape
 * rule and left out of every later one: the doctor runs this over a user's file, and the engine
 * over a FACTORY.md anyone can edit, so it must never throw.
 */
import { undeclaredCycles } from '../loop/graph.mjs';

const TERMINALS = new Set(['$close', '$stop']);
export const LOOP_PREFIX = 'loop:';
/** An edge target or cycle node: the stage the run's most recent fork chose (D13). */
export const LANE = '$lane';
const RETIRED_TRIAGED = 'loop:$triaged';
export const FACTORY_MAX_CYCLE = 5;
/** What a `loop:` stage reports: its child loop reached `$close`, or it did not. */
export const LOOP_OUTCOMES = ['pass', 'fail'];
/**
 * The outcomes that name no lane; any other declared outcome makes its brick a fork (D11).
 * `needs-info` is `intake`'s question to the user (a gate), never a lane: listed here, it sets
 * no `state.lane`, hands no `lanes` and leaves `$lane` alone.
 */
const NEEDS_INFO = 'needs-info';
const PLAIN_OUTCOMES = new Set(['pass', 'fail', 'error', 'none', NEEDS_INFO]);
/** The work item sizes `intake` rates; `review.seats` needs a list for each (rule 9). */
const SEAT_SIZES = ['small', 'medium', 'large'];
const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const edgeShaped = (e) => ['from', 'on', 'to'].every((k) => typeof e?.[k] === 'string');

/**
 * The edge an outcome follows: its own, else for `needs-info` the stage's `pass` edge (a factory
 * with no needs-info edge goes on as if intake had passed), else for `error` a stop. Null when
 * none applies. The engine's one lookup, so `record` and a gate's `ok` cannot disagree.
 */
export function edgeFor(factory, from, outcome) {
  const own = (on) => (Array.isArray(factory?.edges) ? factory.edges : []).find((e) => e?.from === from && e.on === on);
  return own(outcome) ?? (outcome === NEEDS_INFO ? own('pass') : undefined)
    ?? (outcome === 'error' ? { from, on: 'error', to: '$stop' } : null);
}

/** The template a `loop:` stage names, or null for a brick stage. */
export function loopOf(stage) {
  return typeof stage === 'string' && stage.startsWith(LOOP_PREFIX) ? stage.slice(LOOP_PREFIX.length) : null;
}

/** A stage's declared outcomes, or null when it names nothing the catalogue holds. */
export function stageOutcomes(stage, bricks) {
  if (loopOf(stage) !== null) return LOOP_OUTCOMES;
  return bricks.get(stage)?.outcomes ?? null;
}

/** A fork: a brick stage that declares a named outcome, one outside pass, fail, error and none. */
export function isFork(stage, bricks) {
  return loopOf(stage) === null && (bricks.get(stage)?.outcomes ?? []).some((o) => !PLAIN_OUTCOMES.has(o));
}

/** A fork's lanes: each outcome whose edge reaches a stage, mapped to that stage. Never throws. */
export function lanesOf(factory, stage) {
  const stages = new Set(Array.isArray(factory?.stages) ? factory.stages : []);
  const edges = Array.isArray(factory?.edges) ? factory.edges.filter(edgeShaped) : [];
  return Object.fromEntries(edges.filter((e) => e.from === stage && stages.has(e.to)).map((e) => [e.on, e.to]));
}

/** Every stage a fork of `factory` leads to: what `$lane` may resolve to. Never throws. */
export function laneTargets(factory, bricks) {
  const stages = Array.isArray(factory?.stages) ? factory.stages : [];
  return new Set(stages.filter((s) => isFork(s, bricks)).flatMap((s) => Object.values(lanesOf(factory, s))));
}

/**
 * The cycle an edge spends: the smallest whose first stage is the edge's literal target (`$lane`
 * unresolved) and which holds its source — a `$lane` node holds every lane. One rule for `check`
 * and the engine, so the two cannot disagree on which edge pays for a lap.
 */
export function spentCycle(cycles, from, to, lanes) {
  let best = null;
  for (const c of cycles) {
    if (!Array.isArray(c?.nodes) || c.nodes[0] !== to) continue;
    if (!c.nodes.includes(from) && !(c.nodes.includes(LANE) && lanes.has(from))) continue;
    if (!best || c.nodes.length < best.nodes.length) best = c;
  }
  return best;
}

/** The stages and terminals reachable from `startStage`, never entering a stage in `skip`. */
export const reachable = (startStage, edges, stageSet, skip = new Set()) => {
  const seen = new Set([startStage]); const queue = [startStage];
  while (queue.length) {
    const v = queue.shift();
    for (const e of edges) {
      if (e.from !== v || seen.has(e.to) || skip.has(e.to)) continue;
      seen.add(e.to);
      if (stageSet.has(e.to)) queue.push(e.to);
    }
  }
  return seen;
};

/**
 * Rule 9: the review panel's seat table — a non-empty list per size, an optional list per area,
 * every seat a shipped agent. No `agents` in the catalogue reads as none shipped: closed, not open.
 */
function seatProblems(review, agents) {
  const seats = plainObject(review) ? review.seats : undefined;
  if (!plainObject(seats)) return ['review: must be an object with a seats table'];
  const out = [];
  const lists = SEAT_SIZES.map((s) => [s, seats[s]]);
  if (seats.areas !== undefined) {
    if (plainObject(seats.areas)) lists.push(...Object.entries(seats.areas).map(([a, l]) => [`areas.${a}`, l]));
    else out.push('review.seats.areas: must map each area to a list of agents');
  }
  for (const [where, list] of lists) {
    if (!Array.isArray(list) || !list.length || !list.every((a) => typeof a === 'string')) {
      out.push(`review.seats.${where}: must be a non-empty list of agent names`);
      continue;
    }
    for (const a of list) if (!agents.has(a)) out.push(`review.seats.${where}: no agent named ${a}`);
  }
  return out;
}

export function checkFactory(factory, { bricks, templates, agents }) {
  if (!factory || typeof factory !== 'object' || Array.isArray(factory)) return ['factory: must be an object'];
  const problems = [];
  const stages = Array.isArray(factory.stages) ? factory.stages : [];
  const allEdges = Array.isArray(factory.edges) ? factory.edges : [];
  const allCycles = Array.isArray(factory.cycles) ? factory.cycles : [];
  const stageSet = new Set(stages);

  // rule 0 — the shape every later rule assumes
  if (typeof factory.name !== 'string' || !factory.name.trim()) problems.push('name: must be a non-empty string');
  const shaped = (c) => typeof c?.name === 'string' && Array.isArray(c.nodes);
  allCycles.forEach((c, i) => {
    if (!shaped(c)) problems.push(`cycles: entry ${i + 1} must have a string name and a list of nodes`);
  });
  const cycles = allCycles.filter(shaped);
  allEdges.forEach((e, i) => {
    if (!edgeShaped(e)) problems.push(`edges: entry ${i + 1} must have a string from, on and to`);
  });
  const edges = allEdges.filter(edgeShaped);
  for (const s of new Set(stages.filter((s, i) => stages.indexOf(s) !== i))) problems.push(`stages: ${s} is listed twice`);

  // rule 1 — a stage is an available brick or an existing loop template
  for (const s of stages) {
    if (s === RETIRED_TRIAGED) {
      problems.push(`stage ${s}: retired — list each loop as its own stage, one fork edge per lane `
        + `(triage --bug--> loop:bugfix), and route back to ${LANE}`);
      continue;
    }
    const loop = loopOf(s);
    if (loop !== null) {
      if (!templates.has(loop)) problems.push(`stage ${s}: no loop template named ${loop}`);
      continue;
    }
    const brick = bricks.get(s);
    if (!brick) problems.push(`stage ${s}: no brick named ${s}`);
    else if (!brick.available) problems.push(`stage ${s}: brick unavailable (${brick.reason})`);
  }
  // rule 2 — edge endpoints, and edges use declared outcomes
  for (const e of edges) {
    const label = `edge ${e.from} --${e.on}--> ${e.to}`;
    if (!stageSet.has(e.from)) { problems.push(`${label}: ${e.from} is not a stage`); continue; }
    if (!stageSet.has(e.to) && !TERMINALS.has(e.to) && e.to !== LANE) {
      problems.push(`${label}: ${e.to} is not a stage, $close or $stop`);
      continue;
    }
    const outcomes = stageOutcomes(e.from, bricks);
    if (outcomes && !outcomes.includes(e.on)) problems.push(`${label}: ${e.on} is not an outcome of ${e.from}`);
  }
  // rule 3 — exactly one edge per outcome; `error` may go without one (the engine routes it to
  // $stop), and so may `needs-info` (it follows the stage's `pass` edge: `edgeFor`), so a factory
  // written before intake could ask stays valid, and so does a FACTORY.md that embeds one
  for (const s of [...stages].sort()) {
    for (const o of stageOutcomes(s, bricks) ?? []) {
      const count = edges.filter((e) => e.from === s && e.on === o).length;
      if (count === 0 && o !== 'error' && o !== NEEDS_INFO) problems.push(`stage ${s}: no edge for outcome ${o}`);
      else if (count > 1) problems.push(`stage ${s}: ${count} edges for outcome ${o}`);
    }
  }
  // Rules 4 and 5 read `$lane` as every lane of every fork (module docblock).
  const lanes = laneTargets({ stages, edges }, bricks);
  const expand = (e) => (e.to === LANE ? [...lanes].map((to) => ({ ...e, to })) : [e]);
  const xnodes = (c) => c.nodes.flatMap((n) => (n === LANE ? [...lanes] : [n]));
  const flat = edges.flatMap(expand);
  // rule 4 — start, and $close reachable
  if (!stageSet.has(factory.start)) problems.push(`start ${factory.start} is not a stage`);
  else if (!reachable(factory.start, flat, stageSet).has('$close')) problems.push(`$close is not reachable from ${factory.start}`);
  // rule 5 — cycles are well formed, and every cycle in the graph is declared
  for (const c of cycles) {
    if (!Number.isInteger(c.max) || c.max < 1 || c.max > FACTORY_MAX_CYCLE) {
      problems.push(`cycle ${c.name}: max must be an integer from 1 to ${FACTORY_MAX_CYCLE}`);
    }
    for (const s of c.nodes) if (s !== LANE && !stageSet.has(s)) problems.push(`cycle ${c.name}: ${s} is not a stage`);
  }
  const undeclared = undeclaredCycles(stages, flat, cycles.map((c) => ({ ...c, nodes: xnodes(c) })));
  for (const cycle of undeclared) problems.push(`cycle ${cycle} has no declared cycle around it`);
  const inGraph = (e) => stageSet.has(e.from) && stageSet.has(e.to);
  for (const c of cycles) {
    // a `$lane` cycle with no fork behind it is rule 6's to report
    if (c.nodes[0] === LANE && !lanes.size) continue;
    const inside = new Set(xnodes(c));
    const firsts = c.nodes[0] === LANE ? lanes : new Set([c.nodes[0]]);
    const entries = new Set(flat.filter((e) => inGraph(e) && !inside.has(e.from) && inside.has(e.to)).map((e) => e.to));
    if (inside.has(factory.start)) entries.add(factory.start);
    for (const at of entries) {
      if (!firsts.has(at)) problems.push(`cycle ${c.name}: entered at ${at}, not at its first stage ${c.nodes[0]}`);
    }
  }
  if (!undeclared.length) {
    const unspent = edges.filter((e) => !spentCycle(cycles, e.from, e.to, lanes)).flatMap(expand).filter(inGraph);
    for (const lap of undeclaredCycles(stages, unspent, [])) {
      problems.push(`cycle ${lap} laps without spending a declared cycle: `
        + 'a route back must target the first stage of a declared cycle that holds its source');
    }
  }
  // rule 6 — lanes: the retired allowlist, and a `$lane` only where a fork has chosen one
  if (factory.loops !== undefined) problems.push('loops: retired — the lanes are the edges out of a fork (triage --bug--> loop:bugfix)');
  const toLane = edges.filter((e) => e.to === LANE);
  const forks = stages.filter((s) => isFork(s, bricks));
  if ((toLane.length || cycles.some((c) => c.nodes.includes(LANE))) && !forks.length) {
    problems.push(`${LANE}: no fork chooses a lane — a fork is a brick stage with a named outcome (triage --bug--> loop:bugfix)`);
  } else if (forks.length) {
    for (const e of toLane) {
      if (forks.includes(e.from)) problems.push(`edge ${e.from} --${e.on}--> ${LANE}: a fork's edge names its lane, never ${LANE}`);
    }
    // Literal edges: past an unresolved `$lane` nothing is reachable, so it is reported once.
    if (stageSet.has(factory.start) && !forks.includes(factory.start)) {
      const before = reachable(factory.start, edges, stageSet, new Set(forks));
      for (const e of toLane) {
        if (before.has(e.from)) problems.push(`edge ${e.from} --${e.on}--> ${LANE}: reachable from ${factory.start} before any fork has chosen a lane`);
      }
    }
  }
  // rule 7 — the optional instruction list every stage receives through `factory next`
  const { rules } = factory;
  if (rules !== undefined && !(Array.isArray(rules) && rules.every((r) => typeof r === 'string' && r.trim()))) {
    problems.push('rules: must be a list of non-empty strings');
  }
  // rule 8 — the paths `checks` refuses to see changed, beyond its own fixed list
  const locked = factory.protected;
  if (locked !== undefined && !(Array.isArray(locked) && locked.every((p) => typeof p === 'string' && p.trim()))) {
    problems.push('protected: must be a list of non-empty paths');
  }
  // rule 9 — the `review-panel` seat table
  if (factory.review !== undefined) problems.push(...seatProblems(factory.review, agents ?? new Set()));
  return problems;
}

/**
 * Every factory in the catalogue, checked and prefixed `factories/<name>: `, after the parse
 * problems `loadCatalog` collected — the factory twin of `catalogProblems`, sorted the same way.
 */
export function factoryCatalogProblems(catalog) {
  const out = [...catalog.factoryProblems];
  for (const [name, factory] of catalog.factories) {
    out.push(...checkFactory(factory, catalog).map((p) => `factories/${name}: ${p}`));
  }
  return out.sort();
}
