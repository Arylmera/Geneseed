// tests/unit/loop_registry.test.mjs
//
// `js/loop/registry.mjs` — the launched-loop identity list `geneseed loop init` records into,
// and the Active tab reads back through `activeLoops`/`setLoopPreset`. Every test redirects
// `XDG_CONFIG_HOME` into the sandbox (restored afterwards, even on failure) so none of this can
// ever touch the developer's real `~/.config/geneseed/loops.json`. `now` is always INJECTED —
// the 7-day finished window is exercised by passing a Date, never by mocking the clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { registryPath, recordLoop, activeLoops, setLoopPreset } from '../../js/loop/registry.mjs';
import { initState, renderLoopFile, parseLoopFile } from '../../js/loop/state.mjs';
import { PRESETS } from '../../js/loop/score.mjs';

// A minimal but real graph: one node, inside its own declared iteration loop, closing on
// `pass`. Enough for `initState` to produce a genuine LOOP.md — this test is about the
// registry reading that file, not about the engine that writes it.
const GRAPH = {
  name: 'g', start: 'a',
  loops: [{ name: 'iter', iteration: true, nodes: ['a'], max: 5 }],
  edges: [{ from: 'a', on: 'pass', to: '$close' }],
  weights: {},
};

function withXdg(sb, fn) {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

function makeLoopRoot(sb, name) {
  const root = path.join(sb.path, name);
  mkdirSync(root, { recursive: true });
  const state = initState({ title: 'T', requirement: 'R', graph: GRAPH, preset: 'balanced' });
  writeFileSync(path.join(root, 'LOOP.md'), renderLoopFile(state));
  return { root, state };
}

const rawRegistry = () => JSON.parse(readFileSync(registryPath(), 'utf8'));

test('recordLoop inserts a row; activeLoops reads LOOP.md back into a running row', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const { root } = makeLoopRoot(sb, 'proj');
      recordLoop({ root, branch: 'loop/x', title: 'My loop', now: new Date('2026-10-01T00:00:00Z') });
      const rows = activeLoops({ now: new Date('2026-10-01T00:05:00Z') });
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        root, branch: 'loop/x', title: 'My loop', started: '2026-10-01T00:00:00.000Z',
        status: 'running', iteration: 1, node: 'a', preset: 'balanced',
        threshold: PRESETS.balanced, current: {}, history: [], review: [], reason: null, awaiting: null,
        graph: GRAPH,
      });
    });
  } finally { sb.cleanup(); }
});

test('recordLoop on an already-registered root updates branch/title but keeps started', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const { root } = makeLoopRoot(sb, 'proj');
      recordLoop({ root, branch: 'loop/x', title: 'First', now: new Date('2026-10-01T00:00:00Z') });
      recordLoop({ root, branch: 'loop/y', title: 'Second', now: new Date('2026-10-02T00:00:00Z') });
      const raw = rawRegistry();
      assert.equal(raw.loops.length, 1, 'the second record upserts, it does not append');
      assert.equal(raw.loops[0].started, '2026-10-01T00:00:00.000Z');
      assert.equal(raw.loops[0].branch, 'loop/y');
      assert.equal(raw.loops[0].title, 'Second');
    });
  } finally { sb.cleanup(); }
});

test('activeLoops drops a row whose worktree root no longer exists', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const { root } = makeLoopRoot(sb, 'proj');
      recordLoop({ root, branch: 'loop/x', title: 'Gone soon' });
      rmSync(root, { recursive: true, force: true });
      assert.deepEqual(activeLoops(), []);
      assert.deepEqual(rawRegistry().loops, [], 'the dead row is pruned from the written-back file');
    });
  } finally { sb.cleanup(); }
});

// Fix round 1, item 1: a LOOP.md that exists but fails to parse must KEEP the registry entry
// (it could be a transient write in progress, not a removed loop) and report it distinctly from
// both a running and a finished row.
test('a LOOP.md that exists but fails to parse keeps the entry and reports unreadable', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const root = path.join(sb.path, 'corrupt');
      mkdirSync(root, { recursive: true });
      writeFileSync(path.join(root, 'LOOP.md'), '# Loop — no state block here\n');
      recordLoop({ root, branch: 'loop/x', title: 'Mid-write', now: new Date('2026-10-01T00:00:00Z') });
      const rows = activeLoops({ now: new Date('2026-10-01T00:05:00Z') });
      assert.deepEqual(rows, [{
        root, branch: 'loop/x', title: 'Mid-write', started: '2026-10-01T00:00:00.000Z', status: 'unreadable',
      }]);
      const raw = rawRegistry();
      assert.equal(raw.loops.length, 1, 'the entry survives an unparseable LOOP.md');
      assert.equal(raw.loops[0].finishedAt, undefined, 'an unreadable loop is not treated as finished');
    });
  } finally { sb.cleanup(); }
});

// Fix round 1, item 2: the 7-day prune window is now anchored on `finishedAt`, set ONCE the
// first time a row is seen without a LOOP.md — not on a `lastSeen` a routine poll refreshes.
test('LOOP.md absent reports finished, finishedAt is set once, and is pruned only once 7 days past it', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const root = path.join(sb.path, 'finished');
      mkdirSync(root, { recursive: true });
      recordLoop({ root, branch: 'loop/x', title: 'Done', now: new Date('2026-10-01T00:00:00Z') });
      // No LOOP.md ever written here: `recordLoop` only needs the directory to exist.

      // First poll: LOOP.md is absent for the first time — finishedAt is set to `now` and saved.
      const first = activeLoops({ now: new Date('2026-10-01T12:00:00Z') });
      assert.deepEqual(first, [{
        root, branch: 'loop/x', title: 'Done', started: '2026-10-01T00:00:00.000Z', status: 'finished',
      }]);
      assert.equal(rawRegistry().loops[0].finishedAt, '2026-10-01T12:00:00.000Z');

      // A second poll, much later but still inside the window: the window counts from
      // finishedAt (2026-10-01T12:00:00Z), not from this later poll time.
      const justUnder = activeLoops({ now: new Date('2026-10-08T11:59:59Z') });
      assert.deepEqual(justUnder, [{
        root, branch: 'loop/x', title: 'Done', started: '2026-10-01T00:00:00.000Z', status: 'finished',
      }]);
      assert.equal(rawRegistry().loops[0].finishedAt, '2026-10-01T12:00:00.000Z', 'finishedAt is not moved by a later poll');

      const justOver = activeLoops({ now: new Date('2026-10-08T12:00:01Z') });
      assert.deepEqual(justOver, [], 'more than 7 days past finishedAt: pruned');
      assert.deepEqual(rawRegistry().loops, [], 'the prune is written back');
    });
  } finally { sb.cleanup(); }
});

// Fix round 1, item 2: a routine poll that changes nothing (no pruned root, no newly-finished
// loop, no loop seen running again) must not touch loops.json at all.
test('activeLoops does not rewrite the registry file on an unchanged poll', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const { root } = makeLoopRoot(sb, 'proj');
      recordLoop({ root, branch: 'loop/x', title: 'My loop' });
      activeLoops(); // first poll: the entry has no finishedAt and LOOP.md is present — no change
      const before = readFileSync(registryPath(), 'utf8');
      activeLoops(); // second poll: running again, nothing changed
      const after = readFileSync(registryPath(), 'utf8');
      assert.equal(after, before, 'an unchanged poll must not write loops.json');
    });
  } finally { sb.cleanup(); }
});

// A loop seen running again after having been marked finished clears finishedAt — a stale
// finished-window must not survive into a loop that is running again.
test('a loop seen running again clears a previously-set finishedAt', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const root = path.join(sb.path, 'relaunched');
      mkdirSync(root, { recursive: true });
      recordLoop({ root, branch: 'loop/x', title: 'Will relaunch', now: new Date('2026-10-01T00:00:00Z') });
      activeLoops({ now: new Date('2026-10-01T01:00:00Z') }); // marks finishedAt
      assert.ok(rawRegistry().loops[0].finishedAt);
      // The loop runs again in the same worktree (a fresh `loop init`).
      const state = initState({ title: 'T', requirement: 'R', graph: GRAPH, preset: 'balanced' });
      writeFileSync(path.join(root, 'LOOP.md'), renderLoopFile(state));
      const rows = activeLoops({ now: new Date('2026-10-02T00:00:00Z') });
      assert.equal(rows[0].status, 'running');
      assert.equal(rawRegistry().loops[0].finishedAt, undefined, 'finishedAt is cleared once the loop runs again');
    });
  } finally { sb.cleanup(); }
});

test('a corrupt loops.json is treated as empty — recordLoop and activeLoops never throw', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      mkdirSync(path.dirname(registryPath()), { recursive: true });
      writeFileSync(registryPath(), 'not json at all {{{');
      assert.deepEqual(activeLoops(), []);
      const { root } = makeLoopRoot(sb, 'proj');
      recordLoop({ root, branch: 'loop/x', title: 'Recovered' });
      const raw = rawRegistry();
      assert.equal(raw.loops.length, 1, 'the corrupt file was overwritten, not merged with garbage');
      assert.equal(raw.loops[0].root, root);
    });
  } finally { sb.cleanup(); }
});

test('setLoopPreset rewrites only preset, leaving every other state field untouched', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const { root, state: before } = makeLoopRoot(sb, 'proj');
      recordLoop({ root, branch: 'loop/x', title: 'My loop' });
      const row = setLoopPreset(root, 'aggressive');
      assert.equal(row.preset, 'aggressive');
      assert.deepEqual(row.threshold, PRESETS.aggressive);
      const after = parseLoopFile(readFileSync(path.join(root, 'LOOP.md'), 'utf8'));
      assert.equal(after.preset, 'aggressive');
      assert.deepEqual({ ...after, preset: before.preset }, before,
        'every field but preset must survive the rewrite unchanged');
      // The atomic writer (`writeLoopFile`) must not leave its tmp sibling behind either.
      assert.ok(!existsSync(path.join(root, 'LOOP.md.tmp')));
    });
  } finally { sb.cleanup(); }
});

test('setLoopPreset refuses a root the registry does not know about', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const { root } = makeLoopRoot(sb, 'proj');
      // Never recorded — the registry has no row for it.
      assert.throws(() => setLoopPreset(root, 'balanced'), { message: 'unknown loop' });
    });
  } finally { sb.cleanup(); }
});

test('setLoopPreset refuses a preset outside PRESETS', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const { root } = makeLoopRoot(sb, 'proj');
      recordLoop({ root, branch: 'loop/x', title: 'My loop' });
      assert.throws(() => setLoopPreset(root, 'yolo'), { message: 'unknown preset "yolo"' });
    });
  } finally { sb.cleanup(); }
});
