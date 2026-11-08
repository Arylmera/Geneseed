/**
 * The rules a factory graph must satisfy before a single stage runs: `geneseed factory check`,
 * `factory init` (R7: an unknown factory or loop is refused before anything runs) and the doctor
 * over the shipped factories all call `checkFactory`, so a graph the doctor never sees (a user's
 * `.geneseed/factories/<name>.json`) meets the same rules.
 *
 * A FACTORY IS A LOOP GRAPH ONE LEVEL UP. A stage is a brick name, `loop:<template>` (a whole loop
 * run as one stage, outcomes `pass` and `fail`: the loop closed or it stopped) or `loop:$triaged`
 * (the loop the `triage` stage chose from the factory's `loops` allowlist, D6). A failure may
 * route back to an earlier stage (D7), so the graph has cycles, and every cycle must sit inside a
 * declared `cycles` entry with a `max`: the loop engine's own rule 4, reused (`undeclaredCycles`)
 * rather than copied, so the two engines cannot drift on what "declared" means.
 *
 * `max` IS CAPPED AT 5. A factory cycle re-runs whole loops; five laps of "CI is red, fix it" is
 * already a conversation for the user, not a loop, and the run-wide ceiling of 30 transitions
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
 * allowlist, rules) so a test writes the expected list out instead of sorting it. A malformed
 * `cycles` or `edges` entry (an edge needs a string `from`, `on` and `to`) is reported by the shape
 * rule and left out of every later one: the doctor runs this over a user's file, and the engine
 * over a FACTORY.md anyone can edit, so it must never throw.
 */
import { undeclaredCycles } from '../loop/graph.mjs';

const TERMINALS = new Set(['$close', '$stop']);
export const LOOP_PREFIX = 'loop:';
export const TRIAGED = 'loop:$triaged';
export const FACTORY_MAX_CYCLE = 5;
/** What a `loop:` stage reports: its child loop reached `$close`, or it did not. */
export const LOOP_OUTCOMES = ['pass', 'fail'];

/** The template a `loop:` stage names (`$triaged` for the triaged one), or null for a brick stage. */
export function loopOf(stage) {
  return typeof stage === 'string' && stage.startsWith(LOOP_PREFIX) ? stage.slice(LOOP_PREFIX.length) : null;
}

/** A stage's declared outcomes, or null when it names nothing the catalogue holds. */
export function stageOutcomes(stage, bricks) {
  if (loopOf(stage) !== null) return LOOP_OUTCOMES;
  return bricks.get(stage)?.outcomes ?? null;
}

/** The stages and terminals reachable from `startStage`, never entering `skip`. */
export const reachable = (startStage, edges, stageSet, skip = null) => {
  const seen = new Set([startStage]); const queue = [startStage];
  while (queue.length) {
    const v = queue.shift();
    for (const e of edges) {
      if (e.from !== v || seen.has(e.to) || e.to === skip) continue;
      seen.add(e.to);
      if (stageSet.has(e.to)) queue.push(e.to);
    }
  }
  return seen;
};

export function checkFactory(factory, { bricks, templates }) {
  if (!factory || typeof factory !== 'object' || Array.isArray(factory)) return ['factory: must be an object'];
  const problems = [];
  const stages = Array.isArray(factory.stages) ? factory.stages : [];
  const allEdges = Array.isArray(factory.edges) ? factory.edges : [];
  const allCycles = Array.isArray(factory.cycles) ? factory.cycles : [];
  const loops = Array.isArray(factory.loops) ? factory.loops : [];
  const stageSet = new Set(stages);

  // rule 0 — the shape every later rule assumes
  if (typeof factory.name !== 'string' || !factory.name.trim()) problems.push('name: must be a non-empty string');
  const shaped = (c) => typeof c?.name === 'string' && Array.isArray(c.nodes);
  allCycles.forEach((c, i) => {
    if (!shaped(c)) problems.push(`cycles: entry ${i + 1} must have a string name and a list of nodes`);
  });
  const cycles = allCycles.filter(shaped);
  const edgeShaped = (e) => ['from', 'on', 'to'].every((k) => typeof e?.[k] === 'string');
  allEdges.forEach((e, i) => {
    if (!edgeShaped(e)) problems.push(`edges: entry ${i + 1} must have a string from, on and to`);
  });
  const edges = allEdges.filter(edgeShaped);
  for (const s of new Set(stages.filter((s, i) => stages.indexOf(s) !== i))) problems.push(`stages: ${s} is listed twice`);

  // rule 1 — a stage is an available brick, an existing loop template, or the triaged loop
  for (const s of stages) {
    const loop = loopOf(s);
    if (loop === '$triaged') continue;
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
    if (!stageSet.has(e.to) && !TERMINALS.has(e.to)) {
      problems.push(`${label}: ${e.to} is not a stage, $close or $stop`);
      continue;
    }
    const outcomes = stageOutcomes(e.from, bricks);
    if (outcomes && !outcomes.includes(e.on)) problems.push(`${label}: ${e.on} is not an outcome of ${e.from}`);
  }
  // rule 3 — exactly one edge per outcome; `error` may go without one (the engine routes it to $stop)
  for (const s of [...stages].sort()) {
    for (const o of stageOutcomes(s, bricks) ?? []) {
      const count = edges.filter((e) => e.from === s && e.on === o).length;
      if (count === 0 && o !== 'error') problems.push(`stage ${s}: no edge for outcome ${o}`);
      else if (count > 1) problems.push(`stage ${s}: ${count} edges for outcome ${o}`);
    }
  }
  // rule 4 — start, and $close reachable
  if (!stageSet.has(factory.start)) problems.push(`start ${factory.start} is not a stage`);
  else if (!reachable(factory.start, edges, stageSet).has('$close')) problems.push(`$close is not reachable from ${factory.start}`);
  // rule 5 — cycles are well formed, and every cycle in the graph is declared
  for (const c of cycles) {
    if (!Number.isInteger(c.max) || c.max < 1 || c.max > FACTORY_MAX_CYCLE) {
      problems.push(`cycle ${c.name}: max must be an integer from 1 to ${FACTORY_MAX_CYCLE}`);
    }
    for (const s of c.nodes) if (!stageSet.has(s)) problems.push(`cycle ${c.name}: ${s} is not a stage`);
  }
  const undeclared = undeclaredCycles(stages, edges, cycles);
  for (const cycle of undeclared) problems.push(`cycle ${cycle} has no declared cycle around it`);
  const inGraph = edges.filter((e) => stageSet.has(e.from) && stageSet.has(e.to));
  for (const c of cycles) {
    const inside = new Set(c.nodes);
    const entries = new Set(inGraph.filter((e) => !inside.has(e.from) && inside.has(e.to)).map((e) => e.to));
    if (inside.has(factory.start)) entries.add(factory.start);
    for (const at of entries) {
      if (at !== c.nodes[0]) problems.push(`cycle ${c.name}: entered at ${at}, not at its first stage ${c.nodes[0]}`);
    }
  }
  if (!undeclared.length) {
    const spends = (e) => cycles.some((c) => c.nodes[0] === e.to && c.nodes.includes(e.from));
    for (const lap of undeclaredCycles(stages, inGraph.filter((e) => !spends(e)), [])) {
      problems.push(`cycle ${lap} laps without spending a declared cycle: `
        + 'a route back must target the first stage of a declared cycle that holds its source');
    }
  }
  // rule 6 — the allowlist names real templates; the triaged loop needs one, and a triage stage
  // that every path to it passes through (the engine reads `chosenLoop` from that record)
  for (const l of loops) if (!templates.has(l)) problems.push(`loops: no loop template named ${l}`);
  if (stageSet.has(TRIAGED)) {
    if (!loops.length) problems.push(`${TRIAGED}: loops must list at least one loop template`);
    if (!stageSet.has('triage')) problems.push(`${TRIAGED}: needs a triage stage before it`);
    else if (stageSet.has(factory.start) && factory.start !== 'triage' && reachable(factory.start, edges, stageSet, 'triage').has(TRIAGED)) {
      problems.push(`${TRIAGED}: reachable from ${factory.start} without passing through triage`);
    }
  }
  // rule 7 — the optional instruction list every stage receives through `factory next`
  const { rules } = factory;
  if (rules !== undefined && !(Array.isArray(rules) && rules.every((r) => typeof r === 'string' && r.trim()))) {
    problems.push('rules: must be a list of non-empty strings');
  }
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
