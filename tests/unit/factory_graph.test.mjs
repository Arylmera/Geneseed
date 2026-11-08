// tests/unit/factory_graph.test.mjs
// `checkFactory`: each rule refused once, the expected problem list written out in full. The
// catalogue is in memory — a `triage` brick does not ship yet, and the triaged-loop rules still
// need one — so the rows test the rules, not the shipped bricks (factory_cli does that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { checkFactory, factoryCatalogProblems, loopOf } from '../../js/factory/graph.mjs';
import { undeclaredCycles } from '../../js/loop/graph.mjs';
import { factoryProblems } from '../../js/inspect/checks-authoring.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const brick = (name, outcomes, extra = {}) => [name, { name, outcomes, effect: 'read', available: true, ...extra }];
const CATALOG = {
  bricks: new Map([
    brick('intake', ['pass', 'fail']), brick('triage', ['pass', 'fail']), brick('review', ['pass', 'fail']),
    brick('probe', ['pass', 'fail', 'error']), brick('gone', ['pass'], { available: false, reason: 'agent x is not shipped' }),
  ]),
  templates: new Map([['bugfix', {}], ['feature', {}]]),
};
// intake -> loop:bugfix -> review -> $close; review fail sends the item back to the loop.
const base = () => ({
  name: 'f', description: 'd', start: 'intake', stages: ['intake', 'loop:bugfix', 'review'],
  edges: [
    { from: 'intake', on: 'pass', to: 'loop:bugfix' }, { from: 'intake', on: 'fail', to: '$stop' },
    { from: 'loop:bugfix', on: 'pass', to: 'review' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: 'loop:bugfix' },
  ],
  cycles: [{ name: 'rework', nodes: ['loop:bugfix', 'review'], max: 2 }],
});
const check = (f) => checkFactory(f, CATALOG);

test('a well-formed factory has no problems', () => {
  assert.deepEqual(check(base()), []);
});

test('loopOf names the template of a loop stage, null for a brick stage', () => {
  assert.equal(loopOf('loop:bugfix'), 'bugfix');
  assert.equal(loopOf('loop:$triaged'), '$triaged');
  assert.equal(loopOf('review'), null);
});

test('rule 1: a stage is an available brick or an existing loop template', () => {
  const f = base();
  f.stages.push('nope', 'gone', 'loop:missing');
  f.edges.push({ from: 'gone', on: 'pass', to: '$close' }, { from: 'loop:missing', on: 'pass', to: '$close' },
    { from: 'loop:missing', on: 'fail', to: '$stop' });
  assert.deepEqual(check(f), [
    'stage nope: no brick named nope',
    'stage gone: brick unavailable (agent x is not shipped)',
    'stage loop:missing: no loop template named missing',
  ]);
});

test('rule 2: edge endpoints are stages, and the outcome is the source\'s', () => {
  const f = base();
  f.edges.push({ from: 'ghost', on: 'pass', to: '$close' }, { from: 'intake', on: 'pass', to: 'elsewhere' },
    { from: 'loop:bugfix', on: 'more', to: 'review' });
  assert.deepEqual(check(f), [
    'edge ghost --pass--> $close: ghost is not a stage',
    'edge intake --pass--> elsewhere: elsewhere is not a stage, $close or $stop',
    'edge loop:bugfix --more--> review: more is not an outcome of loop:bugfix',
    // the bad-target edge still counts as intake's second `pass` edge (rule 3), as in a loop graph
    'stage intake: 2 edges for outcome pass',
  ]);
});

// A loop stage's outcomes are pass and fail; `error` alone may go without an edge.
test('rule 3: exactly one edge per outcome, error exempt', () => {
  const f = base();
  f.edges = f.edges.filter((e) => !(e.from === 'loop:bugfix' && e.on === 'fail'));
  f.edges.push({ from: 'review', on: 'pass', to: '$stop' });
  f.stages.push('probe');
  f.edges.push({ from: 'probe', on: 'pass', to: '$close' }, { from: 'probe', on: 'fail', to: '$stop' });
  assert.deepEqual(check(f), [
    'stage loop:bugfix: no edge for outcome fail',
    'stage review: 2 edges for outcome pass',
  ]);
});

test('rule 4: start is a stage, and $close is reachable from it', () => {
  assert.deepEqual(check({ ...base(), start: 'nowhere' }), ['start nowhere is not a stage']);
  const f = base();
  f.edges = f.edges.map((e) => (e.to === '$close' ? { ...e, to: '$stop' } : e));
  assert.deepEqual(check(f), ['$close is not reachable from intake']);
});

test('rule 5: a cycle\'s max is 1 to 5, its nodes are stages, and every cycle is declared', () => {
  for (const max of [0, 6, 1.5, '2']) {
    assert.deepEqual(check({ ...base(), cycles: [{ name: 'rework', nodes: ['loop:bugfix', 'review'], max }] }),
      ['cycle rework: max must be an integer from 1 to 5'], `max ${JSON.stringify(max)}`);
  }
  assert.deepEqual(check({ ...base(), cycles: [{ name: 'rework', nodes: ['loop:bugfix', 'review', 'ghost'], max: 5 }] }),
    ['cycle rework: ghost is not a stage']);
  assert.deepEqual(check({ ...base(), cycles: [] }), ['cycle loop:bugfix, review has no declared cycle around it']);
  // A declared cycle that holds only part of the graph's cycle does not cover it.
  assert.deepEqual(check({ ...base(), cycles: [{ name: 'half', nodes: ['review'], max: 1 }] }),
    ['cycle loop:bugfix, review has no declared cycle around it']);
});

// The engine spends a cycle on an edge whose target is the cycle's first stage and whose source
// it holds (`js/factory/state.mjs`). So a cycle is entered at its first stage only, and every lap
// around the graph crosses such an edge: anything else spends on the wrong edge, or never.
test('rule 5: a cycle is entered at its first stage, and every lap spends a declared cycle', () => {
  // the review's shape: entered at loop:bugfix, so the forward edge into review spent the cycle
  // and the first review of the run already counted as a rework lap
  assert.deepEqual(check({ ...base(), cycles: [{ name: 'rework', nodes: ['review', 'loop:bugfix'], max: 2 }] }),
    ['cycle rework: entered at loop:bugfix, not at its first stage review']);
  // a route back into the middle of a cycle: review <-> probe laps without crossing loop:bugfix
  const mid = base();
  mid.stages.push('probe');
  mid.edges = mid.edges.map((e) => (e.from === 'review' && e.on === 'fail' ? { ...e, to: 'probe' } : e));
  mid.edges.push({ from: 'probe', on: 'pass', to: 'review' }, { from: 'probe', on: 'fail', to: 'loop:bugfix' });
  mid.cycles = [{ name: 'rework', nodes: ['loop:bugfix', 'review', 'probe'], max: 2 }];
  assert.deepEqual(check(mid), ['cycle probe, review laps without spending a declared cycle: '
    + 'a route back must target the first stage of a declared cycle that holds its source']);
  // the same lap declared as its own nested cycle is spent, so the graph is accepted
  assert.deepEqual(check({ ...mid, cycles: [...mid.cycles, { name: 'probe-again', nodes: ['review', 'probe'], max: 1 }] }), []);
  // a cycle may start at the factory's start: the run enters it there
  const redo = {
    name: 'redo', start: 'intake', stages: ['intake', 'loop:feature', 'review'],
    edges: [
      { from: 'intake', on: 'pass', to: 'loop:feature' }, { from: 'intake', on: 'fail', to: '$stop' },
      { from: 'loop:feature', on: 'pass', to: 'review' }, { from: 'loop:feature', on: 'fail', to: '$stop' },
      { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: 'intake' },
    ],
    cycles: [{ name: 'redo', nodes: ['intake', 'loop:feature', 'review'], max: 1 }],
  };
  assert.deepEqual(check(redo), []);
  assert.deepEqual(check({ ...redo, cycles: [{ name: 'redo', nodes: ['review', 'intake', 'loop:feature'], max: 1 }] }),
    ['cycle redo: entered at intake, not at its first stage review']);
});

// Rule 0, the shape every later rule assumes; a malformed cycle is left out of them, never thrown on.
test('rule 0: a factory has a name, each cycle a string name and a list of nodes, no stage twice', () => {
  assert.deepEqual(check({ ...base(), name: undefined }), ['name: must be a non-empty string']);
  assert.deepEqual(check({ ...base(), name: ' ' }), ['name: must be a non-empty string']);
  assert.deepEqual(check({ ...base(), stages: [...base().stages, 'review'] }), ['stages: review is listed twice']);
  const bad = base();
  bad.cycles.push(null, { name: 7, nodes: ['review'], max: 1 }, { name: 'str', nodes: 'review', max: 1 });
  assert.deepEqual(check(bad), [
    'cycles: entry 2 must have a string name and a list of nodes',
    'cycles: entry 3 must have a string name and a list of nodes',
    'cycles: entry 4 must have a string name and a list of nodes',
  ]);
});

// F5: checkFactory never throws, so a malformed edge is reported once by the shape rule and left
// out of every later rule (its outcome then reads as unrouted, which rule 3 reports as such).
test('rule 0: each edge has a string from, on and to; a malformed one never throws', () => {
  const bad = base();
  bad.edges.push(null, 7, { from: 'review', on: 'pass' }, { on: 'pass', to: '$close' });
  assert.deepEqual(check(bad), [
    'edges: entry 7 must have a string from, on and to',
    'edges: entry 8 must have a string from, on and to',
    'edges: entry 9 must have a string from, on and to',
    'edges: entry 10 must have a string from, on and to',
  ]);
  for (const factory of [null, [], 'f']) assert.deepEqual(check(factory), ['factory: must be an object']);
});

// The loop engine's rule 4, exported for the factory graph: the components no declared set holds.
test('undeclaredCycles returns each uncovered cycle as its sorted node names', () => {
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'c', to: 'c' }, { from: 'b', to: 'c' }];
  assert.deepEqual(undeclaredCycles(['a', 'b', 'c'], edges, []), ['c', 'a, b']);
  assert.deepEqual(undeclaredCycles(['a', 'b', 'c'], edges, [{ nodes: ['a', 'b'] }]), ['c']);
  assert.deepEqual(undeclaredCycles(['a', 'b', 'c'], edges, [{ nodes: ['a', 'b'] }, { nodes: ['c'] }]), []);
});

// intake -> triage -> loop:$triaged: the triage record names the loop, from the allowlist.
const triaged = () => ({
  ...base(), stages: ['intake', 'triage', 'loop:$triaged', 'review'], loops: ['bugfix', 'feature'],
  edges: [
    { from: 'intake', on: 'pass', to: 'triage' }, { from: 'intake', on: 'fail', to: '$stop' },
    { from: 'triage', on: 'pass', to: 'loop:$triaged' }, { from: 'triage', on: 'fail', to: '$stop' },
    { from: 'loop:$triaged', on: 'pass', to: 'review' }, { from: 'loop:$triaged', on: 'fail', to: '$stop' },
    { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: 'loop:$triaged' },
  ],
  cycles: [{ name: 'rework', nodes: ['loop:$triaged', 'review'], max: 2 }],
});

test('rule 6: the triaged loop needs a non-empty allowlist of templates, behind a triage stage', () => {
  assert.deepEqual(check(triaged()), []);
  assert.deepEqual(check({ ...triaged(), loops: ['bugfix', 'nope'] }), ['loops: no loop template named nope']);
  assert.deepEqual(check({ ...triaged(), loops: [] }), ['loop:$triaged: loops must list at least one loop template']);
  // intake routes straight to the triaged loop on fail: a path that skips triage.
  const skip = triaged();
  skip.edges = skip.edges.map((e) => (e.from === 'intake' && e.on === 'fail' ? { ...e, to: 'loop:$triaged' } : e));
  assert.deepEqual(check(skip), ['loop:$triaged: reachable from intake without passing through triage']);
  // No triage stage at all: intake goes to the triaged loop directly.
  const none = triaged();
  none.stages = none.stages.filter((s) => s !== 'triage');
  none.edges = none.edges.filter((e) => e.from !== 'triage').map((e) => (e.to === 'triage' ? { ...e, to: 'loop:$triaged' } : e));
  assert.deepEqual(check(none), ['loop:$triaged: needs a triage stage before it']);
});

test('rule 7: rules, when present, are non-empty strings', () => {
  assert.deepEqual(check({ ...base(), rules: ['Never merge.'] }), []);
  assert.deepEqual(check({ ...base(), rules: ['ok', ' '] }), ['rules: must be a list of non-empty strings']);
  assert.deepEqual(check({ ...base(), rules: 'Never merge.' }), ['rules: must be a list of non-empty strings']);
});

test('factoryCatalogProblems prefixes each factory, after the parse problems, sorted', () => {
  const broken = { ...base(), start: 'nowhere' };
  assert.deepEqual(factoryCatalogProblems({
    ...CATALOG, factories: new Map([['zeta', base()], ['alpha', broken]]), factoryProblems: ['factories/x.json: not JSON'],
  }), ['factories/alpha: start nowhere is not a stage', 'factories/x.json: not JSON']);
});

// The doctor arm: clean over what ships (no factory ships yet), red over the broken fixture
// placed at the project level of a sandbox — the same function, not a copy of it.
test('the doctor\'s factoryProblems is clean over the shipped tree and red over a broken factory', () => {
  assert.deepEqual(factoryProblems(), []);
  const sb = makeSandbox('factorygraph-');
  try {
    const dir = path.join(sb.path, '.geneseed', 'factories');
    mkdirSync(dir, { recursive: true });
    for (const f of ['fixture-fix', 'fixture-broken']) {
      copyFileSync(path.resolve(import.meta.dirname, '../fixtures/factories', `${f}.json`), path.join(dir, `${f}.json`));
    }
    assert.deepEqual(factoryProblems({ projectRoot: sb.path }), [
      'factories/fixture-broken: cycle loop:nope, review has no declared cycle around it',
      'factories/fixture-broken: stage loop:nope: no loop template named nope',
    ]);
  } finally { sb.cleanup(); }
});
