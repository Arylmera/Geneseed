// tests/unit/loop_state.test.mjs
// Scenarios, each a script of engine calls with the expected result written after every call.
// The trailer block is written out byte for byte: it is what lands in a user's git history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initState, nextStep, scoreDeclared, scoreDiff, recordOutcome, decideAwaiting,
  renderLoopFile, parseLoopFile, trailers,
} from '../../js/loop/state.mjs';

const brick = (name, effect, outcomes) => [name, { name, effect, outcomes, agent: 'tester', skill: null, body: `do ${name}`, available: true }];
const BRICKS = new Map([
  brick('reproduce', 'mutate', ['pass', 'fail']), brick('identify', 'read', ['more', 'done']),
  brick('apply', 'mutate', ['pass']), brick('test', 'read', ['pass', 'fail']), brick('review', 'read', ['pass', 'fail']),
]);
const bugfix = () => ({
  name: 'bugfix', description: 'd', nodes: ['reproduce', 'identify', 'apply', 'test', 'review'], start: 'reproduce',
  edges: [
    { from: 'reproduce', on: 'pass', to: 'identify' }, { from: 'reproduce', on: 'fail', to: '$stop' },
    { from: 'identify', on: 'more', to: 'apply' }, { from: 'identify', on: 'done', to: '$close' },
    { from: 'apply', on: 'pass', to: 'test' }, { from: 'test', on: 'fail', to: 'apply' },
    { from: 'test', on: 'pass', to: 'review' }, { from: 'review', on: 'pass', to: 'identify' },
    { from: 'review', on: 'fail', to: 'apply' },
  ],
  loops: [
    { name: 'iterations', nodes: ['identify', 'apply', 'test', 'review'], max: 20, iteration: true },
    { name: 'apply-test', nodes: ['apply', 'test'], max: 5 },
  ],
});
const start = (preset = 'balanced') => initState({ title: 't', requirement: 'r', graph: bugfix(), preset });
const card = { intent: 'fix rounding', writeSet: ['src/a.js'], actions: ['logic'] };
const file = (f, deleted = 0) => ({ file: f, added: 3, deleted });

test('happy path: setup unit 0, then iteration 1, then done', () => {
  const s = start();
  assert.equal(s.iteration, 0);
  let n = nextStep(s, BRICKS);
  assert.equal(n.node, 'reproduce'); assert.equal(n.validate, true); assert.equal(n.prompt, 'do reproduce');
  assert.deepEqual(scoreDeclared(s, { actions: ['new-file'], writeSet: ['test/a.test.js'], intent: 'reproduce' }),
    { score: 0.4, preset: 'balanced', threshold: [0.2, 0.6], decision: 'soft' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass', { porcelain: '?? test/a.test.js' }), { verify: true });
  n = nextStep(s, BRICKS);
  assert.deepEqual(n, { verify: true, iteration: 0, run: 'git add -A && git diff --cached --numstat | geneseed loop score --diff' });
  const c = scoreDiff(s, [file('test/a.test.js')]);
  assert.equal(c.commit, true);
  assert.equal(c.trailers, [
    'Loop-Iteration: 0', 'Loop-Bricks: reproduce', 'Loop-Risk-Declared: 0.4', 'Loop-Risk-Actual: 0.4',
    'Loop-Threshold: balanced 0.2/0.6', 'Loop-Decision: soft', 'Loop-Tests: n/a',
  ].join('\n'));
  assert.equal(s.iteration, 1); assert.equal(s.node, 'identify');

  assert.deepEqual(recordOutcome(s, BRICKS, 'more', { card, porcelain: '' }), { node: 'apply' });
  assert.equal(nextStep(s, BRICKS).validate, true);
  assert.equal(scoreDeclared(s).decision, 'soft');
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass', { porcelain: ' M src/a.js' }), { node: 'test' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass', { porcelain: ' M src/a.js' }), { node: 'review' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass', { porcelain: ' M src/a.js' }), { verify: true });
  const c2 = scoreDiff(s, [file('src/a.js')]);
  assert.match(c2.trailers, /^Loop-Iteration: 1\nLoop-Bricks: identify,apply,test,review\n/);
  assert.match(c2.trailers, /Loop-Tests: pass$/);
  assert.deepEqual(recordOutcome(s, BRICKS, 'done', { porcelain: '' }), { done: true });
  const t = nextStep(s, BRICKS);
  assert.equal(t.terminal, '$close');
  assert.deepEqual(t.summary.review, [{ iteration: 0, intent: 'reproduce' }, { iteration: 1, intent: 'fix rounding' }]);
});

test('a mutate node cannot be recorded before its declared score', () => {
  const s = start();
  assert.throws(() => recordOutcome(s, BRICKS, 'pass'), /reproduce modifies code: run `geneseed loop score --declared`/);
});

test('blocking before apply waits, and ok resumes', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card: { ...card, actions: ['api'] } });
  assert.equal(scoreDeclared(s).decision, 'blocking');
  assert.equal(s.status, 'awaiting');
  assert.deepEqual(nextStep(s, BRICKS).awaiting.kind, 'declared');
  assert.deepEqual(decideAwaiting(s, BRICKS, 'ok'), { resumed: true });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'test' });
});

test('declared "no" drops the iteration back to identify with a note', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card: { ...card, actions: ['architecture'] } });
  scoreDeclared(s);
  assert.deepEqual(decideAwaiting(s, BRICKS, 'no', 'too broad'), { dropped: true });
  assert.equal(s.node, 'identify'); assert.equal(s.card, null);
  assert.deepEqual(s.notes, ['iteration 1 (declared, no): too broad']);
});

test('the diff escalates to blocking; ok commits with the actual score', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card });
  scoreDeclared(s);
  recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  assert.deepEqual(scoreDiff(s, [file('src/a.js'), file('src/b.js')]),
    { score: 0.8, decision: 'blocking', reasons: ['outside the write set: src/b.js'], commit: false });
  const c = decideAwaiting(s, BRICKS, 'ok');
  assert.equal(c.commit, true);
  assert.match(c.trailers, /Loop-Risk-Declared: 0\.4\nLoop-Risk-Actual: 0\.8\n.*\nLoop-Decision: blocking/s);
});

test('inner ring: 5 retries allowed, the 6th re-splits once, the next exhaustion stops', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  const drive = () => {
    recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
    recordOutcome(s, BRICKS, 'pass');                        // apply → test
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(recordOutcome(s, BRICKS, 'fail'), { node: 'apply' });   // retry i+1
      recordOutcome(s, BRICKS, 'pass');                      // apply → test
    }
    return recordOutcome(s, BRICKS, 'fail');                 // 6th return to apply
  };
  assert.deepEqual(drive(), { discard: true, resplit: true });
  assert.equal(s.node, 'identify'); assert.equal(s.resplit, true);
  assert.deepEqual(drive(), { stopped: 'apply-test exhausted its max of 5 twice in iteration 1' });
  assert.equal(s.status, 'stopped');
});

test('a read brick that changes the tree stops the loop', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1; s.snapshot = '';
  assert.deepEqual(recordOutcome(s, BRICKS, 'more', { card, porcelain: ' M x.js' }),
    { stopped: 'read-brick-wrote: identify changed the working tree' });
});

test('two empty iterations in a row stop the loop', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  const emptyUnit = () => {
    recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
    recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
    return scoreDiff(s, []);
  };
  assert.deepEqual(emptyUnit(), { empty: true, commit: false });
  assert.deepEqual(emptyUnit(), { stopped: 'two consecutive iterations produced no diff' });
});

test('prudent waits for the graph before anything runs', () => {
  const s = start('prudent');
  assert.deepEqual(nextStep(s, BRICKS), { awaiting: { kind: 'launch' }, preset: 'prudent' });
  assert.deepEqual(decideAwaiting(s, BRICKS, 'ok'), { resumed: true });
  assert.equal(nextStep(s, BRICKS).node, 'reproduce');
});

test('LOOP.md round-trips, with CRLF tolerated', () => {
  const s = start();
  const text = renderLoopFile(s);
  assert.match(text, /^# Loop — t\n\nr\n/);
  assert.deepEqual(parseLoopFile(text), s);
  assert.deepEqual(parseLoopFile(text.replace(/\n/g, '\r\n')), s);
  assert.throws(() => parseLoopFile('# nothing'), /no loop-state block/);
});

test('the preset is re-read from the state on every score (editing LOOP.md takes effect)', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card });
  s.preset = 'prudent';
  assert.equal(scoreDeclared(s).decision, 'blocking');
});

test('trailers format', () => {
  const s = start(); s.iteration = 3; s.visited = ['identify', 'apply', 'apply', 'test'];
  s.current = { declared: 0.4, decision: 'soft' }; s.tests = 'pass';
  assert.equal(trailers(s), 'Loop-Iteration: 3\nLoop-Bricks: identify,apply,test\nLoop-Risk-Declared: 0.4\n'
    + 'Loop-Risk-Actual: 0.4\nLoop-Threshold: balanced 0.2/0.6\nLoop-Decision: soft\nLoop-Tests: pass');
});
