// tests/unit/loop_registry.test.mjs
//
// `js/loop/registry.mjs` — the launched-loop identity list `geneseed loop init` records into,
// and the Active tab reads back through `activeLoops`/`setLoopPreset`. Every test redirects
// `XDG_CONFIG_HOME` into the sandbox (restored afterwards, even on failure) so none of this can
// ever touch the developer's real `~/.config/geneseed/loops.json`. `now` is always INJECTED —
// the 7-day finished window is exercised by passing a Date, never by mocking the clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

test('recordLoop on an already-registered root updates branch/title/lastSeen but keeps started', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const { root } = makeLoopRoot(sb, 'proj');
      recordLoop({ root, branch: 'loop/x', title: 'First', now: new Date('2026-10-01T00:00:00Z') });
      recordLoop({ root, branch: 'loop/y', title: 'Second', now: new Date('2026-10-02T00:00:00Z') });
      const raw = JSON.parse(readFileSync(registryPath(), 'utf8'));
      assert.equal(raw.loops.length, 1, 'the second record upserts, it does not append');
      assert.equal(raw.loops[0].started, '2026-10-01T00:00:00.000Z');
      assert.equal(raw.loops[0].branch, 'loop/y');
      assert.equal(raw.loops[0].title, 'Second');
      assert.equal(raw.loops[0].lastSeen, '2026-10-02T00:00:00.000Z');
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
      const raw = JSON.parse(readFileSync(registryPath(), 'utf8'));
      assert.deepEqual(raw.loops, [], 'the dead row is pruned from the written-back file');
    });
  } finally { sb.cleanup(); }
});

test('LOOP.md absent reports finished, and is pruned only once 7 days past lastSeen', () => {
  const sb = makeSandbox('loopreg-');
  try {
    withXdg(sb, () => {
      const root = path.join(sb.path, 'finished');
      mkdirSync(root, { recursive: true });
      recordLoop({ root, branch: 'loop/x', title: 'Done', now: new Date('2026-10-01T00:00:00Z') });
      // No LOOP.md ever written here: `recordLoop` only needs the directory to exist.
      const justUnder = activeLoops({ now: new Date('2026-10-07T23:59:59Z') });
      assert.deepEqual(justUnder, [{
        root, branch: 'loop/x', title: 'Done', started: '2026-10-01T00:00:00.000Z', status: 'finished',
      }]);
      const justOver = activeLoops({ now: new Date('2026-10-08T00:00:01Z') });
      assert.deepEqual(justOver, [], 'more than 7 days past lastSeen: pruned');
      const raw = JSON.parse(readFileSync(registryPath(), 'utf8'));
      assert.deepEqual(raw.loops, [], 'the prune from the second read is written back');
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
      const raw = JSON.parse(readFileSync(registryPath(), 'utf8'));
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
