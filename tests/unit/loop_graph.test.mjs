// One planted fault per rule of spec §4.3; each expected problem string is written out, so a
// reworded message is a deliberate change to this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGraph, iterationLoop } from '../../js/loop/graph.mjs';

const b = (name, effect, outcomes, available = true) =>
  [name, { name, effect, outcomes, available, reason: available ? undefined : 'skill x is not shipped' }];
const BRICKS = new Map([
  b('reproduce', 'mutate', ['pass', 'fail']), b('identify', 'read', ['more', 'done']),
  b('apply', 'mutate', ['pass']), b('test', 'read', ['pass', 'fail']),
  b('review', 'read', ['pass', 'fail']), b('ghost', 'read', ['pass'], false),
]);
const bugfix = () => ({
  name: 'bugfix', description: 'd',
  nodes: ['reproduce', 'identify', 'apply', 'test', 'review'], start: 'reproduce',
  edges: [
    { from: 'reproduce', on: 'pass', to: 'identify' }, { from: 'reproduce', on: 'fail', to: '$stop' },
    { from: 'identify', on: 'more', to: 'apply' }, { from: 'identify', on: 'done', to: '$close' },
    { from: 'apply', on: 'pass', to: 'test' },
    { from: 'test', on: 'fail', to: 'apply' }, { from: 'test', on: 'pass', to: 'review' },
    { from: 'review', on: 'pass', to: 'identify' }, { from: 'review', on: 'fail', to: 'apply' },
  ],
  loops: [
    { name: 'iterations', nodes: ['identify', 'apply', 'test', 'review'], max: 20, iteration: true },
    { name: 'apply-test', nodes: ['apply', 'test'], max: 5 },
    { name: 'review-fix', nodes: ['apply', 'test', 'review'], max: 3 },
  ],
});

test('the shipped bugfix shape is clean', () => {
  assert.deepEqual(checkGraph(bugfix(), BRICKS), []);
  assert.equal(iterationLoop(bugfix()).name, 'iterations');
});

test('rule 1 — unknown and unavailable bricks, dangling edges', () => {
  const g = bugfix(); g.nodes.push('nope', 'ghost');
  g.edges.push({ from: 'nope', on: 'pass', to: 'identify' }, { from: 'ghost', on: 'pass', to: 'elsewhere' });
  assert.deepEqual(checkGraph(g, BRICKS), [
    'node nope: no brick named nope',
    'node ghost: brick unavailable (skill x is not shipped)',
    'edge ghost --pass--> elsewhere: elsewhere is not a node, $close or $stop',
  ]);
});

test('rule 2 — every declared outcome has exactly one edge, and edges use declared outcomes', () => {
  const g = bugfix();
  g.edges = g.edges.filter((e) => !(e.from === 'test' && e.on === 'fail'));
  g.edges.push({ from: 'review', on: 'pass', to: 'apply' }, { from: 'apply', on: 'fail', to: 'apply' });
  assert.deepEqual(checkGraph(g, BRICKS), [
    'edge apply --fail--> apply: fail is not an outcome of apply',
    'node review: 2 edges for outcome pass',
    'node test: no edge for outcome fail',
  ]);
});

test('rule 3 — start is a node and $close is reachable', () => {
  const g = bugfix(); g.start = 'nowhere';
  assert.deepEqual(checkGraph(g, BRICKS), ['start nowhere is not a node']);
  const h = bugfix(); h.edges.find((e) => e.on === 'done').to = '$stop';
  assert.deepEqual(checkGraph(h, BRICKS), ['$close is not reachable from reproduce']);
});

test('rule 4 — every cycle lies inside a declared loop with a max', () => {
  const g = bugfix(); g.loops = g.loops.filter((l) => l.name !== 'apply-test');
  // apply⇄test is still inside the iteration loop, so it is bounded; drop that too:
  g.loops[0].nodes = ['identify', 'review'];
  // Shrinking the iteration to [identify, review] also makes test -> review an entry into the
  // iteration that is not its head (rule 4c, I3) — a second, independent fault of this graph.
  assert.deepEqual(checkGraph(g, BRICKS), [
    'cycle apply, identify, review, test has no declared loop around it',
    'edge test --pass--> review enters the iteration at review, not at its head identify',
  ]);
});

test('rule 4b — a cycle inside an iteration that never reaches the head needs its own inner loop', () => {
  const g = bugfix(); g.loops = g.loops.filter((l) => l.name !== 'review-fix');
  // apply/test alone are still bounded by apply-test; review -> apply is not covered by any
  // non-iteration loop once review-fix is gone, even though the whole-unit SCC check (rule 4)
  // is satisfied by the iteration loop itself.
  assert.deepEqual(checkGraph(g, BRICKS), [
    'cycle apply, review, test inside an iteration has no inner loop around it',
  ]);
});

test('rule 5 — exactly one iteration loop, max within the engine ceiling, sane loops', () => {
  const g = bugfix(); g.loops[0].max = 21; g.loops[1].iteration = true;
  g.loops.push({ name: 'bad', nodes: ['zzz'], max: 0 });
  assert.deepEqual(checkGraph(g, BRICKS), [
    'loop iterations: max 21 is above the engine ceiling of 20',
    'loop bad: max must be a positive integer',
    'loop bad: zzz is not a node',
    '2 loops are marked iteration; exactly one must be',
  ]);
});

test('weights may only override known actions', () => {
  const g = bugfix(); g.weights = { logic: 0.6, vibes: 1 };
  assert.deepEqual(checkGraph(g, BRICKS), ['weights: vibes is not an action']);
});

// I3: the runtime closes a unit whenever the graph re-enters the iteration loop's FIRST node, so
// a graph that enters the iteration anywhere else would run a whole unit with no head behind it
// (no card from identify, a commit boundary in the wrong place). Every edge entering the
// iteration from outside it — and `start`, when it is inside — must target nodes[0].
test('I3 — the iteration is entered only at its head (the first node listed)', () => {
  const g = bugfix(); g.loops[0].nodes = ['apply', 'test', 'review', 'identify'];
  assert.deepEqual(checkGraph(g, BRICKS), [
    'edge reproduce --pass--> identify enters the iteration at identify, not at its head apply',
  ]);
  const h = bugfix(); h.start = 'identify'; h.loops[0].nodes = ['apply', 'test', 'review', 'identify'];
  // reproduce is now unreachable but still a node: its edge still enters the iteration
  assert.deepEqual(checkGraph(h, BRICKS), [
    'start identify is inside the iteration but is not its head apply',
    'edge reproduce --pass--> identify enters the iteration at identify, not at its head apply',
  ]);
});
