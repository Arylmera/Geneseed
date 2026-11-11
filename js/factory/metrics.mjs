/**
 * The numbers of a factory run, computed from `FACTORY.md`'s state and nothing else: no clock, no
 * file, no catalogue. `geneseed factory report` prints them, and the console's board reads them
 * through `js/factory/registry.mjs`, so the `retro` brick, the Rite and the console show the same
 * figures and no model does date arithmetic (D4, D5).
 *
 * WORK TIME AND WAITING TIME. A history entry's duration is its `at` minus the `at` of the entry
 * before it (the run's `started` for the first). On a `record` entry that is the stage's work
 * time. On a `decide` entry it is the time the run waited at a human gate: the entry before it is
 * always the gated record, so the gap is the user's, never the stage's.
 *
 * UNKNOWN IS `null`, NEVER ZERO. An entry with no `at`, or whose predecessor has none (a
 * FACTORY.md written before the engine stamped times), has a duration of `null`, and so has every
 * sum that holds it: a total that silently left a stage out would read as a fast run. A time that
 * does not parse, or one earlier than its predecessor, is unknown too.
 *
 * TOKENS ARE THE SUM OF WHAT WAS REPORTED. `record --tokens` is passed only where the host gave a
 * count, so a stage's `tokens` adds the counts its entries carry and is `null` when none does.
 * A loop stage carries none: nothing sums a loop's agents by hand (D3).
 *
 * A REWORK IS AN OUTCOME THAT SPENT A CYCLE: the stage reported an outcome whose edge routes back
 * into a declared cycle (`spentCycle`, the rule the engine counts laps with). A held outcome
 * spends its cycle only when the user answers `ok`; `amend` re-runs the stage and `no` stops, and
 * neither is a rework. The fork test needs each stage's outcomes, which live in the catalogue;
 * here they are read off the factory's own edges, one edge per outcome (rule 3 of `checkFactory`),
 * so this module needs no catalogue and the daemon can call it on any registered run.
 *
 * THE OPEN WAIT. A wait is counted on the `decide` that ends it, so a run still held at a gate has
 * waited nothing yet by that count. `now` (an ISO time, optional) gives `openWaitMs`: `now` minus
 * the `at` of the gated record, while the run is `awaiting`. It is null without `now`, on a run
 * that is not awaiting, and when that record has no `at`. The caller reads the clock (`factory
 * report` its own, the console the time of its poll); this module stays pure.
 *
 * NEVER THROWS on a state that parsed: the console calls it on a FACTORY.md nobody validated.
 */
import { edgeFor, laneTargets, spentCycle } from './graph.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const elapsed = (from, to) => {
  const a = Date.parse(from ?? ''); const b = Date.parse(to ?? '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
};
const sum = (xs) => (xs.includes(null) ? null : xs.reduce((a, b) => a + b, 0));
const tokensOf = (hs) => {
  const known = hs.map((h) => h.tokens).filter((t) => Number.isSafeInteger(t) && t >= 1);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

/**
 * `{ started, stages, workMs, waitMs, openWaitMs, tokens, transitions, entries }`. `stages` lists each stage
 * the run recorded, in the order it first ran: `{ stage, runs, reworks, workMs, tokens }`.
 * `entries` is parallel to `state.history`: `{ ms, wait, rework }`, `wait` true on a `decide`
 * entry. `transitions` is the run-wide count the engine keeps.
 */
export function runMetrics(state, { now = null } = {}) {
  const factory = state?.factory;
  const history = list(state?.history).map((h) => (h !== null && typeof h === 'object' ? h : {}));
  const edges = list(factory?.edges);
  const outcomes = new Map(list(factory?.stages).map((s) => [s, { outcomes: edges.filter((e) => e?.from === s).map((e) => e.on) }]));
  const lanes = laneTargets(factory, outcomes);
  const spends = (h) => {
    const edge = edgeFor(factory, h.stage, h.outcome);
    return !!edge && spentCycle(list(factory?.cycles), h.stage, edge.to, lanes) !== null;
  };

  let prev = state?.started ?? null;
  const entries = history.map((h, i) => {
    const ms = elapsed(prev, h.at);
    prev = h.at ?? null;
    if (h.verdict !== undefined) return { ms, wait: true, rework: false };
    const answer = history[i + 1]?.verdict;   // set when this record held a gate that was answered
    const held = answer !== undefined || (i === history.length - 1 && state?.awaiting != null);
    return { ms, wait: false, rework: (held ? answer === 'ok' : true) && spends(h) };
  });

  const byStage = new Map();
  history.forEach((h, i) => {
    if (entries[i].wait) return;
    const row = byStage.get(h.stage) ?? { stage: h.stage, runs: 0, reworks: 0, ms: [], hs: [] };
    row.runs += 1; row.reworks += entries[i].rework ? 1 : 0; row.ms.push(entries[i].ms); row.hs.push(h);
    byStage.set(h.stage, row);
  });
  return {
    started: typeof state?.started === 'string' ? state.started : null,
    stages: [...byStage.values()].map(({ stage, runs, reworks, ms, hs }) => ({ stage, runs, reworks, workMs: sum(ms), tokens: tokensOf(hs) })),
    workMs: sum(entries.filter((e) => !e.wait).map((e) => e.ms)),
    waitMs: sum(entries.filter((e) => e.wait).map((e) => e.ms)),
    openWaitMs: state?.status === 'awaiting' && now ? elapsed(history.at(-1)?.at, now) : null,
    tokens: tokensOf(history),
    transitions: Number.isInteger(state?.runTransitions) ? state.runTransitions : null,
    entries,
  };
}
