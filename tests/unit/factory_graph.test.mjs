// tests/unit/factory_graph.test.mjs
// `checkFactory`: each rule refused once, the expected problem list written out in full. The
// catalogue is in memory, so the rows test the rules, not the shipped bricks (factory_cli does
// that). Its `triage` declares named outcomes, which makes it a fork.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkFactory, factoryCatalogProblems, loopOf, isFork, lanesOf } from '../../js/factory/graph.mjs';
import { undeclaredCycles } from '../../js/loop/graph.mjs';
import { factoryProblems } from '../../js/inspect/checks-authoring.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { inferDoneChecks, PM_LOCKS } from '../../js/hosts/done-checks.mjs';
import { countSpecTasks, FACTORY_MAX_TASKS } from '../../js/factory/state.mjs';

const brick = (name, outcomes, extra = {}) => [name, { name, outcomes, effect: 'read', available: true, ...extra }];
const CATALOG = {
  bricks: new Map([
    brick('intake', ['pass', 'fail']), brick('triage', ['bug', 'feature', 'docs', 'fail']), brick('review', ['pass', 'fail']),
    brick('notes', ['pass']),
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

// D11: intake -> triage, a fork whose named outcomes each lead to a lane (two loops and a brick),
// all three joining at review; a failed review routes back to `$lane`, the lane this run took.
const forked = () => ({
  ...base(), stages: ['intake', 'triage', 'loop:bugfix', 'loop:feature', 'notes', 'review'],
  edges: [
    { from: 'intake', on: 'pass', to: 'triage' }, { from: 'intake', on: 'fail', to: '$stop' },
    { from: 'triage', on: 'bug', to: 'loop:bugfix' }, { from: 'triage', on: 'feature', to: 'loop:feature' },
    { from: 'triage', on: 'docs', to: 'notes' }, { from: 'triage', on: 'fail', to: '$stop' },
    { from: 'loop:bugfix', on: 'pass', to: 'review' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'loop:feature', on: 'pass', to: 'review' }, { from: 'loop:feature', on: 'fail', to: '$stop' },
    { from: 'notes', on: 'pass', to: 'review' },
    { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: '$lane' },
  ],
  cycles: [{ name: 'rework', nodes: ['$lane', 'review'], max: 2 }],
});
const routed = (f, from, on, to) => ({ ...f, edges: f.edges.map((e) => (e.from === from && e.on === on ? { ...e, to } : e)) });

// A fork is a brick stage that declares an outcome outside pass, fail, error and none; its lanes
// are the outcomes whose edge reaches a stage (`fail` to $stop is no lane).
test('D11: a fork routes each named outcome to its own lane', () => {
  assert.deepEqual(check(forked()), []);
  assert.equal(isFork('triage', CATALOG.bricks), true);
  for (const s of ['review', 'loop:bugfix', 'nope']) assert.equal(isFork(s, CATALOG.bricks), false, s);
  assert.deepEqual(lanesOf(forked(), 'triage'), { bug: 'loop:bugfix', feature: 'loop:feature', docs: 'notes' });
});

test('D11: a named outcome without its edge is refused like any other', () => {
  const f = forked();
  f.stages = f.stages.filter((s) => s !== 'notes');
  f.edges = f.edges.filter((e) => !(e.from === 'triage' && e.on === 'docs') && e.from !== 'notes');
  assert.deepEqual(check(f), ['stage triage: no edge for outcome docs']);
});

// D13: `$lane` resolves to the stage the run's most recent fork chose, so it needs a fork, and a
// fork on every path to it; a fork's own edge names its lane.
test('D13: $lane needs a fork, a fork before it on every path, and is never a fork\'s own target', () => {
  const noFork = { ...routed(base(), 'review', 'fail', '$lane'), cycles: [{ name: 'rework', nodes: ['$lane', 'review'], max: 2 }] };
  assert.deepEqual(check(noFork), ['$lane: no fork chooses a lane — a fork is a brick stage with a named outcome (triage --bug--> loop:bugfix)']);
  assert.deepEqual(check(routed(forked(), 'intake', 'fail', '$lane')),
    ['edge intake --fail--> $lane: reachable from intake before any fork has chosen a lane']);
  assert.deepEqual(check(routed(forked(), 'triage', 'fail', '$lane')),
    ['edge triage --fail--> $lane: a fork\'s edge names its lane, never $lane']);
});

// D13 + rule 5: a cycle may name `$lane`; it stands for every lane of every fork. As the first
// stage, the run enters the cycle at whichever lane the fork chose, and only a route back to
// `$lane` spends it.
test('D13: a $lane cycle is entered at a lane, laps only through $lane, and must be declared', () => {
  assert.deepEqual(check({ ...forked(), cycles: [{ name: 'rework', nodes: ['review', '$lane'], max: 2 }] }), [
    'cycle rework: entered at loop:bugfix, not at its first stage review',
    'cycle rework: entered at loop:feature, not at its first stage review',
    'cycle rework: entered at notes, not at its first stage review',
  ]);
  // a route back to one lane by name spends no `$lane` cycle: it laps for free
  assert.deepEqual(check(routed(forked(), 'review', 'fail', 'loop:bugfix')), ['cycle loop:bugfix, review laps without spending a declared cycle: '
    + 'a route back must target the first stage of a declared cycle that holds its source']);
  assert.deepEqual(check({ ...forked(), cycles: [] }), ['cycle loop:bugfix, loop:feature, notes, review has no declared cycle around it']);
  // a cycle that holds one lane by name does not cover the route back to the others, and the
  // other lanes enter it at review
  assert.deepEqual(check({ ...forked(), cycles: [{ name: 'rework', nodes: ['loop:bugfix', 'review'], max: 2 }] }), [
    'cycle loop:bugfix, loop:feature, notes, review has no declared cycle around it',
    'cycle rework: entered at review, not at its first stage loop:bugfix',
  ]);
});

// D15: the retired allowlist model is named, with its replacement, never read silently.
test('D15: loop:$triaged and loops are retired, and check names the replacement', () => {
  const old = {
    ...base(), stages: ['intake', 'triage', 'loop:$triaged', 'review'], loops: ['bugfix', 'feature'],
    edges: [
      { from: 'intake', on: 'pass', to: 'triage' }, { from: 'intake', on: 'fail', to: '$stop' },
      { from: 'triage', on: 'pass', to: 'loop:$triaged' }, { from: 'triage', on: 'fail', to: '$stop' },
      { from: 'loop:$triaged', on: 'pass', to: 'review' }, { from: 'loop:$triaged', on: 'fail', to: '$stop' },
      { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: 'loop:$triaged' },
    ],
    cycles: [{ name: 'rework', nodes: ['loop:$triaged', 'review'], max: 2 }],
  };
  assert.deepEqual(check(old), [
    'stage loop:$triaged: retired — list each loop as its own stage, one fork edge per lane (triage --bug--> loop:bugfix), and route back to $lane',
    'edge triage --pass--> loop:$triaged: pass is not an outcome of triage',
    'stage triage: no edge for outcome bug',
    'stage triage: no edge for outcome feature',
    'stage triage: no edge for outcome docs',
    'loops: retired — the lanes are the edges out of a fork (triage --bug--> loop:bugfix)',
  ]);
  assert.deepEqual(check({ ...forked(), loops: [] }), ['loops: retired — the lanes are the edges out of a fork (triage --bug--> loop:bugfix)']);
  // a user's file in that shape reaches the doctor's factory catalogue, prefixed, never skipped
  const sb = makeSandbox('factorygraph-');
  try {
    const dir = path.join(sb.path, '.geneseed', 'factories');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ ...old, name: 'old' }));
    assert.deepEqual(factoryProblems({ projectRoot: sb.path }).filter((p) => p.includes('retired')), [
      'factories/old: loops: retired — the lanes are the edges out of a fork (triage --bug--> loop:bugfix)',
      'factories/old: stage loop:$triaged: retired — list each loop as its own stage, one fork edge per lane (triage --bug--> loop:bugfix), and route back to $lane',
    ]);
  } finally { sb.cleanup(); }
});

test('rule 7: rules, when present, are non-empty strings', () => {
  assert.deepEqual(check({ ...base(), rules: ['Never merge.'] }), []);
  assert.deepEqual(check({ ...base(), rules: ['ok', ' '] }), ['rules: must be a list of non-empty strings']);
  assert.deepEqual(check({ ...base(), rules: 'Never merge.' }), ['rules: must be a list of non-empty strings']);
});

// J5: `needs-info` is intake's question to the user, never a lane, so a brick declaring it beside
// pass and fail is no fork: it gets no `lanes`, and its edge is an ordinary one.
test('J5: needs-info names no lane, so it makes no fork', () => {
  const bricks = new Map([...CATALOG.bricks, brick('intake', ['pass', 'fail', 'needs-info'])]);
  assert.equal(isFork('intake', bricks), false);
  const f = base();
  f.edges.push({ from: 'intake', on: 'needs-info', to: 'loop:bugfix' });
  assert.deepEqual(checkFactory(f, { ...CATALOG, bricks }), []);
});

// Rule 3 and needs-info: the edge may be left out only where the stage has a `pass` edge for
// needs-info to follow (`edgeFor`). A stage that declares needs-info and fail, but no pass, must
// route needs-info itself, or check refuses it.
test('rule 3: needs-info may go without an edge only beside a pass edge', () => {
  const bricks = new Map([...CATALOG.bricks, brick('ask', ['needs-info', 'fail'])]);
  const f = base();
  f.stages.push('ask');
  f.edges.push({ from: 'ask', on: 'fail', to: '$stop' });
  assert.deepEqual(checkFactory(f, { ...CATALOG, bricks }), ['stage ask: no edge for outcome needs-info']);
  const withPass = new Map([...CATALOG.bricks, brick('intake', ['pass', 'fail', 'needs-info'])]);
  assert.deepEqual(checkFactory(base(), { ...CATALOG, bricks: withPass }), []);
});

// Rule 8: `protected` adds paths `checks` refuses to see changed; absent is fine, any other shape not.
test('rule 8: protected, when present, is a list of non-empty paths', () => {
  assert.deepEqual(check({ ...base(), protected: ['infra/', 'Makefile'] }), []);
  assert.deepEqual(check({ ...base(), protected: ['infra/', ''] }), ['protected: must be a list of non-empty paths']);
  assert.deepEqual(check({ ...base(), protected: 'infra/' }), ['protected: must be a list of non-empty paths']);
});

// Rule 9 (J3): the review panel's seat table. Every size has a non-empty list, `areas` maps each
// area to one, and every seat is an agent the catalogue ships. A catalogue that lists no agents
// fails every seat: the rule fails closed.
test('rule 9: review.seats names a list per size, and only shipped agents', () => {
  const agents = new Set(['reviewer', 'tester', 'steward', 'security']);
  const seats = () => ({ small: ['reviewer'], medium: ['reviewer', 'tester'], large: ['reviewer', 'tester', 'steward'], areas: { security: ['security'] } });
  const withSeats = (s) => checkFactory({ ...base(), review: { seats: s } }, { ...CATALOG, agents });
  assert.deepEqual(withSeats(seats()), []);
  assert.deepEqual(withSeats({ ...seats(), medium: ['reviewer', 'ghost'], areas: { ui: ['nobody'] } }), [
    'review.seats.medium: no agent named ghost',
    'review.seats.areas.ui: no agent named nobody',
  ]);
  const { large: _large, ...noLarge } = seats();
  assert.deepEqual(withSeats({ ...noLarge, small: [] }), [
    'review.seats.small: must be a non-empty list of agent names',
    'review.seats.large: must be a non-empty list of agent names',
  ]);
  assert.deepEqual(withSeats({ ...seats(), areas: ['security'] }), ['review.seats.areas: must map each area to a list of agents']);
  assert.deepEqual(checkFactory({ ...base(), review: { small: ['reviewer'] } }, { ...CATALOG, agents }),
    ['review: must be an object with a seats table']);
  assert.deepEqual(check({ ...base(), review: { seats: { small: ['reviewer'], medium: ['reviewer'], large: ['reviewer'] } } }), [
    'review.seats.small: no agent named reviewer',
    'review.seats.medium: no agent named reviewer',
    'review.seats.large: no agent named reviewer',
  ]);
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

// One writer per value: `inferDoneChecks` (js/hosts/done-checks.mjs) is the writer of the
// manifest -> command rules, and the `checks` brick restates them because it runs in a user's
// repo, where that module does not exist. So every command the writer infers, for each manifest
// kind and each package manager, must be named in the brick, with the two exclusions it applies,
// and every lockfile it reads, in its order. One mapping on purpose: the done gate's `go test` is
// the brick's `go test ./...` — the brick RUNS the command, and bare `go test` tests only the root
// package.
test('the checks brick names every command inferDoneChecks infers', () => {
  const brick = readFileSync(path.resolve(import.meta.dirname, '../../src/bricks/checks.md'), 'utf8');
  const scripts = JSON.stringify({ scripts: { test: 'x', lint: 'x', typecheck: 'x' } });
  const kinds = {
    npm: { 'package.json': scripts },
    pnpm: { 'package.json': scripts, 'pnpm-lock.yaml': '' },
    yarn: { 'package.json': scripts, 'yarn.lock': '' },
    bun: { 'package.json': scripts, 'bun.lock': '' },
    maven: { 'pom.xml': '' },
    gradle: { 'build.gradle': '' },
    gradleKts: { 'build.gradle.kts': '' },
    python: { 'pyproject.toml': '[tool.pytest.ini_options]\n' },
    cargo: { 'Cargo.toml': '' },
    go: { 'go.mod': '' },
  };
  const sb = makeSandbox('checksbrick-');
  try {
    const seen = [];
    for (const [kind, files] of Object.entries(kinds)) {
      const dir = path.join(sb.path, kind);
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
      const labels = inferDoneChecks(dir).checks.map((c) => c.label);
      assert.ok(labels.length, `${kind}: the fixture infers nothing`);
      for (const label of labels) {
        const l = label === 'go test' ? 'go test ./...' : label;
        seen.push(l); assert.ok(brick.includes(`\`${l}\``), `${kind}: the brick does not name \`${l}\``);
      }
    }
    assert.equal(seen.length, 18, 'four package managers x three scripts, plus six other manifest fixtures');
    const at = PM_LOCKS.map(([lock]) => brick.indexOf(`\`${lock}\``));
    assert.ok(at.every((i) => i >= 0), `the brick names every lockfile: ${PM_LOCKS.map(([l]) => l).join(', ')}`);
    assert.deepEqual(at, [...at].sort((x, y) => x - y), 'the brick lists the lockfiles in the order inferDoneChecks tries them');
    // the exclusions the writer applies, named in the brick: the npm stub, and pytest only where it shows
    writeFileSync(path.join(sb.path, 'npm', 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    assert.deepEqual(inferDoneChecks(path.join(sb.path, 'npm')).checks, []);
    assert.ok(brick.includes('no test specified'));
    writeFileSync(path.join(sb.path, 'python', 'pyproject.toml'), '[project]\nname = "x"\n');
    assert.deepEqual(inferDoneChecks(path.join(sb.path, 'python')).checks, []);
    assert.ok(brick.includes('only where pytest shows'));
  } finally { sb.cleanup(); }
});

// D9: every shipped factory carries the default seat table. small: reviewer; medium adds tester;
// large adds steward; area security or data seats security, performance seats performance, ui
// seats user-advocate.
test('D9: the three shipped factories carry the default review seat table', () => {
  const D9 = {
    seats: {
      small: ['reviewer'], medium: ['reviewer', 'tester'], large: ['reviewer', 'tester', 'steward'],
      areas: { security: ['security'], performance: ['performance'], ui: ['user-advocate'], data: ['security'] },
    },
  };
  for (const name of ['analysis-to-build', 'bug-report-to-fix', 'issue-to-pr']) {
    const file = path.resolve(import.meta.dirname, '../../src/factories', `${name}.json`);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).review, D9, name);
  }
});

// G1: a loop run as a factory stage shares its worktree with FACTORY.md. Every stash the loop
// skill gives must keep BOTH engine files out of it: stashed, an untracked FACTORY.md is lost,
// and a tracked one rolls its counters and launch back.
const shipped = (rel) => readFileSync(path.resolve(import.meta.dirname, '../../src', rel), 'utf8');
test('G1: every stash in the loop skill keeps LOOP.md and FACTORY.md out of it', () => {
  const stashes = shipped('skills/loop.md').split('\n').filter((l) => /stash -u/.test(l));
  assert.equal(stashes.length, 1, 'the loop skill stashes in one place: the discard');
  for (const l of stashes) {
    assert.ok(l.includes(':^LOOP.md') && l.includes(':^FACTORY.md'), `stashes an engine file: ${l}`);
  }
});

// G4: in the `docs` lane no loop runs, so nothing ever commits FACTORY.md, and `git rm -f` on it
// exits 128. The close step names the untracked case, and commits only when there is a change.
// A text check: it holds the step's wording, not an agent's reading of it.
test('G4: the factory close step removes FACTORY.md tracked or not, and commits only a change', () => {
  const close = shipped('skills/factory.md').split(/\n(?=\d+\. )/).find((s) => s.startsWith('8. On `$close`'));
  assert.ok(close, 'the factory skill has its close step');
  assert.match(close, /`git rm -f FACTORY\.md` when git tracks it/);
  assert.match(close, /else delete the file/);
  assert.match(close, /Commit and push only when\s+`git status --porcelain` then shows the removal/);
});

// G5: the `spec` brick states the task format `countSpecTasks` counts, and a list written the way
// the brick says is counted in full. The limit is never typed: bricks render no count token, so
// the brick refers to it in words, and the engine's refusal names it. And the brick speaks of the
// factory's own wiring: the run's slug, and an amend that arrives as the stage's `carry`.
test('G5: the spec brick states the task format the factory counts, and never types the limit', () => {
  const brick = shipped('bricks/spec.md').replace(/\s+/g, ' ');
  for (const rule of ['first heading that contains the word `task` or `tasks`', '`1.` or `1)`', 'indented 3 spaces at most',
    'A sub-item or a deeper indent is not a task', 'A deeper heading keeps the list open',
    'the next heading of the same or a higher level ends it', 'the factory\'s task limit',
    'the factory run\'s `<slug>`', 'stage\'s `carry`']) {
    assert.ok(brick.includes(rule), `the spec brick does not say: ${rule}`);
  }
  assert.doesNotMatch(brick, new RegExp(`\\b${FACTORY_MAX_TASKS}\\b`), 'the brick types the task limit');
  assert.doesNotMatch(brick, /the slug of the loop's title\) and|A gate amendment in LOOP\.md's notes/);
  // the format as the brick words it, counted by the engine: two tasks, a sub-item and a deeper
  // heading between them, then a sibling heading that ends the list
  const spec = '# Spec\n\n## Ordered tasks\n\n1. Parse\n   - detail\n### Note\n2) Verify end to end\n\n## Out of scope\n3. not a task\n';
  assert.equal(countSpecTasks(spec), 2);
});
