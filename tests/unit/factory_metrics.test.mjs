// tests/unit/factory_metrics.test.mjs
// `runMetrics` over hand-written states: it reads a state and nothing else, so each row is a
// `started`, a factory and a history, with the numbers it must give written out beside it.
//
// The rules the rows hold it to (js/factory/metrics.mjs):
//   - an entry's duration is its `at` minus the `at` before it (`started` for the first);
//   - on a `record` entry that is the stage's work time, on a `decide` entry it is waiting time;
//   - an entry with no `at`, or whose predecessor has none, is `null`, and so is every sum over it;
//   - a rework is an outcome whose edge spends a declared cycle; a held outcome spends only on `ok`;
//   - tokens add what the entries carry, and are `null` when none carries a count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMetrics } from '../../js/factory/metrics.mjs';

const at = (hhmm) => `2026-11-11T${hhmm}:00.000Z`;
const MIN = 60000;
// plan -> loop:bugfix -> review -> $close; a review fail goes back to the loop (cycle rework).
const FIX = {
  name: 'fix', start: 'plan', stages: ['plan', 'loop:bugfix', 'review'],
  edges: [
    { from: 'plan', on: 'pass', to: 'loop:bugfix' },
    { from: 'loop:bugfix', on: 'pass', to: 'review' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: 'loop:bugfix' },
  ],
  cycles: [{ name: 'rework', nodes: ['loop:bugfix', 'review'], max: 2 }],
};
// intake -> loop:bugfix -> checks -> $close; `checks none` re-runs checks once (cycle done-list).
const GATED = {
  name: 'gated', start: 'intake', stages: ['intake', 'loop:bugfix', 'checks'],
  edges: [
    { from: 'intake', on: 'pass', to: 'loop:bugfix' }, { from: 'intake', on: 'fail', to: '$stop' },
    { from: 'intake', on: 'needs-info', to: 'loop:bugfix' },
    { from: 'loop:bugfix', on: 'pass', to: 'checks' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'checks', on: 'pass', to: '$close' }, { from: 'checks', on: 'fail', to: 'loop:bugfix' },
    { from: 'checks', on: 'none', to: 'checks' },
  ],
  cycles: [{ name: 'done-list', nodes: ['checks'], max: 1 }, { name: 'checks', nodes: ['loop:bugfix', 'checks'], max: 2 }],
};
// triage is a fork (the outcome `bug` names a lane); a review fail goes back to `$lane`.
const FORKED = {
  name: 'forked', start: 'triage', stages: ['triage', 'loop:bugfix', 'loop:feature', 'review'],
  edges: [
    { from: 'triage', on: 'bug', to: 'loop:bugfix' }, { from: 'triage', on: 'feature', to: 'loop:feature' },
    { from: 'triage', on: 'fail', to: '$stop' },
    { from: 'loop:bugfix', on: 'pass', to: 'review' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'loop:feature', on: 'pass', to: 'review' }, { from: 'loop:feature', on: 'fail', to: '$stop' },
    { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: '$lane' },
  ],
  cycles: [{ name: 'rework', nodes: ['$lane', 'review'], max: 2 }],
};
const work = (ms, rework = false) => ({ ms, wait: false, rework });
const wait = (ms) => ({ ms, wait: true, rework: false });

const ROWS = [
  ['a straight run: every duration is work time, tokens add what two stages reported', {
    started: at('10:00'), factory: FIX, runTransitions: 2, awaiting: null,
    history: [
      { stage: 'plan', outcome: 'pass', task: 0, tokens: 300, at: at('10:01') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:11') },
      { stage: 'review', outcome: 'pass', task: 0, tokens: 500, at: at('10:13') },
    ],
  }, {
    started: at('10:00'),
    stages: [
      { stage: 'plan', runs: 1, reworks: 0, workMs: 1 * MIN, tokens: 300 },
      { stage: 'loop:bugfix', runs: 1, reworks: 0, workMs: 10 * MIN, tokens: null },
      { stage: 'review', runs: 1, reworks: 0, workMs: 2 * MIN, tokens: 500 },
    ],
    workMs: 13 * MIN, waitMs: 0, tokens: 800, transitions: 2,
    entries: [work(1 * MIN), work(10 * MIN), work(2 * MIN)],
  }],
  ['one rework: the review that failed carries it, and both stages count two runs', {
    started: at('10:00'), factory: FIX, runTransitions: 4, awaiting: null,
    history: [
      { stage: 'plan', outcome: 'pass', task: 0, at: at('10:01') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:11') },
      { stage: 'review', outcome: 'fail', task: 0, carry: 'review.md', at: at('10:13') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:20') },
      { stage: 'review', outcome: 'pass', task: 0, at: at('10:21') },
    ],
  }, {
    started: at('10:00'),
    stages: [
      { stage: 'plan', runs: 1, reworks: 0, workMs: 1 * MIN, tokens: null },
      { stage: 'loop:bugfix', runs: 2, reworks: 0, workMs: 17 * MIN, tokens: null },
      { stage: 'review', runs: 2, reworks: 1, workMs: 3 * MIN, tokens: null },
    ],
    workMs: 21 * MIN, waitMs: 0, tokens: null, transitions: 4,
    entries: [work(1 * MIN), work(10 * MIN), work(2 * MIN, true), work(7 * MIN), work(1 * MIN)],
  }],
  ['human gates: the time to each answer is waiting, never work; amend is no rework, ok on `checks none` is one', {
    started: at('10:00'), factory: GATED, runTransitions: 3, awaiting: null,
    history: [
      { stage: 'intake', outcome: 'needs-info', task: 0, at: at('10:02') },
      { stage: 'intake', verdict: 'amend', task: 0, note: 'half-even', at: at('10:32') },
      { stage: 'intake', outcome: 'pass', task: 0, at: at('10:35') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:45') },
      { stage: 'checks', outcome: 'none', task: 0, at: at('10:46') },
      { stage: 'checks', verdict: 'ok', task: 0, at: at('11:46') },
      { stage: 'checks', outcome: 'pass', task: 0, at: at('11:48') },
    ],
  }, {
    started: at('10:00'),
    stages: [
      { stage: 'intake', runs: 2, reworks: 0, workMs: 5 * MIN, tokens: null },
      { stage: 'loop:bugfix', runs: 1, reworks: 0, workMs: 10 * MIN, tokens: null },
      { stage: 'checks', runs: 2, reworks: 1, workMs: 3 * MIN, tokens: null },
    ],
    workMs: 18 * MIN, waitMs: 90 * MIN, tokens: null, transitions: 3,
    entries: [work(2 * MIN), wait(30 * MIN), work(3 * MIN), work(10 * MIN), work(1 * MIN, true), wait(60 * MIN), work(2 * MIN)],
  }],
  ['a gate still held: the outcome has spent no cycle yet, and nothing waits in the sums', {
    started: at('10:00'), factory: GATED, runTransitions: 2, awaiting: { kind: 'gate', stage: 'checks', outcome: 'none' },
    history: [
      { stage: 'intake', outcome: 'pass', task: 0, at: at('10:02') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:12') },
      { stage: 'checks', outcome: 'none', task: 0, at: at('10:13') },
    ],
  }, {
    started: at('10:00'),
    stages: [
      { stage: 'intake', runs: 1, reworks: 0, workMs: 2 * MIN, tokens: null },
      { stage: 'loop:bugfix', runs: 1, reworks: 0, workMs: 10 * MIN, tokens: null },
      { stage: 'checks', runs: 1, reworks: 0, workMs: 1 * MIN, tokens: null },
    ],
    workMs: 13 * MIN, waitMs: 0, tokens: null, transitions: 2,
    entries: [work(2 * MIN), work(10 * MIN), work(1 * MIN)],
  }],
  ['no times: an entry without `at` is null, so is the entry after it, and so is every sum that holds one', {
    factory: FIX, runTransitions: 2, awaiting: null,
    history: [
      { stage: 'plan', outcome: 'pass', task: 0 },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:11') },
      { stage: 'review', outcome: 'pass', task: 0, at: at('10:13') },
    ],
  }, {
    started: null,
    stages: [
      { stage: 'plan', runs: 1, reworks: 0, workMs: null, tokens: null },
      { stage: 'loop:bugfix', runs: 1, reworks: 0, workMs: null, tokens: null },
      { stage: 'review', runs: 1, reworks: 0, workMs: 2 * MIN, tokens: null },
    ],
    workMs: null, waitMs: 0, tokens: null, transitions: 2,
    entries: [work(null), work(null), work(2 * MIN)],
  }],
  ['a fork: a fail routed to `$lane` is a rework, the fork read off the factory\'s own edges', {
    started: at('10:00'), factory: FORKED, runTransitions: 4, awaiting: null,
    history: [
      { stage: 'triage', outcome: 'bug', task: 0, at: at('10:01') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:11') },
      { stage: 'review', outcome: 'fail', task: 0, at: at('10:12') },
      { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:17') },
      { stage: 'review', outcome: 'pass', task: 0, at: at('10:18') },
    ],
  }, {
    started: at('10:00'),
    stages: [
      { stage: 'triage', runs: 1, reworks: 0, workMs: 1 * MIN, tokens: null },
      { stage: 'loop:bugfix', runs: 2, reworks: 0, workMs: 15 * MIN, tokens: null },
      { stage: 'review', runs: 2, reworks: 1, workMs: 2 * MIN, tokens: null },
    ],
    workMs: 18 * MIN, waitMs: 0, tokens: null, transitions: 4,
    entries: [work(1 * MIN), work(10 * MIN), work(1 * MIN, true), work(5 * MIN), work(1 * MIN)],
  }],
];

for (const [name, state, expected] of ROWS) {
  test(`runMetrics — ${name}`, () => assert.deepEqual(runMetrics(state), expected));
}

// The console calls it on a FACTORY.md nobody validated: a state of any shape gives numbers or
// nulls, never a throw. A time that does not parse, or one before its predecessor, is unknown.
test('runMetrics never throws, and reads a bad or backward time as unknown', () => {
  const empty = { started: null, stages: [], workMs: 0, waitMs: 0, tokens: null, transitions: null, entries: [] };
  assert.deepEqual(runMetrics({}), empty);
  assert.deepEqual(runMetrics(null), empty);
  assert.deepEqual(runMetrics({ factory: 'x', history: 'y', started: 7 }), empty);
  assert.deepEqual(runMetrics({ factory: { edges: {}, stages: 5, cycles: 'c' }, history: [null, 5] }).entries, [work(null), work(null)]);
  const m = runMetrics({
    started: at('10:00'), factory: FIX,
    history: [{ stage: 'plan', outcome: 'pass', at: 'yesterday' }, { stage: 'loop:bugfix', outcome: 'pass', at: at('09:00') }],
  });
  assert.deepEqual(m.entries, [work(null), work(null)]);
});
