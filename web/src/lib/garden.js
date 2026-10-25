// The Activity garden: one pixel-art bonsai per live session, generated here as plain data
// so it can be tested without a DOM. Ported from the "canopy" path of the design prototype
// (docs/specs/2026-10-25-activity-garden.md, D2b/D2c/D12/D13); the lush and outlined styles
// were dropped by the user.
//
// What a tree says: the pot glaze is the host, the height is the turn count, the crown size
// is the context fill (its tips yellow past 80 %), a compaction cuts the crown flat and one
// rim notch marks each, a running sub-agent is a thick branch with its own pad, a finished
// one a pruned stub and a fallen leaf, and a cream blossom is a changed file on the pad of
// the AI that changed it.
//
// Deterministic: every random draw comes from a PRNG seeded by the session id. Each part
// draws from its OWN stream (trunk, branch side, each branch's length, each pad, the
// blossoms, the yellowing, the shoots, the moss, the fallen leaves), so a new turn, file or
// agent on the 2 s poll grows the tree instead of re-rolling it: the trunk's own stream
// draws one bark speck per trunk pixel, and a taller trunk must not move anything else.

export const W = 56
export const H = 56

const hash = (s) => {
  let h = 2166136261
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
const rng = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const clamp01 = (n) => Math.max(0, Math.min(1, n))

// Pot glaze per host: dark, mid, light. The mid tones also step apart in luminance
// (violet ~.06, blue ~.12, clay ~.23, grey ~.36), so the hosts are told apart without hue.
const GLAZE = {
  claude: ['#8E4A33', '#C46A4C', '#E3906F'],
  bob: ['#173F8C', '#2A5CC0', '#6A96E8'],
  opencode: ['#5E6670', '#98A2AD', '#C8D0D8'],
  openclaude: ['#2F1F55', '#4E3484', '#8A6CC8'],
}
// dark underside -> sunlit top
const CANOPY = {
  live: ['#16393D', '#1F5A55', '#2C7D55', '#5DA845', '#A8D23E'],
  sakura: ['#16393D', '#6E2A55', '#B83C80', '#E9649F', '#FFB0D2'],
  done: ['#5A2E14', '#8A4A1C', '#B8702A', '#DB9A3E', '#F2C46A'],
  idle: ['#2E3236', '#44494E', '#5E646A', '#7C8288', '#A2A7AC'],
}
// One foliage family per running sub-agent type, so two agents on one tree rarely share one.
const TINT = {
  developer: ['#123A3F', '#1A5A5E', '#24806F', '#3FB08A', '#8EE6C2'],
  explorer: ['#2C3A12', '#4A6418', '#6E9424', '#9CC23A', '#DDF07A'],
  reviewer: ['#16283F', '#1F3E66', '#2E5E92', '#4A86C4', '#9AC8F0'],
  tester: ['#3A3012', '#5E4C18', '#8A6E22', '#B8952E', '#EAD27A'],
}
const BARK_LIVE = ['#4E2E1C', '#7A4A2E', '#A2683F', '#C78A5A']
const BARK_IDLE = ['#34312F', '#4F4A46', '#6B6560', '#8A847E']
const MOSS_LIVE = ['#3E8E41', '#5FB14F']
const MOSS_IDLE = ['#4A4F54', '#62686E']
const BLOSSOM = '#FFF6E0'
const YELLOW = ['#E3C24A', '#C9A23A']
const SHOOT = ['#9BDD6A', '#D8F59A']
// Amber "!" and red "x" differ in lightness as well as hue and glyph.
const BUBBLE = { '!': '#E8B04A', x: '#FF6F69' }
const BLOSSOM_CAP = 12

// Agent type -> foliage family. Hosts name their agents freely (`Explore`,
// `general-purpose`, an OpenCode agent's own name), so this matches on substrings.
export function agentFamily(type) {
  const t = String(type || '').toLowerCase()
  if (/implement|develop/.test(t)) return 'developer'
  if (/explor/.test(t)) return 'explorer'
  if (/review/.test(t)) return 'reviewer'
  if (/test/.test(t)) return 'tester'
  return null
}

const needs = (s) => s?.status === 'blocked' || s?.status === 'waiting-input'

// Every file row the session reports: the uncapped `files_all` of a v2 snapshot, else the
// capped summary of a v1 one (basename only, all by the session).
function fileRows(s) {
  if (Array.isArray(s.files_all)) return s.files_all.filter((f) => f && typeof f === 'object')
  const items = Array.isArray(s.files?.items) ? s.files.items : []
  return items
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      file: f.file ?? null,
      path: f.path ?? null,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      by: f.by ?? null,
    }))
}

// `Number(null)` is 0: a null field must read as unknown, not as zero.
const num = (v) => (v == null || v === '' ? NaN : Number(v))

// Context fill in [0, 1], or null when the session does not report both numbers.
export function contextFill(s) {
  const used = num(s?.context?.used)
  const win = num(s?.context?.window)
  return Number.isFinite(used) && Number.isFinite(win) && win > 0 ? clamp01(used / win) : null
}

// The session reduced to what the generator draws from. Also the memo key's source.
export function treeInputs(s) {
  const files = fileRows(s)
  const agents = (Array.isArray(s.agents) ? s.agents : [])
    .filter((a) => a && typeof a === 'object')
    .map((a, i) => ({
      key: a.id ?? `#${i}`,
      id: a.id ?? null,
      type: a.type || null,
      running: a.status !== 'done',
      files: [],
    }))
  const byKey = new Map(agents.map((a) => [a.key, a]))
  const crown = []
  // Bob cannot tell a sub-agent's file from the parent's: every blossom goes on the crown.
  const attributed = s.attribution !== false
  for (const f of files) {
    if (!attributed || f.by == null) {
      crown.push(f)
      continue
    }
    let a = byKey.get(f.by)
    if (!a) {
      // A file by an agent the snapshot never listed: its branch is grown on the fly (S5).
      a = { key: f.by, id: f.by, type: 'agent', running: true, files: [] }
      agents.push(a)
      byKey.set(f.by, a)
    }
    a.files.push(f)
  }
  const fill = contextFill(s)
  const hasCtx = fill != null
  const used = hasCtx ? num(s.context.used) : NaN
  // Bob has no token data: its crown stays medium (D12).
  const ctx = hasCtx ? fill : 0.5
  const compactions = Math.max(0, Math.floor(Number(s.compactions) || 0))
  const cap = num(s.context_at_compaction)
  // regrowth = context now / context at the last compaction; unknown counts as just cut.
  const regrow =
    compactions === 0 ? 1 : hasCtx && Number.isFinite(cap) && cap > 0 ? clamp01(used / cap) : 0
  return {
    id: String(s.session_id ?? ''),
    host: GLAZE[s.host] ? s.host : 'claude',
    idle: s.status === 'idle',
    bubble: needs(s) ? '!' : s.error ? 'x' : null,
    turns: Math.max(0, Number(s.turns) || 0),
    ctx,
    compactions,
    compacted: compactions > 0 && regrow < 1,
    regrow,
    crown,
    agents,
  }
}

// A string that changes exactly when the drawing would: the 2 s poll re-renders a tree only
// when this moves. Labels, times and phase are left out on purpose.
export function treeKey(s, sakura = false) {
  const t = treeInputs(s)
  return JSON.stringify([
    t.id,
    t.host,
    t.idle,
    t.bubble,
    t.turns,
    Math.round(t.ctx * 100),
    t.compactions,
    Math.round(t.regrow * 100),
    t.crown.length,
    t.agents.map((a) => [a.key, a.type, a.running, a.files.length]),
    !!sakura,
  ])
}

// Draw one tree. Returns `{ width, height, runs, pads, bubble, fallen }`:
// - runs: `[{x, y, w, c, p}]`, one horizontal run of one colour; `p` is the index of the
//   pad that owns it in `pads`, or -1 for the trunk, pot, moss and bubble.
// - pads: `[{agentId, key, type, family, files, bbox}]`, the crown (agentId null) and each
//   running sub-agent; `bbox` is `{x, y, w, h}` in tree pixels, or null if nothing of it is left.
// - fallen: the finished sub-agents, `{agentId, type, files}`.
export function gardenTree(session, { sakura = false } = {}) {
  const t = treeInputs(session)
  const { id, idle } = t
  const age = Math.min(1, Math.log1p(t.turns) / Math.log1p(40))
  const k = 0.55 + 0.45 * age
  const r = rng(hash(id))
  const g = Array.from({ length: H }, () => Array(W).fill(null))
  const own = Array.from({ length: H }, () => Array(W).fill(-1))
  let owner = -1
  const put = (x, y, c) => {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && x < W && y >= 0 && y < H) {
      g[y][x] = c
      own[y][x] = owner
    }
  }
  const BARK = idle ? BARK_IDLE : BARK_LIVE
  const MOSS = idle ? MOSS_IDLE : MOSS_LIVE
  const crownPal = idle ? CANOPY.idle : sakura ? CANOPY.sakura : CANOPY.live

  // trunk: a seeded S-curve from the soil to the crown
  const base = 28
  const y0 = 41
  const top = Math.round(y0 - (9 + 18 * age))
  const amp = 1 + r() * 2 + 3 * age
  const ph = r() * Math.PI * 2
  const freq = 0.9 + r() * 0.6
  const trunkX = (u) => base + amp * Math.sin(u * Math.PI * freq + ph) - amp * Math.sin(ph)
  for (let y = y0; y >= top; y--) {
    const u = (y0 - y) / (y0 - top)
    const cx = trunkX(u)
    const w = 3 + 4.5 * age - (1.5 + 3.5 * age) * u
    for (let x = Math.floor(cx - w / 2); x <= Math.ceil(cx + w / 2); x++) {
      const e = (x - (cx - w / 2)) / w
      put(x, y, e < 0.25 ? BARK[3] : e > 0.75 ? BARK[0] : r() < 0.15 ? BARK[1] : BARK[2])
    }
  }
  // root flare
  for (let x = -6; x <= 6; x++) {
    put(base + x, y0, Math.abs(x) > 4 ? BARK[1] : BARK[2])
    if (Math.abs(x) <= 5) put(base + x, y0 - 1, Math.abs(x) > 3 ? BARK[1] : BARK[2])
  }

  const pads = []
  // A dense dome of small clumps, lit from the top left; dark limbs show through the gaps.
  const domePad = (cx, cy, rx, pal, files, key) => {
    rx *= 1.15
    cx = Math.max(rx + 2, Math.min(W - 3 - rx, cx))
    const pr = rng(hash(`${id}:pad:${key}`))
    const ry = rx * 0.72
    // Keep the dome's top inside the frame (clumps reach ~4.5 px past ry): a full-grown,
    // high-context crown would otherwise be clipped flat at y=0 and read as a compaction cut.
    cy = Math.max(cy, ry + 6)
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI * (0.15 + 0.7 * pr())
      const L = rx * (0.4 + 0.5 * pr())
      for (let s = 0; s < L; s++)
        put(cx + Math.cos(a) * s, cy + ry * 0.5 + Math.sin(a) * s * 0.8, BARK[0])
    }
    const n = Math.round(10 + rx * 1.6)
    const clumps = []
    for (let i = 0; i < n; i++) {
      const a = pr() * Math.PI * 2
      const d = Math.sqrt(pr())
      clumps.push([cx + Math.cos(a) * d * rx, cy + Math.sin(a) * d * ry, 1.8 + pr() * 2.2])
    }
    clumps.sort((p, q) => q[1] - p[1]) // lower clumps first, sunlit ones on top
    for (const [x0, yc, cr] of clumps) {
      const lvl = Math.max(
        0,
        Math.min(4, Math.round(4 * (1 - (yc - (cy - ry)) / (2 * ry)) + (pr() - 0.5))),
      )
      for (let y = Math.floor(yc - cr); y <= yc + cr; y++)
        for (let x = Math.floor(x0 - cr); x <= x0 + cr; x++) {
          const d = ((x - x0) ** 2 + (y - yc) ** 2) / (cr * cr)
          if (d > 1 + (pr() - 0.5) * 0.5) continue
          const lit = x - x0 + (y - yc) < -cr * 0.3 ? 1 : y - yc > cr * 0.5 ? -1 : 0
          put(x, y, pal[Math.max(0, Math.min(4, lvl + lit))])
        }
    }
    // Blossoms on their own stream: one more file adds a blossom, it does not move the rest.
    const br = rng(hash(`${id}:bloom:${key}`))
    for (let i = 0; i < Math.min(files, BLOSSOM_CAP); i++)
      put(cx + (br() * 2 - 1) * rx * 0.8, cy - br() * ry * 0.9, BLOSSOM)
    return { rx, cy }
  }

  // branches: one per sub-agent, alternating sides up the trunk
  let side = rng(hash(`${id}:side`))() < 0.5 ? -1 : 1
  const fallen = []
  t.agents.forEach((a, i) => {
    const u = 0.25 + 0.55 * (i / Math.max(1, t.agents.length - 1))
    const ty = Math.round(y0 - u * (y0 - top))
    const tx = trunkX(u)
    if (!a.running) {
      // a finished sub-agent: a pruned stub on the trunk, its leaf falls to the moss
      const w = (3 + 4.5 * age - (1.5 + 3.5 * age) * u) / 2
      owner = -1
      put(tx + side * (w + 1), ty, BARK[3])
      put(tx + side * (w + 2), ty - 1, BARK[2])
      fallen.push({ agentId: a.id, type: a.type, files: a.files })
      side = -side
      return
    }
    const L = Math.round((12 + Math.floor(rng(hash(`${id}:branch:${a.key}`))() * 4)) * k)
    owner = -1
    for (let s = 0; s <= L; s++) {
      const bx = tx + side * s
      const by = ty - s * 0.45
      put(bx, by, BARK[s < L / 2 ? 1 : 2])
      put(bx, by + 1, BARK[0])
      if (s < L * 0.6) put(bx, by + 2, BARK[0])
    }
    const family = idle ? null : agentFamily(a.type)
    const pal = family ? TINT[family] : crownPal
    owner = pads.length
    pads.push({ agentId: a.id, key: a.key, type: a.type, family, files: a.files, bbox: null })
    domePad(
      tx + side * L,
      ty - L * 0.45 - 2,
      (8 + Math.min(a.files.length, 6) * 0.6) * k,
      pal,
      a.files.length,
      a.key,
    )
    side = -side
  })

  const crownIdx = pads.length
  pads.push({ agentId: null, key: null, type: null, family: null, files: t.crown, bbox: null })
  owner = crownIdx
  const crx0 = (4 + 7 * t.ctx + Math.min(t.crown.length, 6) * 0.5) * k * 1.35
  const { rx: crx, cy: ccy } = domePad(trunkX(1), top - 3, crx0, crownPal, t.crown.length, 'crown')
  if (t.ctx > 0.8 && !t.compacted) {
    // context nearly full: the crown yellows at the tips
    const yr = rng(hash(`${id}:yellow`))
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (own[y][x] === crownIdx && g[y][x] !== BLOSSOM && y < ccy - crx * 0.2 && yr() < 0.55)
          g[y][x] = yr() < 0.5 ? YELLOW[0] : YELLOW[1]
  }
  if (t.compacted) {
    // pruned flat at compaction; the cut rises and fresh shoots poke through as context refills.
    // Only the crown is cut: a running sub-agent keeps its own context.
    const sr = rng(hash(`${id}:shoots`))
    const cut = Math.round(ccy - crx * 0.15 - t.regrow * crx * 0.5)
    for (let y = 0; y < Math.max(0, cut); y++)
      for (let x = 0; x < W; x++)
        if (own[y][x] === crownIdx) {
          g[y][x] = null
          own[y][x] = -1
        }
    if (cut >= 0 && cut < H) {
      for (let x = 0; x < W; x++) {
        if (own[cut][x] !== crownIdx || sr() >= 0.12 + t.regrow * 0.5) continue
        const h = 1 + Math.floor(sr() * (1 + t.regrow * 3))
        for (let j = 1; j <= h; j++) put(x, cut - j, j === h ? SHOOT[1] : SHOOT[0])
      }
    }
  }
  owner = -1
  const fr = rng(hash(`${id}:fallen`))
  fallen.forEach((_, i) =>
    put(16 + ((i * 7 + Math.floor(fr() * 4)) % 24), 40, CANOPY.done[2 + (i % 2)]),
  )
  // one notch on the rim per compaction
  for (let i = 0; i < Math.min(t.compactions, 6); i++) put(15 + i * 2, 42, BLOSSOM)

  // a shallow pot glazed by host, moss line on top
  const [gd, gm, gl] = GLAZE[t.host]
  for (let y = 42; y <= 46; y++) {
    const inset = y <= 43 ? 0 : Math.floor((y - 43) * 0.45) + 2
    for (let x = 13 + inset; x <= 42 - inset; x++) {
      if (y === 42 && g[y][x] === BLOSSOM) continue // keep the notches
      let c = gm
      if (y <= 43) c = y === 42 ? gl : gd
      else if (y === 46 || x === 13 + inset || x === 42 - inset) c = gd
      put(x, y, c)
    }
  }
  const mr = rng(hash(`${id}:moss`))
  for (let x = 15; x <= 40; x++) {
    put(x, 41, mr() < 0.5 ? MOSS[0] : MOSS[1])
    if (mr() < 0.35) put(x, 40, MOSS[0])
  }
  for (let x = 16; x <= 39; x++) put(x, 47, '#00000055')

  if (t.bubble) {
    // pixel speech bubble: needs-you "!" or error "x"
    const bx = 40
    const by = 3
    const col = BUBBLE[t.bubble]
    for (let y = by; y < by + 7; y++)
      for (let x = bx; x < bx + 7; x++)
        put(x, y, y === by || y === by + 6 || x === bx || x === bx + 6 ? col : '#14191F')
    put(bx + 1, by + 7, col)
    if (t.bubble === '!') {
      for (let y = by + 2; y <= by + 3; y++) put(bx + 3, y, col)
      put(bx + 3, by + 5, col)
    } else {
      for (const [dx, dy] of [
        [2, 2],
        [4, 2],
        [3, 3],
        [2, 4],
        [4, 4],
      ])
        put(bx + dx, by + dy, col)
    }
  }

  // merge horizontal runs of one colour AND one owner, and measure each pad
  const runs = []
  const box = pads.map(() => null)
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      const c = g[y][x]
      const p = own[y][x]
      if (!c) {
        x++
        continue
      }
      let e = x
      while (e + 1 < W && g[y][e + 1] === c && own[y][e + 1] === p) e++
      runs.push({ x, y, w: e - x + 1, c, p })
      if (p >= 0) {
        const b = (box[p] ||= { x0: x, y0: y, x1: e, y1: y })
        b.x0 = Math.min(b.x0, x)
        b.x1 = Math.max(b.x1, e)
        b.y1 = y
      }
      x = e + 1
    }
  }
  pads.forEach((pd, i) => {
    const b = box[i]
    pd.bbox = b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 } : null
  })
  return { width: W, height: H, runs, pads, bubble: t.bubble, fallen }
}

// ---- shelves ---------------------------------------------------------------------------

const lastSeg = (p) => {
  if (!p) return ''
  const parts = String(p).replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || String(p)
}
const norm = (p) => (p ? String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '')

export const OUTSIDE = 'outside a repo'

// One shelf per main repo (D11), named by its basename; a v1 snapshot (no repo) sits on a
// shelf named after its working dir, and one with no dir on the "outside a repo" shelf.
// Trees are sorted by worktree, then session id, so a tree stays where the eye left it.
// `worktree` is the linked worktree's folder name, or null on the main worktree.
export function groupShelves(sessions) {
  const by = new Map()
  for (const s of sessions || []) {
    const repo = s.repo || s.root
    const key = s.repo_key || (repo ? norm(repo) : s.cwd ? `cwd:${norm(s.cwd)}` : OUTSIDE)
    const name = lastSeg(repo || s.cwd) || OUTSIDE
    if (!by.has(key)) by.set(key, { key, name, trees: [] })
    const worktree = s.root && repo && norm(s.root) !== norm(repo) ? lastSeg(s.root) : null
    by.get(key).trees.push({ s, worktree })
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const shelves = [...by.values()]
  for (const sh of shelves)
    sh.trees.sort(
      (a, b) =>
        cmp(a.worktree || '', b.worktree || '') ||
        cmp(String(a.s.session_id), String(b.s.session_id)),
    )
  return shelves.sort(
    (a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.key, b.key),
  )
}

// ---- collisions --------------------------------------------------------------------------

// Red or amber is decided per PAIR of sessions, from their own roots in `writers`. The API's
// `kind` says whether ANY two writers share a root, and a session and its own sub-agent
// always do, so it would paint red a pair that only meets across two worktrees.
const rootsOf = (c, sid) =>
  new Set((c.writers || []).filter((w) => w.sid === sid).map((w) => norm(w.root)))
function pairKind(c, a, b) {
  const ra = rootsOf(c, a)
  for (const r of rootsOf(c, b)) if (ra.has(r)) return 'same-worktree'
  return 'cross-worktree'
}
const sidsOf = (c) => [...new Set((c.writers || []).map((w) => w.sid))]

// The threads of one shelf: one per pair of trees `{a, b, kind}` (indexes into `trees`),
// red outranking amber when the pair shares several files.
export function shelfPairs(trees, collisions) {
  const at = new Map(trees.map((t, i) => [t.s.session_id, i]))
  const pairs = new Map()
  for (const c of collisions || []) {
    const sids = sidsOf(c).filter((sid) => at.has(sid))
    for (let x = 0; x < sids.length; x++)
      for (let y = x + 1; y < sids.length; y++) {
        const a = at.get(sids[x])
        const b = at.get(sids[y])
        const k = a < b ? `${a}-${b}` : `${b}-${a}`
        const kind = pairKind(c, sids[x], sids[y])
        if (!pairs.has(k) || kind === 'same-worktree') pairs.set(k, { a, b, kind })
      }
  }
  return [...pairs.values()]
}

// The files one session shares with another live session: `[{path, kind}]`, kind red when
// it shares the file with any other session in its own worktree.
export function sharedFiles(sid, collisions) {
  const out = []
  for (const c of collisions || []) {
    const others = sidsOf(c).filter((o) => o !== sid)
    if (!others.length || !sidsOf(c).includes(sid)) continue
    const red = others.some((o) => pairKind(c, sid, o) === 'same-worktree')
    out.push({ path: c.path, kind: red ? 'same-worktree' : 'cross-worktree' })
  }
  return out
}

export const COLLAPSE_AT = 10

// Past `limit` trees, quiet shelves fold into chips (D8), the largest first, until the trees
// left standing fit. A quiet shelf is one where no tree is working or needs you: a shelf that
// is busy or waits on you never folds, and the last standing shelf never folds either, so
// the garden is never chips alone. Returns the shelves with `collapsed: true|false`.
const awake = (s) => s?.status === 'busy' || needs(s)
export function collapseShelves(shelves, limit = COLLAPSE_AT) {
  const out = shelves.map((sh) => ({ ...sh, collapsed: false }))
  let shown = out.reduce((n, sh) => n + sh.trees.length, 0)
  if (shown <= limit) return out
  let standing = out.length
  const quiet = out
    .filter((sh) => !sh.trees.some((t) => awake(t.s)))
    .sort((a, b) => b.trees.length - a.trees.length || (a.key < b.key ? -1 : 1))
  for (const sh of quiet) {
    if (shown <= limit || standing <= 1) break
    sh.collapsed = true
    shown -= sh.trees.length
    standing--
  }
  return out
}
