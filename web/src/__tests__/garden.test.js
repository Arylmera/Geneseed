import { describe, it, expect } from 'vitest'
import {
  agentFamily,
  cardKey,
  collapseShelves,
  detailHref,
  detailTarget,
  installNames,
  contextFill,
  gardenTree,
  groupShelves,
  shelfPairs,
  sharedFiles,
  treeKey,
  OUTSIDE,
} from '../lib/garden.js'

const file = (path, by = null) => ({
  file: path.split('/').pop(),
  path,
  additions: 2,
  deletions: 1,
  by,
})
const sess = (over = {}) => ({
  session_id: 'ses-1',
  host: 'claude',
  status: 'busy',
  cwd: '/git/app',
  root: '/git/app',
  repo: '/git/app',
  repo_key: '/git/app',
  turns: 20,
  context: { used: 100000, window: 200000 },
  compactions: 0,
  context_at_compaction: null,
  agents: [],
  files_all: [],
  ...over,
})
// The rows of the tree, top to bottom: the first and last row holding a pixel.
const rowsOf = (t) => {
  const ys = t.runs.map((r) => r.y)
  return Math.max(...ys) - Math.min(...ys) + 1
}
const finite = (t) =>
  t.runs.every((r) => [r.x, r.y, r.w].every(Number.isFinite) && typeof r.c === 'string')

describe('gardenTree', () => {
  it('draws the same runs for the same session id', () => {
    // Seeded by session_id: a poll that re-draws an unchanged session must not move a pixel.
    expect(gardenTree(sess())).toEqual(gardenTree(sess()))
  })

  it('draws a different tree for a different id', () => {
    expect(gardenTree(sess({ session_id: 'ses-2' })).runs).not.toEqual(gardenTree(sess()).runs)
  })

  it('grows taller with turns', () => {
    // Age is log(turns), full grown at ~40: one turn is a sapling, 40 a full tree.
    const young = rowsOf(gardenTree(sess({ turns: 1, context: { used: 10000, window: 200000 } })))
    const old = rowsOf(gardenTree(sess({ turns: 40, context: { used: 10000, window: 200000 } })))
    expect(old).toBeGreaterThan(young)
  })

  it('treats a compaction with no context_at_compaction as just cut, without NaN', () => {
    // v2 writers may know the count but not the size before the cut; null and 0 must not divide.
    for (const cac of [null, 0]) {
      const t = gardenTree(sess({ compactions: 2, context_at_compaction: cac }))
      expect(finite(t)).toBe(true)
      expect(t.runs.length).toBeGreaterThan(0)
    }
    expect(finite(gardenTree(sess({ compactions: 1, context: null })))).toBe(true)
  })

  it('cuts the crown lower after a compaction than before it', () => {
    // Compaction prunes the crown flat: its top row drops.
    const top = (t) => t.pads[t.pads.length - 1].bbox.y
    const before = gardenTree(sess({ turns: 60, context: { used: 180000, window: 200000 } }))
    const after = gardenTree(
      sess({
        turns: 60,
        context: { used: 180000, window: 200000 },
        compactions: 1,
        context_at_compaction: null,
      }),
    )
    expect(top(after)).toBeGreaterThan(top(before))
  })

  it('gives a running sub-agent a pad and a finished one none', () => {
    const t = gardenTree(
      sess({
        agents: [
          { id: 'a1', type: 'developer', status: 'running', started: 1 },
          { id: 'a2', type: 'Explore', status: 'done', started: 1 },
        ],
        files_all: [file('src/a.js', 'a1'), file('src/b.js', 'a2'), file('README.md')],
      }),
    )
    // pads: the running agent's, then the crown. The done agent is a stub + fallen leaf.
    expect(t.pads.map((p) => p.agentId)).toEqual(['a1', null])
    expect(t.pads[0].family).toBe('developer')
    expect(t.pads[0].files.map((f) => f.path)).toEqual(['src/a.js'])
    expect(t.pads[1].files.map((f) => f.path)).toEqual(['README.md'])
    expect(t.fallen).toEqual([{ agentId: 'a2', type: 'Explore', files: [file('src/b.js', 'a2')] }])
  })

  it('grows a branch for a file whose author the snapshot never listed', () => {
    const t = gardenTree(sess({ files_all: [file('x.js', 'ghost')] }))
    expect(t.pads.map((p) => [p.agentId, p.type])).toEqual([
      ['ghost', 'agent'],
      [null, null],
    ])
  })

  it('puts every blossom on the crown when Bob has no attribution', () => {
    const t = gardenTree(
      sess({
        host: 'bob',
        attribution: false,
        context: null,
        agents: [{ id: null, type: 'spawn', status: 'running', started: 1 }],
        files_all: [file('a.js', 'whatever'), file('b.js')],
      }),
    )
    const agentPads = t.pads.filter((p) => p.key != null)
    expect(agentPads).toHaveLength(1)
    expect(agentPads.every((p) => p.files.length === 0)).toBe(true)
    expect(t.pads.find((p) => p.key == null).files).toHaveLength(2)
  })

  it('renders a v1 snapshot as a minimal tree', () => {
    // v1: no turns, context, agents, files_all, root or repo; files only as a capped summary.
    const v1 = {
      session_id: 'old',
      status: 'busy',
      cwd: '/x/legacy',
      files: {
        count: 1,
        additions: 2,
        deletions: 0,
        items: [{ file: 'a.js', additions: 2, deletions: 0 }],
      },
    }
    const t = gardenTree(v1)
    expect(finite(t)).toBe(true)
    expect(t.pads).toHaveLength(1)
    expect(t.pads[0].files.map((f) => f.file)).toEqual(['a.js'])
    expect(t.bubble).toBe(null)
  })

  it('raises a ! bubble when the session needs you and an x on an error', () => {
    expect(gardenTree(sess({ status: 'blocked' })).bubble).toBe('!')
    expect(gardenTree(sess({ status: 'waiting-input', error: 'e' })).bubble).toBe('!')
    expect(gardenTree(sess({ error: 'boom' })).bubble).toBe('x')
  })

  it('paints the sakura crown in another palette, same shape', () => {
    const a = gardenTree(sess())
    const b = gardenTree(sess(), { sakura: true })
    expect(b.runs.map((r) => r.c)).not.toEqual(a.runs.map((r) => r.c))
    expect(b.pads.map((p) => p.bbox)).toEqual(a.pads.map((p) => p.bbox))
  })
})

describe('treeKey', () => {
  it('ignores what the drawing does not read', () => {
    // The 2 s poll changes updated_at and phase on every turn: those must not rebuild the tree.
    expect(treeKey(sess({ updated_at: 1, phase: 'Bash' }))).toBe(
      treeKey(sess({ updated_at: 2, phase: 'Edit' })),
    )
    expect(treeKey(sess({ turns: 21 }))).not.toBe(treeKey(sess()))
    expect(treeKey(sess(), true)).not.toBe(treeKey(sess()))
  })
})

describe('agentFamily', () => {
  it.each([
    ['developer', 'developer'],
    ['implementer', 'developer'],
    ['Explore', 'explorer'],
    ['code-reviewer', 'reviewer'],
    ['tester', 'tester'],
    ['general-purpose', null],
    [null, null],
  ])('%s -> %s', (type, fam) => expect(agentFamily(type)).toBe(fam))
})

describe('shelves', () => {
  it('puts one shelf per repo, worktrees on it, v1 by cwd, no cwd outside a repo', () => {
    const shelves = groupShelves([
      sess({ session_id: 'b' }),
      sess({ session_id: 'a', root: '/git/app/.wt/feat' }),
      { session_id: 'v1', cwd: '/x/legacy' },
      { session_id: 'none' },
    ])
    expect(shelves.map((s) => [s.name, s.trees.map((t) => [t.s.session_id, t.worktree])])).toEqual([
      [
        'app',
        [
          ['b', null],
          ['a', 'feat'],
        ],
      ],
      ['legacy', [['v1', null]]],
      [OUTSIDE, [['none', null]]],
    ])
  })

  const many = (repo, n, status = 'busy') =>
    Array.from({ length: n }, (_, i) =>
      sess({ session_id: `${repo}-${i}`, repo, root: repo, repo_key: repo, status }),
    )

  it('stands every tree while there are ten or fewer', () => {
    const out = collapseShelves(groupShelves([...many('/a', 5), ...many('/b', 5)]))
    expect(out.map((s) => s.collapsed)).toEqual([false, false])
  })

  it('never folds a shelf with a working tree, nor the last standing shelf', () => {
    // 11 busy sessions in one repo: the shelf is awake, so it stands.
    expect(collapseShelves(groupShelves(many('/a', 11)))[0].collapsed).toBe(false)
    // 11 idle ones: quiet, but the only shelf, so it stands too.
    expect(collapseShelves(groupShelves(many('/a', 11, 'idle')))[0].collapsed).toBe(false)
    // Two quiet shelves of 6: folding one is enough (6 <= 10), and one always stands.
    const two = collapseShelves(groupShelves([...many('/a', 6, 'idle'), ...many('/b', 6, 'idle')]))
    expect(two.map((s) => s.collapsed).filter(Boolean)).toHaveLength(1)
    // A busy shelf next to an idle one: only the idle one may fold.
    const mixed = collapseShelves(groupShelves([...many('/a', 8), ...many('/b', 4, 'idle')]))
    expect(mixed.map((s) => [s.name, s.collapsed])).toEqual([
      ['a', false],
      ['b', true],
    ])
  })

  it('folds quiet shelves past ten trees, never one that needs you', () => {
    const out = collapseShelves(
      groupShelves([
        ...many('/a', 4),
        ...many('/b', 3, 'idle'),
        ...many('/c', 3),
        ...many('/d', 2, 'waiting-input'),
      ]),
    )
    // 12 trees: folding the all-idle /b leaves 9, so it stops there.
    expect(out.map((s) => [s.name, s.collapsed])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
      ['d', false],
    ])
    const crowded = collapseShelves(groupShelves(many('/d', 12, 'blocked')))
    expect(crowded[0].collapsed).toBe(false)
  })
})

describe('collisions', () => {
  // A (with its own sub-agent) in the main worktree, B in a linked worktree, both on x.js.
  // The API calls this `same-worktree`, because A and its sub-agent share a root.
  const col = {
    repo: '/app',
    path: 'x.js',
    kind: 'same-worktree',
    writers: [
      { sid: 'A', by: null, root: '/app' },
      { sid: 'A', by: 'a1', root: '/app' },
      { sid: 'B', by: null, root: '/app/.wt/feat' },
    ],
  }
  const trees = [{ s: { session_id: 'A' } }, { s: { session_id: 'B' } }]

  it('decides red or amber per pair of trees, from their own roots', () => {
    expect(shelfPairs(trees, [col])).toEqual([{ a: 0, b: 1, kind: 'cross-worktree' }])
    expect(sharedFiles('A', [col])).toEqual([{ path: 'x.js', kind: 'cross-worktree' }])
    expect(sharedFiles('B', [col])).toEqual([{ path: 'x.js', kind: 'cross-worktree' }])
  })

  it('is red when the two sessions share a worktree, whatever case the root is in', () => {
    const same = {
      ...col,
      kind: 'cross-worktree',
      writers: [
        { sid: 'A', by: null, root: 'C:\\app' },
        { sid: 'B', by: null, root: 'c:/app' },
      ],
    }
    expect(shelfPairs(trees, [same])).toEqual([{ a: 0, b: 1, kind: 'same-worktree' }])
    expect(sharedFiles('A', [same])).toEqual([{ path: 'x.js', kind: 'same-worktree' }])
  })

  it('draws no thread for a file only one session and its own sub-agent share', () => {
    const own = { ...col, writers: col.writers.slice(0, 2) }
    expect(shelfPairs(trees, [own])).toEqual([])
    expect(sharedFiles('A', [own])).toEqual([])
  })
})

describe('growth details', () => {
  const YELLOW = ['#E3C24A', '#C9A23A']
  const crownRuns = (t) => t.runs.filter((r) => r.p === t.pads.length - 1)

  it('yellows the crown tips past 80 % context, not below', () => {
    const hot = gardenTree(sess({ context: { used: 180000, window: 200000 } }))
    const cool = gardenTree(sess({ context: { used: 150000, window: 200000 } }))
    expect(crownRuns(hot).some((r) => YELLOW.includes(r.c))).toBe(true)
    expect(crownRuns(cool).some((r) => YELLOW.includes(r.c))).toBe(false)
  })

  it('cuts one rim notch per compaction, six at most', () => {
    const notches = (n) =>
      gardenTree(sess({ compactions: n, context_at_compaction: 190000 }))
        .runs.filter((r) => r.y === 42 && r.c === '#FFF6E0')
        .reduce((w, r) => w + r.w, 0)
    expect([0, 2, 9].map(notches)).toEqual([0, 2, 6])
  })

  it('raises the cut as context refills toward its size at compaction', () => {
    const top = (used) =>
      gardenTree(
        sess({
          turns: 60,
          compactions: 1,
          context: { used, window: 400000 },
          context_at_compaction: 200000,
        }),
      ).pads.at(-1).bbox.y
    // regrowth 0.25 versus 0.9: the fuller regrowth reaches higher (a smaller y).
    expect(top(180000)).toBeLessThan(top(50000))
  })

  it('paints an idle tree grey', () => {
    const grey = (c) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
      return Math.abs(r - g) < 12 && Math.abs(g - b) < 12
    }
    const idle = crownRuns(gardenTree(sess({ status: 'idle' }))).filter((r) => r.c !== '#FFF6E0')
    const busy = crownRuns(gardenTree(sess())).filter((r) => r.c !== '#FFF6E0')
    expect(idle.every((r) => grey(r.c))).toBe(true)
    expect(busy.every((r) => grey(r.c))).toBe(false)
  })

  it('reads a null context.used as unknown, not as an empty context', () => {
    expect(contextFill(sess({ context: { used: null, window: 200000 } }))).toBe(null)
    expect(contextFill(sess({ context: { used: 50000, window: null } }))).toBe(null)
    expect(contextFill(sess({ context: { used: 50000, window: 200000 } }))).toBe(0.25)
    // Unknown draws the medium crown, the same as no context at all.
    expect(gardenTree(sess({ context: { used: null, window: 200000 } }))).toEqual(
      gardenTree(sess({ context: null })),
    )
  })

  it('keeps every pad on its side of the trunk as the turns grow', () => {
    const sides = (id, turns) =>
      gardenTree(
        sess({
          session_id: id,
          turns,
          agents: [
            { id: 'a', type: 'developer', status: 'running', started: 0 },
            { id: 'b', type: 'tester', status: 'running', started: 0 },
          ],
        }),
      )
        .pads.slice(0, 2)
        .map((p) => Math.sign(p.bbox.x + p.bbox.w / 2 - 28))
    for (const id of ['ses-1', 'abc', 'zz9']) {
      const at5 = sides(id, 5)
      for (const turns of [10, 20, 40]) expect(sides(id, turns)).toEqual(at5)
    }
  })

  it('keeps a full-grown, high-context crown inside the frame', () => {
    // Clipped at y=0 it would read as a compaction cut.
    const t = gardenTree(
      sess({
        turns: 60,
        context: { used: 200000, window: 200000 },
        files_all: Array.from({ length: 8 }, (_, i) => file(`f${i}.js`)),
      }),
    )
    expect(t.pads.at(-1).bbox.y).toBeGreaterThanOrEqual(1)
  })
})

// D2: the merged garden holds one session id from two installs as two cards, so collisions
// match a writer to a tree by install + id (`cardKey`), never by id alone.
describe('cards across installs', () => {
  const col = {
    repo: '/app',
    path: 'x.js',
    kind: 'cross-worktree',
    writers: [
      { sid: 's1', by: null, root: '/app', install: 'claude:global:/h/cl' },
      { sid: 's1', by: null, root: '/app/.wt/b', install: 'opencode:global:/h/oc' },
    ],
  }
  const trees = [
    { s: { session_id: 's1', install: 'claude:global:/h/cl' } },
    { s: { session_id: 's1', install: 'opencode:global:/h/oc' } },
  ]

  it('threads the same id from two installs as two trees', () => {
    expect(shelfPairs(trees, [col])).toEqual([{ a: 0, b: 1, kind: 'cross-worktree' }])
    expect(sharedFiles(cardKey(trees[0].s), [col])).toEqual([
      { path: 'x.js', kind: 'cross-worktree' },
    ])
    expect(cardKey(trees[0].s)).not.toBe(cardKey(trees[1].s))
    expect(cardKey({ session_id: 's1' })).toBe('s1') // a card with no install keys by id
  })

  it('names an install by host, adding the scope, then the folder, only when needed', () => {
    const row = (host, scope, path) => ({ install: `${host}:${scope}:${path}`, host, scope, path })
    const names = installNames([
      row('opencode', 'global', '/h/oc'),
      row('claude', 'global', '/h/cl'),
      row('claude', 'project', '/w/app'),
      row('bob', 'project', '/w/one'),
      row('bob', 'project', '/w/two'),
    ])
    expect([...names.values()]).toEqual([
      'opencode',
      'claude · global',
      'claude · project',
      'bob · one',
      'bob · two',
    ])
  })

  // The server's `key` (id + checkout) never names an install: a merged card whose shown copy
  // moves to the other install keeps its key, so its React key, hover and threads hold still.
  it('keeps the card key when only the install a card is shown from changes', () => {
    const k = 's1\0/w/main'
    const before = { key: k, session_id: 's1', install: 'claude:global:/h/cl' }
    const after = { ...before, install: 'claude:project:/w/main' }
    expect(cardKey(after)).toBe(cardKey(before))
    const col = {
      repo: '/w',
      path: 'x.js',
      kind: 'cross-worktree',
      writers: [
        { sid: 's1', by: null, root: '/w/main', install: 'claude:global:/h/cl', key: k },
        { sid: 's2', by: null, root: '/w/b', install: 'bob:global:/h/bob', key: 's2\0/w/b' },
      ],
    }
    const trees = [{ s: after }, { s: { key: 's2\0/w/b', session_id: 's2' } }]
    expect(shelfPairs(trees, [col])).toEqual([{ a: 0, b: 1, kind: 'cross-worktree' }])
  })

  it('parts two projects in same-named folders by a longer path tail, then the whole path', () => {
    const row = (path) => ({ install: `bob:project:${path}`, host: 'bob', scope: 'project', path })
    const names = installNames([
      row('/w/a/app'),
      row('/w/b/app'),
      row('/w/c/x/app'),
      row('/v/c/x/app'),
      row('/one'),
      row('/z/one'),
    ])
    expect([...names.values()]).toEqual([
      'bob · a/app',
      'bob · b/app',
      'bob · w/c/x/app',
      'bob · v/c/x/app',
      'bob · /one',
      'bob · z/one',
    ])
  })

  it('writes the install into the detail link, and reads it back', () => {
    const href = detailHref('ses a', { host: 'claude', path: 'C:\\w\\a&b' })
    expect(href).toBe('#/activity/ses%20a?host=claude&path=C%3A%5Cw%5Ca%26b')
    // The router hands the page its item decoded, query included; the install comes from the
    // raw hash, where the query is still encoded.
    expect(detailTarget('ses a?host=claude&path=C:\\w\\a&b', href)).toEqual({
      sid: 'ses a',
      install: { host: 'claude', path: 'C:\\w\\a&b' },
    })
    expect(detailTarget('ses a', '#/activity/ses%20a')).toEqual({
      sid: 'ses a',
      install: undefined,
    })
    expect(detailHref('s', undefined)).toBe('#/activity/s')
  })
})
