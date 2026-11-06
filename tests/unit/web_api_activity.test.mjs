// THE WEB API'S FUNCTIONS, IN PROCESS — the Activity feed.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NotFound } from '../../js/web/catalog.mjs';
import {
  activitySummary, apiActivityDetail, apiActivityToggle, sweepInstalls,
} from '../../js/web/activity.mjs';
import { installState } from '../../js/hosts/installs.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { recordLoop, registryPath } from '../../js/loop/registry.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixtureTeardown } from '../helpers/web_fixture.mjs';
import {
  withTwoViewsServed, plain, R, item, withLoopsXdg, makeLoopWorktree, webState,
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

// ---------------------------------------------------------------------------------------------
// The live-activity reader: globs `<target>/activity/*.json`, lists dead, stale and ended
// sessions apart from the live ones (deleting nothing), and never raises on a missing directory
// or a garbage file. The box is ONE active opencode install (its manifest makes it active), read
// through `activitySummary` with that install as its only target, so the machine's own installs
// never leak in; `install` is the key every card of it carries.

function activityBox() {
  const sb = makeSandbox();
  fs.writeFileSync(path.join(sb.path, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
  const targets = [['opencode', 'global', sb.path]];
  return {
    sb,
    install: `opencode:global:${sb.path}`,
    state: webState('neutral', sb.path),
    read: () => activitySummary({ targets }),
    write(name, entry) {
      const d = path.join(sb.path, 'activity');
      fs.mkdirSync(d, { recursive: true });
      const p = path.join(d, name);
      fs.writeFileSync(p, JSON.stringify(entry));
      return p;
    },
  };
}

// `time.time()` is SECONDS. `Date.now()` is milliseconds, and handing the reader a millisecond
// stamp makes every entry look 55 years in the future — which passes the staleness check by
// accident and would make the prune test below vacuous rather than red.
const nowSec = () => Date.now() / 1000;

// The reader joins the loop registry (`activeLoops`), which can REWRITE `loops.json`, so every
// activity test points `XDG_CONFIG_HOME` into its own sandbox: no test reads or prunes the
// developer's real registry.
const withActivity = (fn) => {
  const box = activityBox();
  try { return withLoopsXdg(box.sb, () => fn(box)); } finally { box.sb.cleanup(); }
};

test('a missing activity dir reads empty and enabled', () => {
  withActivity((box) => {
    const res = box.read();
    assert.deepEqual(res.activity, []);
    assert.equal(res.enabled, true);
  });
});

test('a live entry is globbed', () => {
  withActivity((box) => {
    box.write('ses_a.json', {
      session_id: 'ses_a', agent: 'reviewer', title: 'fix it', cwd: '/repo',
      status: 'busy', pid: process.pid, updated_at: nowSec(),
    });
    const acts = box.read().activity;
    assert.equal(acts.length, 1);
    assert.equal(acts[0].agent, 'reviewer');
    assert.equal(acts[0].status, 'busy');
  });
});

// A pid that is virtually never alive. The session leaves the live list and is listed as ENDED,
// and the file is KEPT: a GET never deletes (it used to, which made a page view the one web read
// that removed files). The sweep (js/hosts/activity.mjs) archives it instead, outside any GET.
test('a dead pid leaves the live list, is listed ended, and its file stays', () => {
  withActivity((box) => {
    const p = box.write('ses_dead.json', {
      session_id: 'ses_dead', status: 'busy', pid: 2147483647, updated_at: nowSec(),
    });
    const res = box.read();
    assert.deepEqual(res.activity, []);
    assert.deepEqual(res.ended.map((e) => [e.session_id, e.ended]), [['ses_dead', true]]);
    assert.ok(fs.existsSync(p), 'a GET removed a snapshot');
  });
});

test('a stale entry leaves the live list even with a live pid', () => {
  withActivity((box) => {
    box.write('ses_old.json', {
      session_id: 'ses_old', status: 'idle', pid: process.pid, updated_at: nowSec() - 10000,
    });
    assert.deepEqual(box.read().activity, []);
  });
});

// A hook writer has no resident process, so it records `pid: null`: staleness alone decides.
test('a fresh hook snapshot with no pid is live', () => {
  withActivity((box) => {
    box.write('h.json', { session_id: 'h', status: 'busy', pid: null, updated_at: nowSec() });
    assert.deepEqual(box.read().activity.map((a) => a.session_id), ['h']);
  });
});

test('a garbage file never raises', () => {
  withActivity((box) => {
    const d = path.join(box.sb.path, 'activity');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'broken.json'), '{ not json');
    assert.deepEqual(box.read().activity, []);
  });
});

test('the v1.1 fields pass through', () => {
  withActivity((box) => {
    box.write('s.json', {
      session_id: 's', status: 'busy', pid: process.pid, updated_at: nowSec(),
      model: 'opus', phase: 'Editing x', cost: 0.62, tokens: 48000,
      files: { count: 2, additions: 10, deletions: 1, items: [] },
      todos: { done: 1, total: 3, items: [] },
      error: 'oops', blocked_on: null, turn_started_at: nowSec(),
    });
    const e = box.read().activity[0];
    assert.equal(e.model, 'opus');
    assert.equal(e.phase, 'Editing x');
    assert.equal(e.error, 'oops');

    // A PARSED NUMBER IS A `JsonNumber`, NOT A JS NUMBER, and that is the port working rather
    // than leaking. `parseJson` keeps each number's SOURCE SPELLING so a read-modify-write
    // round-trips `1.0` as `1.0` instead of collapsing it to `1` — the exact distinction
    // `tests/mutate.mjs`'s M6 is about. The reader hands the parsed object through, so the
    // wrapper reaches the caller and `jsonDumps` unwraps it on the way out.
    assert.equal(Number(e.cost), 0.62);
    assert.equal(Number(e.tokens), 48000);
    assert.equal(Number(e.files.count), 2);
    assert.equal(Number(e.todos.done), 1);
  });
});

// The console's host filter builds its options from `host`, so the reader must pass it through.
// The hook writer stamps it; the OpenCode plugin (the only other writer) does not, so a snapshot
// without `writer: 'hook'` reads as OpenCode's, and a hook snapshot without a host stays null.
test('host passes through, and a plugin snapshot reads as opencode', () => {
  const rows = [
    [{ writer: 'hook', host: 'bob' }, 'bob'],
    [{ writer: 'hook', host: 'claude' }, 'claude'],
    [{}, 'opencode'],
    [{ writer: 'hook' }, null],
  ];
  for (const [extra, want] of rows) {
    withActivity((box) => {
      box.write('s.json', { session_id: 's', status: 'idle', pid: process.pid, updated_at: nowSec(), ...extra });
      assert.equal(box.read().activity[0].host, want, JSON.stringify(extra));
    });
  }
});

// A pre-v1.1 writer omits the new keys and the reader must fill SAFE defaults — `null` for the
// structured ones, `0` for the numeric ones, because the console arithmetics them.
test('a v1 file gets safe defaults', () => {
  withActivity((box) => {
    box.write('s.json', {
      session_id: 's', status: 'idle', pid: process.pid, updated_at: nowSec(),
    });
    const e = box.read().activity[0];
    assert.equal(e.model, null);
    assert.equal(e.phase, null);
    assert.equal(e.files, null);
    // THE DEFAULTS ARE RAW JS NUMBERS where a parsed field is a `JsonNumber` — the reader
    // SUPPLIES these rather than reading them, so nothing was parsed to keep a spelling of.
    // Asserted strictly on purpose: it is the one place in this file where the difference
    // between "read from the file" and "filled in by the reader" is observable.
    assert.equal(e.cost, 0);
    assert.equal(e.tokens, 0);
  });
});

const liveSnap = (sid, extra = {}) => ({
  session_id: sid, status: 'busy', pid: null, writer: 'hook', host: 'claude',
  updated_at: nowSec(), ...extra,
});

const filesOf = (items) => ({ count: items.length, additions: 0, deletions: 0, items });

// The v2 keys are APPENDED after `host`, never shuffled in: the docblock on `normalizeEntry` says
// the order is stable. The merged list then appends the card's `install` (the install whose copy is
// shown), `installs` (every install that saw it) and `key` (id + checkout), and a live session the two derived keys,
// `files_all` and `loops`.
const V2_KEYS = [
  'session_id', 'agent', 'title', 'cwd', 'status', 'updated_at', 'model', 'phase',
  'turn_started_at', 'cost', 'tokens', 'files', 'todos', 'blocked_on', 'error', 'host',
  'root', 'repo', 'agents', 'attribution', 'turns', 'context', 'compactions', 'compacted_at',
  'context_at_compaction', 'repo_key', 'install', 'installs', 'key', 'files_all', 'loops',
];

test('the v2 fields pass through as written, in a stable key order', () => {
  withActivity((box) => {
    const v2 = {
      root: '/w/feature', repo: '/w/main',
      agents: [{ id: 'ag1', type: 'explorer', status: 'running', started: 100 }],
      attribution: false, turns: 7, context: { used: 1200, window: 200000 },
      compactions: 2, compacted_at: 1000, context_at_compaction: 150000,
      files: filesOf([{ file: 'x.js', path: 'src/x.js', additions: 1, deletions: 0, by: 'ag1' }]),
    };
    box.write('s.json', liveSnap('s', v2));
    const e = box.read().activity[0];
    assert.deepEqual(Object.keys(e), V2_KEYS);
    for (const k of Object.keys(v2)) assert.deepEqual(plain(e[k]), v2[k], k);
  });
});

// `repo_key` is `normcase(repo ?? root)`: the one key the garden groups shelves by, so Bob's
// `c:\w\main` and Claude's `C:\w\main` land on one shelf on Windows (on POSIX nothing folds).
// A snapshot with neither `repo` nor `root` has no shelf key.
test('repo_key folds the repo spelling, falling back to root', () => {
  const fold = process.platform === 'win32';
  const rows = [
    [{ root: 'C:\\w\\feat', repo: 'C:\\w\\Main' }, fold ? 'c:\\w\\main' : 'C:\\w\\Main'],
    [{ root: 'c:\\w\\main', repo: 'c:\\w\\main' }, 'c:\\w\\main'],
    [{ root: '/w/feat' }, fold ? '\\w\\feat' : '/w/feat'],
    [{}, null],
  ];
  for (const [extra, want] of rows) {
    withActivity((box) => {
      box.write('s.json', liveSnap('s', extra));
      assert.equal(box.read().activity[0].repo_key, want, JSON.stringify(extra));
    });
  }
});

// A v1 snapshot has none of the v2 keys. The reader fills them: `null` where the value is a
// path, a structure or a time that is unknown (`root`, `repo`, `attribution`, `context`,
// `compacted_at`, `context_at_compaction`), `[]` for the lists (`agents`, `files_all`,
// `loops`), and `0` for the counts (`turns`, `compactions`), because the garden does arithmetic
// with them. `attribution` stays `null` (not stated), since only a Bob writer says `false`.
test('a v1 snapshot gets the v2 defaults', () => {
  withActivity((box) => {
    box.write('s.json', { session_id: 's', status: 'idle', pid: process.pid, updated_at: nowSec() });
    const res = box.read();
    const e = res.activity[0];
    assert.deepEqual(Object.keys(e), V2_KEYS);
    assert.deepEqual(
      Object.fromEntries(V2_KEYS.slice(16).map((k) => [k, e[k]])),
      { root: null, repo: null, agents: [], attribution: null, turns: 0, context: null,
        compactions: 0, compacted_at: null, context_at_compaction: null, repo_key: null,
        install: box.install, installs: [box.install], key: 's\u0000', files_all: [], loops: [] });
    assert.deepEqual(res.collisions, []);
  });
});

// B2: the snapshot keeps the first `FILE_CAP` files; the garden needs all of them, so a LIVE
// session's `files_all` is the detail file's uncapped `files.items`. `files` stays the snapshot's
// capped summary, because the list card (`SessionHeader`) renders `files` as it is.
test('files_all is the uncapped list from the detail file; files is unchanged', () => {
  const rows = [
    // [snapshot items, detail file (or null), files_all wanted]
    [[{ file: 'a' }], { files: filesOf([{ file: 'a' }, { file: 'b' }, { file: 'c' }]) },
      [{ file: 'a' }, { file: 'b' }, { file: 'c' }]],
    [[{ file: 'a' }], null, [{ file: 'a' }]],
    [[{ file: 'a' }], { timeline: [] }, [{ file: 'a' }]],
    [null, null, []],
  ];
  for (const [snapItems, detail, want] of rows) {
    withActivity((box) => {
      box.write('s.json', liveSnap('s', snapItems ? { files: filesOf(snapItems) } : {}));
      if (detail) box.write('s.detail.json', detail);
      const e = box.read().activity[0];
      assert.deepEqual(plain(e.files_all), want, JSON.stringify(detail));
      assert.deepEqual(plain(e.files), snapItems ? filesOf(snapItems) : null);
    });
  }
});

const W = 'C:\\w\\feature';

const COLLISIONS = [
  ['same worktree', [['s1', R, R, [item('src/a.js')]], ['s2', R, R, [item('src/a.js')]]],
    [{ repo: R, path: 'src/a.js', kind: 'same-worktree',
      writers: [{ sid: 's1', by: null, root: R }, { sid: 's2', by: null, root: R }] }]],
  ['two worktrees of one repo', [['s1', R, R, [item('a.js')]], ['s2', W, R, [item('a.js')]]],
    [{ repo: R, path: 'a.js', kind: 'cross-worktree',
      writers: [{ sid: 's1', by: null, root: R }, { sid: 's2', by: null, root: W }] }]],
  ['a session and its own sub-agent', [['s1', R, R, [item('a.js'), item('a.js', 'ag1')]]],
    [{ repo: R, path: 'a.js', kind: 'same-worktree',
      writers: [{ sid: 's1', by: null, root: R }, { sid: 's1', by: 'ag1', root: R }] }]],
  ['same basename, other folder', [['s1', R, R, [item('src/a/index.js')]],
    ['s2', R, R, [item('src/b/index.js')]]], []],
  ['a v1 row has no path', [['s1', R, R, [{ file: 'a.js' }]], ['s2', R, R, [{ file: 'a.js' }]]], []],
  ['a row with no by key is the session itself', [['s1', R, R, [{ file: 'a.js', path: 'a.js' }]],
    ['s2', R, R, [item('a.js')]]],
    [{ repo: R, path: 'a.js', kind: 'same-worktree',
      writers: [{ sid: 's1', by: null, root: R }, { sid: 's2', by: null, root: R }] }]],
  ['a file outside the root has path null', [['s1', R, R, [{ file: 'a.js', path: null, by: null }]],
    ['s2', R, R, [{ file: 'a.js', path: null, by: null }]]], []],
  ['Bob lower-case drive', [['s1', R, R, [item('a.js')]], ['s2', 'c:\\w\\main', 'c:\\w\\main', [item('a.js')]]],
    process.platform === 'win32'
      ? [{ repo: R, path: 'a.js', kind: 'same-worktree',
        writers: [{ sid: 's1', by: null, root: R }, { sid: 's2', by: null, root: 'c:\\w\\main' }] }]
      : []],
];

test('collisions: distinct writers on one (repo, path) among live sessions', () => {
  for (const [name, sessions, want] of COLLISIONS) {
    withActivity((box) => {
      for (const [sid, root, repo, items] of sessions) {
        box.write(`${sid}.json`, liveSnap(sid, { root, repo, files: filesOf(items) }));
      }
      const got = plain(box.read().collisions);
      // Every writer names the one install it was read from; the table states the rest.
      // and carries its card's key, which starts with its session id.
      for (const c of got) for (const w of c.writers) {
        assert.equal(w.install, box.install, name);
        assert.ok(w.key.startsWith(`${w.sid}\u0000`), name);
      }
      assert.deepEqual(got.map((c) => ({ ...c, writers: c.writers.map(({ install, key, ...w }) => w) })),
        want, name);
    });
  }
});

test('collisions read the uncapped detail list and ignore ended sessions', () => {
  withActivity((box) => {
    box.write('s1.json', liveSnap('s1', { root: R, repo: R, files: filesOf([item('x.js')]) }));
    box.write('s1.detail.json', { files: filesOf([item('x.js'), item('deep.js')]) });
    box.write('s2.json', liveSnap('s2', { root: R, repo: R, files: filesOf([item('deep.js')]) }));
    box.write('s3.json', liveSnap('s3', { root: R, repo: R, files: filesOf([item('x.js')]),
      updated_at: nowSec() - 100000 }));
    assert.deepEqual(plain(box.read().collisions).map((c) => [c.path, c.writers.map((w) => w.sid)]),
      [['deep.js', ['s1', 's2']]]);
  });
});

// B9: `loops` lists the registry rows whose root is the session's `root` (through `normcase`).
// A finished loop (its LOOP.md is gone) is left out; a session outside a repo has none. The
// registry stores the realpath, and the reader resolves the session root the same way, so a
// session whose root is a link to the loop's worktree (`e`: a junction on Windows, which needs no
// privilege; a directory symlink elsewhere) still joins.
test('loops join the loop registry on the session root', () => {
  withActivity((box) => {
    const wt = fs.realpathSync.native(makeLoopWorktree(box.sb, 'wt'));
    recordLoop({ root: wt, branch: 'loop/a', title: 'Loop A', now: new Date('2026-10-01T00:00:00Z') });
    const gone = path.join(box.sb.path, 'gone');
    fs.mkdirSync(gone);
    recordLoop({ root: gone, branch: 'loop/b', title: 'Loop B', now: new Date('2026-10-01T00:00:00Z') });
    const realGone = fs.realpathSync.native(gone);
    box.write('a.json', liveSnap('a', { root: wt, repo: wt }));
    box.write('b.json', liveSnap('b', { root: realGone, repo: realGone }));
    box.write('c.json', liveSnap('c', { root: path.join(box.sb.path, 'other'), repo: null }));
    box.write('d.json', liveSnap('d'));
    const link = path.join(box.sb.path, 'wt-link');
    fs.symlinkSync(wt, link, process.platform === 'win32' ? 'junction' : 'dir');
    box.write('e.json', liveSnap('e', { root: link, repo: link }));
    // A registered worktree that has since been removed: `activeLoops` would prune it and save.
    const vanished = path.join(box.sb.path, 'vanished');
    fs.mkdirSync(vanished);
    recordLoop({ root: vanished, branch: 'loop/c', title: 'Loop C', now: new Date('2026-10-01T00:00:00Z') });
    fs.rmSync(vanished, { recursive: true });
    const before = fs.readFileSync(registryPath(), 'utf8');
    const loops = Object.fromEntries(box.read().activity.map((e) => [e.session_id, plain(e.loops)]));
    const A = [{ title: 'Loop A', iteration: 1, status: 'running' }];
    assert.deepEqual(loops, { a: A, b: [], c: [], d: [], e: A });
    // The GET writes nothing: no prune, no `finishedAt` stamp on the finished loop.
    assert.equal(fs.readFileSync(registryPath(), 'utf8'), before);
  });
});

// P3 draws an ended session's tree on its detail page, so the archived snapshot comes back with
// the same v2 fields, `files_all` from its detail file, and no loops: it is not running, even
// when a loop still runs in its root.
test('the detail endpoint returns the v2 fields for an archived session', () => {
  withActivity((box) => {
    const wt = fs.realpathSync.native(makeLoopWorktree(box.sb, 'wt'));
    recordLoop({ root: wt, branch: 'loop/a', title: 'Loop A', now: new Date('2026-10-01T00:00:00Z') });
    const d = path.join(box.sb.path, 'activity', 'archive');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 's.json'), JSON.stringify(liveSnap('s', {
      updated_at: nowSec() - 100000, root: wt, repo: wt, turns: 3, compactions: 1,
      agents: [{ id: 'ag1', type: null, status: 'done', started: 5 }],
      files: filesOf([item('a.js')]),
    })));
    fs.writeFileSync(path.join(d, 's.detail.json'),
      JSON.stringify({ timeline: [], files: filesOf([item('a.js'), item('b.js', 'ag1')]) }));
    const s = apiActivityDetail(box.state, 's').session;
    assert.equal(s.ended, true);
    assert.deepEqual(plain({ root: s.root, repo: s.repo, turns: s.turns, compactions: s.compactions,
      agents: s.agents, files_all: s.files_all, loops: s.loops }), {
      root: wt, repo: wt, turns: 3, compactions: 1,
      agents: [{ id: 'ag1', type: null, status: 'done', started: 5 }],
      files_all: [item('a.js'), item('b.js', 'ag1')], loops: [],
    });
  });
});

test('activity is enabled by default', () => {
  withActivity((box) => assert.equal(box.read().enabled, true));
});

test('the activity toggle persists and gates the output', () => {
  withActivity((box) => {
    box.write('ses_a.json', {
      session_id: 'ses_a', status: 'busy', pid: process.pid, updated_at: nowSec(),
    });
    assert.equal(box.read().activity.length, 1);

    assert.deepEqual(apiActivityToggle(box.state, { enabled: false }),
      { ok: true, enabled: false });
    assert.ok(fs.statSync(path.join(box.sb.path, '.geneseed-activity')).isFile());

    // Disabled: the output is gated to [] and the flag reads off. The FILES are left for the
    // plugin to clear on its next event rather than deleted here.
    const out = box.read();
    assert.equal(out.enabled, false);
    assert.deepEqual(out.activity, []);

    apiActivityToggle(box.state, { enabled: true });
    assert.equal(box.read().enabled, true);
    assert.equal(box.read().activity.length, 1);
  });
});

// `*.detail.json` is the v1.2 timeline sidecar, not a session snapshot.
test('the activity list skips detail files', () => {
  withActivity((box) => {
    box.write('s.json',
      { session_id: 's', status: 'busy', pid: process.pid, updated_at: nowSec() });
    box.write('s.detail.json', { timeline: [{ kind: 'tool' }], files: null, todos: null });
    assert.deepEqual(box.read().activity.map((a) => a.session_id), ['s']);
  });
});

test('the detail endpoint returns the session and its timeline', () => {
  withActivity((box) => {
    box.write('s.json', {
      session_id: 's', status: 'busy', pid: process.pid, updated_at: nowSec(),
      files: { count: 1, items: [{ file: 'a' }] },
    });
    box.write('s.detail.json', {
      timeline: [{ kind: 'tool', label: 'Editing a.js' }],
      files: { count: 9,
        items: Array.from({ length: 20 }, (_, i) => ({ file: `f${i}.js`, additions: 1, deletions: 0 })) },
      todos: { done: 1, total: 2, items: [{ content: 'a', status: 'completed' }] },
    });
    const res = apiActivityDetail(box.state, 's');
    assert.equal(res.session.session_id, 's');
    assert.equal(res.timeline[0].label, 'Editing a.js');
    // The detail file's UNCAPPED lists win over the snapshot's capped ones — the snapshot caps
    // for the rail, the detail pane wants everything.
    assert.equal(res.session.files.items.length, 20);
    assert.equal(Number(res.session.todos.total), 2);   // a parsed number — see above
  });
});

test('the detail endpoint 404s on an unknown session', () => {
  withActivity(({ state }) => {
    assert.throws(() => apiActivityDetail(state, 'nope'), NotFound);
  });
});

test('the detail endpoint tolerates a missing detail file', () => {
  withActivity((box) => {
    box.write('s.json',
      { session_id: 's', status: 'idle', pid: process.pid, updated_at: nowSec() });
    const res = apiActivityDetail(box.state, 's');
    assert.deepEqual(res.timeline, []);
    assert.equal(res.session.session_id, 's');
  });
});

test('the detail conversation falls back to the session title', () => {
  withActivity((box) => {
    box.write('s.json', {
      session_id: 's', title: 'the very first ask', status: 'busy',
      pid: process.pid, updated_at: nowSec(),
    });
    // No detail file: a single opening user turn synthesised from the session title.
    assert.deepEqual(apiActivityDetail(box.state, 's').conversation,
      [{ role: 'user', text: 'the very first ask' }]);

    // With a captured transcript it is returned as-is, in order.
    const turns = [
      { role: 'user', text: 'add a toggle' },
      { role: 'assistant', text: 'done' },
      { role: 'user', text: 'make it 50/50' },
    ];
    box.write('s.detail.json', { timeline: [], conversation: turns });
    assert.deepEqual(apiActivityDetail(box.state, 's').conversation, turns);
  });
});

// ---------------------------------------------------------------------------------------------
// One garden over every active install (D2): `/api/activity` merges the activity dirs of every
// active install, tags each card with its install, and joins collisions across them; the detail
// and the on/off toggle stay per install, named by `?host=&path=` / `{host, path}`.

// Two active installs, each one opencode global sandbox, read through `activitySummary` alone.
function withTwoActivityDirs(fn) {
  const a = activityBox();
  const b = activityBox();
  try {
    return withLoopsXdg(a.sb, () => fn({ a, b, targets: [['opencode', 'global', a.sb.path],
      ['opencode', 'global', b.sb.path]] }));
  } finally { a.sb.cleanup(); b.sb.cleanup(); }
}

test('the activity merges every active install, each card tagged with its own', () => {
  withTwoActivityDirs(({ a, b, targets }) => {
    a.write('s1.json', liveSnap('s1', { title: 'in a' }));
    b.write('s2.json', liveSnap('s2', { title: 'in b' }));
    b.write('s3.json', liveSnap('s3', { title: 'ended in b', status: 'ended' }));
    const res = activitySummary({ targets });
    assert.deepEqual(res.activity.map((e) => [e.session_id, e.install]).sort(),
      [['s1', a.install], ['s2', b.install]]);
    assert.deepEqual(res.ended.map((e) => [e.session_id, e.install]), [['s3', b.install]]);
    assert.deepEqual(plain(res.installs), [
      { install: a.install, host: 'opencode', scope: 'global', path: a.sb.path, enabled: true },
      { install: b.install, host: 'opencode', scope: 'global', path: b.sb.path, enabled: true }]);
    assert.equal(res.enabled, true);
  });
});

// The same sid in two installs from two CHECKOUTS (other roots) is two cards, and two writers on
// one file: the collision is joined over the MERGED list, and keyed by install. The same sid in one
// checkout is one session seen twice, and one card (the test after this one).
test('collisions join sessions across installs, one sid in two installs being two writers', () => {
  withTwoActivityDirs(({ a, b, targets }) => {
    const files = filesOf([{ file: 'a.js', path: 'a.js', additions: 1, deletions: 0, by: null }]);
    a.write('s1.json', liveSnap('s1', { root: R, repo: R, files }));
    b.write('s1.json', liveSnap('s1', { root: W, repo: R, files }));
    const res = activitySummary({ targets });
    assert.equal(res.activity.length, 2, 'one install hid the other install card');
    const want = [a.install, b.install].sort();
    const keyOf = (root) => `s1\u0000${process.platform === 'win32' ? root.toLowerCase() : root}`;
    assert.deepEqual(plain(res.collisions), [{ repo: R, path: 'a.js', kind: 'cross-worktree',
      writers: [{ sid: 's1', by: null, root: want[0] === a.install ? R : W, install: want[0],
        key: keyOf(want[0] === a.install ? R : W) },
      { sid: 's1', by: null, root: want[0] === a.install ? W : R, install: want[1],
        key: keyOf(want[0] === a.install ? W : R) }] }]);
  });
});

// A global and a project install of one host both record the same session (both hooks run): the
// same sid in the same checkout. That is ONE card: the newest copy's data, both installs listed in
// the fixed order (here target order: `a` first), `a` its primary install whichever copy is newer,
// and it never collides with itself. Without a root, the cwd decides.
test('one session recorded by two installs in one checkout is one card, with no self-collision', () => {
  withTwoActivityDirs(({ a, b, targets }) => {
    const files = filesOf([{ file: 'a.js', path: 'a.js', additions: 1, deletions: 0, by: null }]);
    a.write('s1.json', liveSnap('s1', { root: R, repo: R, files, title: 'older copy',
      updated_at: nowSec() - 10 }));
    b.write('s1.json', liveSnap('s1', { root: 'c:\\w\\main', repo: R, files, title: 'newer copy' }));
    a.write('s2.json', liveSnap('s2', { cwd: '/x', title: 'a no root', updated_at: nowSec() - 10 }));
    b.write('s2.json', liveSnap('s2', { cwd: '/x', title: 'b no root' }));
    const res = activitySummary({ targets });
    const fold = process.platform === 'win32';
    const rows = res.activity.map((e) => [e.session_id, e.title, e.install, plain(e.installs)]).sort();
    assert.deepEqual(rows, [
      ...(fold ? [['s1', 'newer copy', a.install, [a.install, b.install]]]
        // On POSIX `C:\w\main` and `c:\w\main` are two checkouts: two cards.
        : [['s1', 'newer copy', b.install, [b.install]], ['s1', 'older copy', a.install, [a.install]]]),
      ['s2', 'b no root', a.install, [a.install, b.install]],
    ].sort());
    if (fold) assert.deepEqual(plain(res.collisions), [], 'one session collided with itself');
  });
});

// Two installs write one session milliseconds apart, so which copy is newest can change between
// two polls. The card's primary install and its key must not follow it: `a` (first in the fixed
// order) stays primary and the key stays put, while the shown data follows the newest copy.
test('a merged card keeps its install and key when the other install writes newer', () => {
  withTwoActivityDirs(({ a, b, targets }) => {
    const write = (box, title, ago) => box.write('s1.json',
      liveSnap('s1', { root: '/w/main', title, updated_at: nowSec() - ago }));
    write(a, 'a newer', 0);
    write(b, 'b older', 5);
    const first = activitySummary({ targets }).activity;
    write(b, 'b newer', 0);
    write(a, 'a older', 5);
    const second = activitySummary({ targets }).activity;
    const row = (l) => l.map((e) => [e.title, e.install, plain(e.installs), e.key]);
    // `normcase` folds the separator to `\` on Windows.
    const K = process.platform === 'win32' ? 's1\u0000\\w\\main' : 's1\u0000/w/main';
    assert.deepEqual(row(first), [['a newer', a.install, [a.install, b.install], K]]);
    assert.deepEqual(row(second), [['b newer', a.install, [a.install, b.install], K]]);
  });
});

// One install's copy can go stale (a failed hook, a switch just turned back on) while the other's
// stays live. The live card's install is the first install holding a LIVE copy, `b` here although
// `a` ranks first: the detail link must not read a copy that shows the session as ended. Both
// installs are still listed.
test('a live merged card links to an install whose copy is live', () => {
  withTwoActivityDirs(({ a, b, targets }) => {
    a.write('s1.json', liveSnap('s1', { root: '/w/main', title: 'a ended', status: 'ended',
      updated_at: nowSec() - 60 }));
    b.write('s1.json', liveSnap('s1', { root: '/w/main', title: 'b live' }));
    const res = activitySummary({ targets });
    assert.deepEqual(res.activity.map((e) => [e.title, e.install, plain(e.installs)]),
      [['b live', b.install, [a.install, b.install]]]);
    assert.deepEqual(res.ended, [], 'the ended copy came back as a second card');
  });
});

// A trailing separator names the same checkout: `C:\w\main\` is `C:\w\main`.
test('the merge folds a trailing separator in the checkout', () => {
  withTwoActivityDirs(({ a, b, targets }) => {
    a.write('s1.json', liveSnap('s1', { root: 'C:\\w\\main\\' }));
    b.write('s1.json', liveSnap('s1', { root: 'C:\\w\\main' }));
    a.write('s2.json', liveSnap('s2', { cwd: '/x/' }));
    b.write('s2.json', liveSnap('s2', { cwd: '/x' }));
    const res = activitySummary({ targets });
    assert.deepEqual(res.activity.map((e) => [e.session_id, plain(e.installs)]).sort(),
      [['s1', [a.install, b.install]], ['s2', [a.install, b.install]]]);
  });
});
// The OpenCode plugin writes and reads its flag in the GLOBAL OpenCode dir whichever install loaded
// it, so an OpenCode PROJECT install has no row (no switch) and its dir is not read.

test('an opencode project install has no tracking row, and its dir is not read', () => {
  withTwoActivityDirs(({ a, b }) => {
    assert.equal(installState(b.sb.path, 'opencode', 'project'), 'active', 'the fixture is vacuous');
    a.write('s1.json', liveSnap('s1', { cwd: '/a' }));
    b.write('s2.json', liveSnap('s2', { cwd: '/b' }));
    const res = activitySummary({ targets: [['opencode', 'global', a.sb.path],
      ['opencode', 'project', b.sb.path]] });
    assert.deepEqual(res.installs.map((i) => i.install), [a.install]);
    assert.deepEqual(res.activity.map((e) => e.session_id), ['s1']);
  });
});

// One install whose state cannot be read is skipped; the garden still shows the others.
test('a broken install is skipped, never a blank garden', () => {
  withTwoActivityDirs(({ a }) => {
    assert.throws(() => installState(null, 'opencode', 'global'), 'the broken target does not throw');
    a.write('s1.json', liveSnap('s1'));
    const targets = [['opencode', 'global', null], ['opencode', 'global', a.sb.path]];
    assert.deepEqual(activitySummary({ targets }).activity.map((e) => e.session_id), ['s1']);
    sweepInstalls({ targets }); // and the sweep does not throw either
  });
});

test('an install whose tracking is off contributes no card, and the others stay', () => {
  withTwoActivityDirs(({ a, b, targets }) => {
    a.write('s1.json', liveSnap('s1'));
    b.write('s2.json', liveSnap('s2'));
    assert.deepEqual(apiActivityToggle(a.state, { enabled: false }), { ok: true, enabled: false });
    const res = activitySummary({ targets });
    assert.deepEqual(res.activity.map((e) => e.session_id), ['s2']);
    assert.deepEqual(res.installs.map((i) => [i.install, i.enabled]),
      [[a.install, false], [b.install, true]]);
    assert.equal(res.enabled, true, 'one install on is tracking on');
    apiActivityToggle(b.state, { enabled: false });
    assert.equal(activitySummary({ targets }).enabled, false);
  });
});

// The daemon's sweep archives the ended sessions of EVERY active install, not only its view.
test('the sweep archives the ended sessions of every active install', () => {
  withTwoActivityDirs(({ a, b, targets }) => {
    const pa = a.write('old.json', liveSnap('old', { status: 'ended' }));
    const pb = b.write('old.json', liveSnap('old', { status: 'ended' }));
    const keep = b.write('live.json', liveSnap('live'));
    sweepInstalls({ targets });
    for (const [p, box] of [[pa, a], [pb, b]]) {
      assert.equal(fs.existsSync(p), false, `${box.install} was not swept`);
      assert.ok(fs.existsSync(path.join(box.sb.path, 'activity', 'archive', 'old.json')));
    }
    assert.ok(fs.existsSync(keep), 'a live session was swept');
  });
});

// Over HTTP: the GET is machine-wide (a pair is ignored), the detail resolves the install the
// request names, and the toggle writes that install's flag only.
test('the activity route merges installs; detail and toggle act on the install named', async () => {
  await withTwoViewsServed(async ({ st, oc, cl, ocPair, clPair, get, post }) => {
    // A manifest makes the claude global active too (the fixture's own has none).
    fs.writeFileSync(path.join(cl, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    for (const [dir, title] of [[oc, 'opencode side'], [cl, 'claude side']]) {
      fs.mkdirSync(path.join(dir, 'activity'), { recursive: true });
      // Each copy in its own cwd: two sessions, not one seen by both installs.
      fs.writeFileSync(path.join(dir, 'activity', 's1.json'),
        JSON.stringify(liveSnap('s1', { title, cwd: dir })));
    }
    const ocKey = `opencode:global:${ocPair.path}`;
    const clKey = `claude:global:${clPair.path}`;
    const mine = (rows) => rows.filter((r) => r.install === ocKey || r.install === clKey);
    const read = async (p) => (await get('/api/activity', p)).json();

    const all = await read();
    assert.deepEqual(mine(all.activity).map((e) => [e.install, e.title]).sort(),
      [[clKey, 'claude side'], [ocKey, 'opencode side']]);
    assert.deepEqual(mine(all.installs).map((i) => [i.host, i.path, i.enabled]).sort(),
      [['claude', clPair.path, true], ['opencode', ocPair.path, true]]);
    // Machine-wide: a pair, even an unknown one, is ignored, and no per-install view is made.
    assert.equal((await get('/api/activity', { host: 'nope', path: '/no/such' })).status, 200);
    assert.equal(st._views.size, 0, 'the merged read made a per-install view');

    const title = async (p) => (await (await get('/api/activity/s1', p)).json()).session.title;
    assert.equal(await title(clPair), 'claude side');
    assert.equal(await title(ocPair), 'opencode side');

    assert.equal((await post('/api/activity', { ...clPair, enabled: false })).status, 200);
    assert.equal(fs.readFileSync(path.join(cl, '.geneseed-activity'), 'utf8'), 'off');
    assert.equal(fs.existsSync(path.join(oc, '.geneseed-activity')), false, 'the toggle leaked');
    const after = await read();
    assert.deepEqual(mine(after.activity).map((e) => e.install), [ocKey]);
    assert.deepEqual(mine(after.installs).map((i) => [i.host, i.enabled]).sort(),
      [['claude', false], ['opencode', true]]);
  });
});
