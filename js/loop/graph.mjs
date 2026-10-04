/**
 * The rules a loop graph must satisfy before a single node runs. ONE function, three callers:
 * `geneseed loop check`, the doctor over the shipped templates, and `loop init` over a graph the
 * model composed at run time — the composed graph never meets the doctor, so the engine has to
 * carry the same check or free composition would be unchecked composition.
 *
 * WHY EVERY CYCLE NEEDS A DECLARED LOOP. Edges are free, so a graph can loop anywhere. A loop
 * that terminates only because the model eventually reports a different outcome is a loop that
 * may not terminate; a declared `max` is what turns "should stop" into "will stop". The check is
 * structural (strongly connected components), so it needs no simulation and cannot miss a path.
 *
 * Problems are returned in a fixed order — per node, per edge, per outcome, then loops — so a
 * test can write the expected list out instead of sorting it.
 *
 * WHY A CYCLE INSIDE AN ITERATION NEEDS ITS OWN LOOP. The whole-SCC check (rule 4) is satisfied
 * by the iteration loop alone, since every node in an iteration is reachable from every other —
 * but the runtime gives a node outside every *inner* loop exactly one entry per iteration (no
 * re-entry at all), so a cycle that never reaches the iteration head and is not inside its own
 * declared inner loop would hit that "max of 0" path by construction, not by a model's mistake.
 * The static check has to refuse that graph, not just the ones the runtime would loop forever on.
 */
import { WEIGHTS } from './score.mjs';

export const TERMINALS = new Set(['$close', '$stop']);
export const ENGINE_MAX_ITERATIONS = 20;

export function iterationLoop(graph) {
  return (graph.loops ?? []).find((l) => l.iteration === true);
}

/** Tarjan — the strongly connected components of the node graph (terminals excluded). */
function components(nodes, edges) {
  const succ = new Map(nodes.map((n) => [n, []]));
  for (const e of edges) if (succ.has(e.from) && succ.has(e.to)) succ.get(e.from).push(e.to);
  let index = 0;
  const idx = new Map(); const low = new Map(); const stack = []; const on = new Set(); const out = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index += 1; stack.push(v); on.add(v);
    for (const w of succ.get(v)) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      for (;;) { const w = stack.pop(); on.delete(w); comp.push(w); if (w === v) break; }
      const selfLoop = comp.length === 1 && succ.get(v).includes(v);
      if (comp.length > 1 || selfLoop) out.push(comp.sort());
    }
  };
  for (const n of nodes) if (!idx.has(n)) visit(n);
  return out;
}

export function checkGraph(graph, bricks) {
  const problems = [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const loops = Array.isArray(graph.loops) ? graph.loops : [];
  const nodeSet = new Set(nodes);

  // rule 1 — nodes name available bricks
  for (const n of nodes) {
    const brick = bricks.get(n);
    if (!brick) problems.push(`node ${n}: no brick named ${n}`);
    else if (!brick.available) problems.push(`node ${n}: brick unavailable (${brick.reason})`);
  }
  // rule 1 — edge endpoints; rule 2 — edges use declared outcomes
  for (const e of edges) {
    const label = `edge ${e.from} --${e.on}--> ${e.to}`;
    if (!nodeSet.has(e.from)) { problems.push(`${label}: ${e.from} is not a node`); continue; }
    if (!nodeSet.has(e.to) && !TERMINALS.has(e.to)) {
      problems.push(`${label}: ${e.to} is not a node, $close or $stop`);
      continue;
    }
    const brick = bricks.get(e.from);
    if (brick && !brick.outcomes.includes(e.on)) problems.push(`${label}: ${e.on} is not an outcome of ${e.from}`);
  }
  // rule 2 — exactly one edge per declared outcome (nodes in sorted order)
  for (const n of [...nodes].sort()) {
    const brick = bricks.get(n);
    if (!brick) continue;
    for (const o of brick.outcomes) {
      const count = edges.filter((e) => e.from === n && e.on === o).length;
      if (count === 0) problems.push(`node ${n}: no edge for outcome ${o}`);
      else if (count > 1) problems.push(`node ${n}: ${count} edges for outcome ${o}`);
    }
  }
  // rule 3 — start, and $close reachable
  if (!nodeSet.has(graph.start)) {
    problems.push(`start ${graph.start} is not a node`);
  } else {
    const seen = new Set([graph.start]); const queue = [graph.start];
    while (queue.length) {
      const v = queue.shift();
      for (const e of edges) {
        if (e.from === v && !seen.has(e.to)) { seen.add(e.to); if (nodeSet.has(e.to)) queue.push(e.to); }
      }
    }
    if (!seen.has('$close')) problems.push(`$close is not reachable from ${graph.start}`);
  }
  // rule 5 — loops are well formed
  for (const l of loops) {
    if (!Number.isInteger(l.max) || l.max < 1) problems.push(`loop ${l.name}: max must be a positive integer`);
    else if (l.iteration === true && l.max > ENGINE_MAX_ITERATIONS) {
      problems.push(`loop ${l.name}: max ${l.max} is above the engine ceiling of ${ENGINE_MAX_ITERATIONS}`);
    }
    for (const n of l.nodes ?? []) if (!nodeSet.has(n)) problems.push(`loop ${l.name}: ${n} is not a node`);
  }
  const iterations = loops.filter((l) => l.iteration === true).length;
  if (iterations !== 1) problems.push(`${iterations} loops are marked iteration; exactly one must be`);
  // rule 4 — every cycle is inside a declared loop
  for (const comp of components(nodes, edges)) {
    const covered = loops.some((l) => comp.every((n) => (l.nodes ?? []).includes(n)));
    if (!covered) problems.push(`cycle ${comp.join(', ')} has no declared loop around it`);
  }
  // rule 4b — a cycle that never reaches the iteration head needs its own non-iteration loop
  const iterationLoops = loops.filter((l) => l.iteration === true);
  if (iterationLoops.length === 1) {
    const [iteration] = iterationLoops;
    const head = iteration.nodes?.[0];
    const innerEdges = edges.filter((e) => e.to !== head);
    for (const comp of components(nodes, innerEdges)) {
      const covered = loops.some((l) => l !== iteration && comp.every((n) => (l.nodes ?? []).includes(n)));
      if (!covered) problems.push(`cycle ${comp.join(', ')} inside an iteration has no inner loop around it`);
    }
    // rule 4c — the iteration is entered only at its head: the runtime opens and closes units
    // on re-entering nodes[0], so entering anywhere else runs a unit with no head behind it.
    const inside = new Set(iteration.nodes ?? []);
    if (head !== undefined) {
      if (inside.has(graph.start) && graph.start !== head) {
        problems.push(`start ${graph.start} is inside the iteration but is not its head ${head}`);
      }
      for (const e of edges) {
        if (!inside.has(e.from) && inside.has(e.to) && e.to !== head) {
          problems.push(`edge ${e.from} --${e.on}--> ${e.to} enters the iteration at ${e.to}, not at its head ${head}`);
        }
      }
    }
  }
  // template weight overrides
  for (const k of Object.keys(graph.weights ?? {})) {
    if (!Object.hasOwn(WEIGHTS, k)) problems.push(`weights: ${k} is not an action`);
  }
  // optional glob lists (score.mjs's `globMatch` reads them)
  for (const k of ['contracts', 'ignoreDeletions']) {
    const v = graph[k];
    if (v !== undefined && !(Array.isArray(v) && v.every((g) => typeof g === 'string' && g.trim()))) {
      problems.push(`${k}: must be a list of non-empty glob strings`);
    }
  }
  // optional instruction list every brick receives through `loop next`
  const rules = graph.rules;
  if (rules !== undefined && !(Array.isArray(rules) && rules.every((r) => typeof r === 'string' && r.trim()))) {
    problems.push('rules: must be a list of non-empty strings');
  }
  return problems;
}
