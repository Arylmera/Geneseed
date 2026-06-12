# Cultivar Web Console Re-skin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the existing `geneseed web` React app to match the "Cultivar" design handoff pixel-perfectly — new design system, left rail, terminal topbar, console drawer, and restyled pages — wired to the real `/api`, preserving every existing behaviour (job polling, cancel, restore, MCP toggles, wikilinks, offline zip).

**Architecture:** Keep the existing app skeleton (hash router, pages fetch their own data, `App.jsx` owns overview/jobs/console state). Replace `styles.css` wholesale with the Cultivar design system, rewrite `accents.js` for the new palette + light mode, add an `Icon` component (line-drawn SVG paths from the prototype), and restyle each page to the prototype's exact DOM/classes. The Dashboard gains three switchable directions (Status / Lineage / Operator) per the confirmed scope.

**Tech Stack:** React 18 + Vite 5 + vitest/@testing-library (unchanged, no new deps). One tiny server change (config count in `/api/overview`).

**Design source of truth (read these, they ARE the spec):**
- `C:\Users\guill\Downloads\geneseed\project\geneseed\cultivar.css` — the full design system CSS
- `C:\Users\guill\Downloads\geneseed\project\geneseed\ui.jsx` — icons + atoms
- `C:\Users\guill\Downloads\geneseed\project\geneseed\shell.jsx` — rail, topbar, console drawer, voice popover, accent logic
- `C:\Users\guill\Downloads\geneseed\project\geneseed\dashboard.jsx` — three dashboard directions
- `C:\Users\guill\Downloads\geneseed\project\geneseed\tabs.jsx` — Library, Graph, Changes, Doctor, Themes, Settings
- `C:\Users\guill\Downloads\geneseed\project\geneseed\mock.js` — mock data shapes (for mapping only — NEVER copy mock content into the app)

**Mock → real API mapping (memorize before any task):**

| Design needs | Real source |
|---|---|
| `overview` (theme, accent, emit, target, deployed, counts, doctor, diff, build_time) | `GET /api/overview` (counts lacks `config` — Task 1 adds it; no `readiness`/`fp` fields) |
| readiness % (germination ring) | **derived client-side** (Task 4, exact formula given) |
| per-theme `tagline`, `sigil`, `blurb`, `accent` | `GET /api/themes` → `themes[]` |
| `installed_fp`, `source_fp`, `version_verdict`, `python`, `root`, memory facts | `GET /api/setup` |
| HEADLINES (hero headline per voice) | **client-side map** (copied from mock — it's UI copy, not data) |
| activity feed | `GET /api/jobs` → jobs have `id, action, status, output, duration, started` (epoch secs) |
| KPI sparklines | **omitted** — no history endpoint; KPI cards keep label/value/foot only |
| diff files | `GET /api/diff` → `files[{rel, status: edited|added|missing, diff: [unified-diff strings]}]` — classify lines by prefix |
| graph | `GET /api/graph` → `{nodes[{id,type}], edges[{source,target}]}` (ALL agents+skills, not the mock's subset) |
| mcp | `GET /api/mcp` → targets with `exists`, `commented`, servers with `preset`, `state: enabled|disabled|absent` |
| library item body | `GET /api/item/<type>/<name>` → real markdown `body` + resolved `links` (render with existing `Markdown.jsx`, NOT the mock's fabricated "Purpose" prose) |

**Deviations from the prototype (all deliberate, all confirmed or forced by reality):**
1. KPI sparklines omitted (no history data; fake data in a real console is a lie).
2. Activity feed shows real job history, not the mock's hardcoded events.
3. Changes page also renders the `missing` status (mock only had edited/added).
4. Console drawer keeps the existing per-run **Cancel** button (real jobs are cancellable).
5. Graph renders the full node set; keeps the existing "orphans dimmed at rest" behaviour plus the prototype's hover-isolate.
6. Themes "Apply voice" keeps the existing `window.confirm` (it triggers a real rebuild).
7. Google Fonts load via CSS `@import` exactly as the prototype; on offline/corporate machines they degrade to the declared system fallbacks — acceptable, no vendoring.
8. Topbar prompt path shows the real deploy target (home dir shortened to `~`), not the mock's `~/code/acme-api`.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `rituals/web.py` | modify (1 line) | add `config` to overview counts |
| `tests/test_web.py` | modify | assert `config` count present |
| `web/index.html` | modify | new title + Cultivar favicon |
| `web/src/styles.css` | replace | Cultivar design system + app-specific extras |
| `web/src/accents.js` | replace | new palette, ACCENT_2, ink, `applyAccent(el, name, mode)` |
| `web/src/components/Icon.jsx` | create | `ICONS` path map, `<Icon>`, `<Sprout>` |
| `web/src/App.jsx` | replace | `.app` grid shell, Rail, Topbar, VoicePopover, console drawer state, light/dark mode |
| `web/src/components/Console.jsx` | replace | bottom drawer (was right dock), keep cancel/clear/autoscroll |
| `web/src/components/Search.jsx` | replace | topbar search with icon + `/` shortcut |
| `web/src/pages/Dashboard.jsx` | replace | 3 directions + Ring + KPI strip + genome + activity feed + MiniGraph |
| `web/src/pages/Section.jsx` | replace | Library: lib-tabs + lib-rows + detail-doc |
| `web/src/pages/Graph.jsx` | modify | header/legend layout, node sizes, `near` class |
| `web/src/pages/Diff.jsx` | replace | Changes: collapsible diff cards with classified lines |
| `web/src/pages/Doctor.jsx` | replace | summary card + CheckCards with chevron |
| `web/src/pages/Themes.jsx` | replace | theme-grid cards with orb/glow/sigil |
| `web/src/pages/Settings.jsx` | replace | kv rows, sel pickers, sw-toggle MCP, offline card |
| `web/src/components/Markdown.jsx`, `Toast.jsx`, `router.js`, `api.js`, `main.jsx` | unchanged | — |
| `web/src/__tests__/*.test.jsx` | modify | track DOM changes; new dashboard-directions test |

Commit after every task. Run `npm test` (in `web/`) and `python -m pytest tests/test_web.py` (repo root) where indicated. Final gate: `npm run build` succeeds.

---

### Task 1: Server — add `config` to overview counts

The Dashboard genome grid and Library tabs show a count for all 7 sections; the API returns only 6.

**Files:**
- Modify: `rituals/web.py:656-663` (the `counts` dict in `api_overview`)
- Test: `tests/test_web.py`

- [ ] **Step 1: Write the failing test.** In `tests/test_web.py`, find the existing overview test (search `api_overview` or `/api/overview`) and add an assertion alongside its siblings:

```python
assert "config" in body["counts"]
assert isinstance(body["counts"]["config"], int)
```

(Adapt variable name to the existing test's response variable. If overview counts are asserted as an exact dict, add `"config": <expected>` to it instead.)

- [ ] **Step 2: Run it to verify it fails.** Run from repo root: `python -m pytest tests/test_web.py -k overview -v` — expect FAIL on the new assertion.

- [ ] **Step 3: Implement.** In `rituals/web.py`, `api_overview`, extend the counts dict:

```python
        "counts": {
            "agents": len(inv["agents"]),
            "skills": len(inv["skills"]),
            "laws": len(inv["laws"]),
            "memory": len(_memory_items(state)),
            "notebook": len(_notebook_items(state)),
            "wiki": len(_wiki_items(state)),
            "config": len(_config_items(state)),
        },
```

- [ ] **Step 4: Run the test again** — expect PASS. Also run the whole file: `python -m pytest tests/test_web.py -v`.

- [ ] **Step 5: Commit.**

```bash
git add rituals/web.py tests/test_web.py
git commit -m "feat(web/api): include config count in /api/overview"
```

---

### Task 2: Foundation — styles, accents, icons, index.html

No behaviour yet; the app will look broken until Task 3 lands. That's fine — Tasks 2+3 land back-to-back.

**Files:**
- Replace: `web/src/styles.css`
- Replace: `web/src/accents.js`
- Create: `web/src/components/Icon.jsx`
- Modify: `web/index.html`

- [ ] **Step 1: Replace `web/src/styles.css`.** Copy the ENTIRE contents of `C:\Users\guill\Downloads\geneseed\project\geneseed\cultivar.css` verbatim as the new file body, then append these app-specific extras at the end (rules the prototype didn't need — toast, cancel button, markdown body, missing-status, loading):

```css
/* ============================ APP EXTRAS (not in prototype) ============== */
/* toast */
.toast { position: fixed; right: 18px; bottom: 56px; z-index: 40; max-width: 380px;
  background: var(--surface-2); border: 1px solid var(--line-2); border-radius: var(--r-md);
  box-shadow: var(--shadow-pop); padding: 14px 16px; font-size: 13px; }
.toast.err { border-color: color-mix(in srgb, var(--bad) 45%, var(--line-2)); }

/* cancel a running job from the console */
.run-cancel { margin-left: 8px; }

/* rendered markdown inside .detail-doc (real bodies, not mock prose) */
.detail-doc .markdown h1, .detail-doc .markdown h2, .detail-doc .markdown h3 {
  font-family: var(--font-display); font-weight: 600; letter-spacing: -.01em; }
.detail-doc .markdown h1 { font-size: 20px; margin: 22px 0 8px; }
.detail-doc .markdown h2 { font-size: 16px; margin: 22px 0 8px; }
.detail-doc .markdown h3 { font-size: 14px; margin: 18px 0 6px; }
.detail-doc .markdown p { color: var(--text); margin: 0 0 12px; }
.detail-doc .markdown ul, .detail-doc .markdown ol { margin: 0 0 14px; padding-left: 20px; }
.detail-doc .markdown li { margin: 4px 0; }
.detail-doc .markdown a { color: var(--accent); border-bottom: 1px dashed var(--accent-line); }
.detail-doc .markdown pre { background: var(--bg-2); border: 1px solid var(--line);
  border-radius: var(--r-md); padding: 14px 16px; overflow: auto;
  font-family: var(--font-mono); font-size: 12.5px; color: var(--text-2); }
.detail-doc .markdown pre code { background: none; border: 0; padding: 0; }
.detail-doc .markdown blockquote { margin: 0 0 12px; padding: 2px 14px;
  border-left: 2px solid var(--accent-line); color: var(--text-2); }
.detail-doc .markdown table { border-collapse: collapse; margin: 0 0 14px; }
.detail-doc .markdown th, .detail-doc .markdown td { border: 1px solid var(--line);
  padding: 6px 10px; font-size: 13px; }

/* loading placeholder */
.loading { color: var(--text-3); font-family: var(--font-mono); font-size: 12.5px;
  padding: 40px 0; }
```

- [ ] **Step 2: Replace `web/src/accents.js`** with the Cultivar palette and mode-aware accent application (port of the prototype's `mock.js` palette + `shell.jsx` `applyAccent`):

```js
// ANSI accent name (a theme's ACCENT field) -> Cultivar UI palette. The single
// source for live theming, the theme gallery, and the voice popover.
export const ACCENT_HEX = {
  red: '#FF5C57', green: '#4ED888', yellow: '#E8B53D', blue: '#5B8CFF',
  magenta: '#C77DFF', cyan: '#3AD4C4', white: '#E9EFEA',
}

// Darker companion per accent (gradient ends, light-mode reads this as the base).
export const ACCENT_2 = {
  red: '#C53A36', green: '#2FA864', yellow: '#B8862A', blue: '#3C66D8',
  magenta: '#9A52D6', cyan: '#2BA89B', white: '#AEB8B0',
}

export const accentHex = (name) => ACCENT_HEX[name] || ACCENT_HEX.cyan

// Readable text on a filled accent.
export const accentInk = (name) =>
  (name === 'yellow' || name === 'white' || name === 'cyan' || name === 'green')
    ? '#06100D' : '#FFFFFF'

// Set the live accent on the app root. Light mode reads the deeper companion so
// small text and strokes stay legible on a pale surface; the 'white' accent is
// unusable on light and falls back to slate.
export function applyAccent(el, name, mode) {
  if (!el) return
  const light = mode === 'light'
  let hex = light ? (ACCENT_2[name] || ACCENT_2.cyan) : accentHex(name)
  let ink = light ? '#FFFFFF' : accentInk(name)
  if (light && name === 'white') { hex = '#566B62'; ink = '#FFFFFF' }
  el.style.setProperty('--accent', hex)
  el.style.setProperty('--accent-2', ACCENT_2[name] || ACCENT_2.cyan)
  el.style.setProperty('--accent-ink', ink)
}
```

- [ ] **Step 3: Create `web/src/components/Icon.jsx`.** Copy the `ICONS` map and `Icon`/`Sprout` components from the prototype's `ui.jsx` lines 5-50, converted to ESM:

```jsx
import React from 'react'

// Line-drawn icon paths — no icon library. Keys match NAV ids + action verbs.
export const ICONS = {
  dashboard: 'M3 13h7V3H3v10Zm0 8h7v-6H3v6Zm11 0h7V11h-7v10Zm0-18v6h7V3h-7Z',
  library: 'M4 5h10v14H4zM16 7h4v12h-4M7 9h4M7 12h4',
  graph: 'M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7.5 14.5l8-8M16.7 15.2L8.8 16.6',
  changes: 'M4 6h10M4 12h7M4 18h12M17 4l3 3-3 3M20 7h-6',
  doctor: 'M12 3v6m0 0a4 4 0 0 1-4 4H7a3 3 0 0 0-3 3v2m8-9a4 4 0 0 0 4 4h1a3 3 0 0 1 3 3v2M12 3a1.5 1.5 0 1 0 0-.01',
  themes: 'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15 2H9l-.3 2.6a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6A8 8 0 0 0 4 12c0 .4 0 .9.1 1.3l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3L9 22h6l.3-2.6a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  chevron: 'M9 6l6 6-6 6',
  x: 'M6 6l12 12M18 6L6 18',
  play: 'M7 5v14l11-7L7 5Z',
  clear: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  build: 'M14 3l-1 4 4-1 3 3-4 1 1 4-3 3-1-4-4 1-3-3 4-1-1-4 3-3 5 0Z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  external: 'M14 5h5v5M19 5l-8 8M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  spark: 'M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5-2 2m-7 7-2 2m11 0-2-2m-7-7-2-2',
  layers: 'M12 3l9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  moon: 'M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z',
}

export function Icon({ name, className = 'glyph' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] || ''} />
    </svg>
  )
}

export function Sprout({ className = 'sprout' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21.5v-9" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 13c0-4.5 3.2-7.5 7.5-7.5 0 4.5-3.2 7.5-7.5 7.5z" fill="var(--accent)" />
      <path d="M12 14.5c0-3.6-2.6-6-6-6 0 3.6 2.6 6 6 6z" fill="var(--accent)" opacity=".42" />
      <circle cx="12" cy="12.4" r="1.1" fill="var(--bg)" />
    </svg>
  )
}
```

- [ ] **Step 4: Update `web/index.html`** — set `<title>Geneseed — Harness Console</title>` and replace the favicon `href` with the Cultivar one (copy the exact data-URI from the prototype HTML line 8, accent `%233AD4C4`).

- [ ] **Step 5: Commit.**

```bash
git add web/src/styles.css web/src/accents.js web/src/components/Icon.jsx web/index.html
git commit -m "feat(web/ui): Cultivar design system foundation - styles, palette, icons"
```

---

### Task 3: App shell — rail, topbar, voice popover, console drawer, light mode

**Files:**
- Replace: `web/src/App.jsx`
- Replace: `web/src/components/Console.jsx`
- Replace: `web/src/components/Search.jsx`

Port the prototype `shell.jsx` to the real app. Everything stateful that exists today MUST survive: overview load + accent, jobs hydration, job polling, runAction, cancelJob, toast.

- [ ] **Step 1: Replace `web/src/components/Search.jsx`:**

```jsx
import React, { useEffect, useRef } from 'react'
import { Icon } from './Icon.jsx'

// Topbar search. `/` focuses it from anywhere (except inside another input).
export default function Search({ value, onChange }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.target.closest('input, textarea, select')) return
      e.preventDefault()
      ref.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="tb-search">
      <Icon name="search" className="mag glyph" />
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="Search the harness…" />
      <span className="kbd">/</span>
    </div>
  )
}
```

- [ ] **Step 2: Replace `web/src/components/Console.jsx`** — bottom drawer per prototype `shell.jsx` `Console`, keeping cancel:

```jsx
import React, { useEffect, useRef } from 'react'
import { Icon } from './Icon.jsx'

// Bottom console drawer. Every action triggered from the UI streams here live;
// history is hydrated from the server so it survives reload and restart.
export default function Console({ runs, open, onToggle, onClear, onCancel, busy }) {
  const bodyRef = useRef(null)
  const lastLen = runs.length ? runs[runs.length - 1].output.length : 0
  useEffect(() => {
    const el = bodyRef.current
    if (el && open) el.scrollTop = el.scrollHeight
  }, [runs.length, lastLen, open])

  return (
    <div className="console" style={{ height: open ? '42vh' : 42 }}>
      <div className="console-head" onClick={onToggle}>
        <span className="ttl">
          <span className={`live ${busy ? 'on' : ''}`} />
          terminal
        </span>
        <span className="count">{runs.length}</span>
        <div className="right" onClick={(e) => e.stopPropagation()}>
          <button className="iconbtn" title="Clear" onClick={onClear} disabled={!runs.length}>
            <Icon name="clear" />
          </button>
          <button className="iconbtn" title={open ? 'Collapse' : 'Expand'} onClick={onToggle}>
            <Icon name="chevron" className="glyph"
              style={{ transform: open ? 'rotate(90deg)' : 'rotate(-90deg)' }} />
          </button>
        </div>
      </div>
      {open && (
        <div className="console-body" ref={bodyRef}>
          {runs.length === 0 &&
            <div className="console-empty">No commands run yet. Actions you trigger stream here.</div>}
          {runs.map((r) => (
            <div className="run" key={r.id}>
              <div className="run-head">
                <span className="pr">$</span>
                <span className="act">{r.action}</span>
                <span className={`st ${r.status}`}>
                  {r.status === 'running' ? '…running'
                    : `${r.status === 'done' ? '✓ done' : '✗ failed'}${r.duration ? ` · ${r.duration}s` : ''}`}
                </span>
                {r.status === 'running' && onCancel && (
                  <button className="iconbtn run-cancel" title="Cancel this run"
                    onClick={() => onCancel(r.id)}>
                    <Icon name="x" />
                  </button>
                )}
              </div>
              {r.output && <pre className="run-out">{r.output}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Note: `Icon` doesn't forward `style` today — extend it: `export function Icon({ name, className = 'glyph', style })` and pass `style={style}` to the `<svg>`. Make that edit in `Icon.jsx` as part of this step.

- [ ] **Step 3: Replace `web/src/App.jsx`:**

```jsx
import React, { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { useRoute, go } from './router.js'
import Search from './components/Search.jsx'
import { Icon, Sprout } from './components/Icon.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Section from './pages/Section.jsx'
import Diff from './pages/Diff.jsx'
import Doctor from './pages/Doctor.jsx'
import Themes from './pages/Themes.jsx'
import Graph from './pages/Graph.jsx'
import Settings from './pages/Settings.jsx'
import Toast from './components/Toast.jsx'
import Console from './components/Console.jsx'
import { applyAccent, accentHex } from './accents.js'

// Rail navigation, grouped like the design. `match` decides which item lights
// up; `tag` surfaces a live count from the overview.
const NAV = [
  { group: 'Harness' },
  { hash: '#/', id: 'dashboard', label: 'Dashboard', icon: 'dashboard',
    match: (r) => r.view === 'dashboard' },
  { hash: '#/section/agents', id: 'library', label: 'Library', icon: 'library',
    match: (r) => r.view === 'section' || r.view === 'item' },
  { hash: '#/graph', id: 'graph', label: 'Graph', icon: 'graph', match: (r) => r.view === 'graph' },
  { group: 'Maintain' },
  { hash: '#/diff', id: 'changes', label: 'Changes', icon: 'changes', match: (r) => r.view === 'diff',
    tag: (o) => (o?.diff ? o.diff.edited + o.diff.added : null) || null },
  { hash: '#/doctor', id: 'doctor', label: 'Doctor', icon: 'doctor', match: (r) => r.view === 'doctor',
    tag: (o) => (o?.doctor && !o.doctor.ok ? o.doctor.problems.length : null), warn: true },
  { group: 'Configure' },
  { hash: '#/themes', id: 'themes', label: 'Themes', icon: 'themes', match: (r) => r.view === 'themes' },
  { hash: '#/settings', id: 'settings', label: 'Settings', icon: 'settings',
    match: (r) => r.view === 'settings' },
]

// Route view -> the --tab flag the fake prompt displays.
const TAB_FLAG = { dashboard: 'overview', section: 'library', item: 'library',
  diff: 'diff', doctor: 'doctor', themes: 'themes', graph: 'graph', settings: 'settings' }

const MODE_KEY = 'geneseed-mode'

function Rail({ route, overview, themes, onOpenVoice }) {
  return (
    <aside className="rail">
      <div className="rail-brand" onClick={() => go('#/')} title="Dashboard">
        <Sprout />
        <div className="brand-text">
          <span className="brand-name">Gene<b>seed</b></span>
          <span className="brand-sub">harness console</span>
        </div>
      </div>
      {NAV.map((n, i) => {
        if (n.group) return <div className="rail-group" key={'g' + i}>{n.group}</div>
        const tag = n.tag ? n.tag(overview) : null
        return (
          <div className="rail-nav" key={n.id}>
            <a className={`rail-item ${n.match(route) ? 'active' : ''}`} href={n.hash}
              style={{ color: undefined }}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {tag ? <span className="tag" style={n.warn ? { color: 'var(--warn)' } : null}>{tag}</span> : null}
            </a>
          </div>
        )
      })}
      <div className="rail-spacer" />
      <div className="rail-foot">
        <div className="voice" onClick={onOpenVoice} title="Switch deployed voice">
          <span className="voice-orb" />
          <div className="voice-meta">
            <div className="vk">deployed voice</div>
            <div className="vv">{overview?.theme || '—'}</div>
          </div>
          <Icon name="chevron" className="chev glyph" />
        </div>
      </div>
    </aside>
  )
}

function VoicePopover({ themes, current, onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="pop" ref={ref}>
      <div className="tick" style={{ padding: '4px 10px 8px' }}>Switch voice</div>
      {themes.map((t) => (
        <div key={t.name} className={`pop-item ${t.name === current ? 'on' : ''}`}
          onClick={() => onPick(t.name)}>
          <span className="po" style={{ background: accentHex(t.accent),
            boxShadow: `0 0 8px ${accentHex(t.accent)}` }} />
          <span className="pn">{t.name}</span>
        </div>
      ))}
    </div>
  )
}

// Shorten the deploy target for the fake prompt: home dir -> "~".
function promptPath(target) {
  if (!target) return '~'
  return target.replace(/\\/g, '/').replace(/^\/?(home|Users)\/[^/]+/i, '~').replace(/^[A-Z]:\/Users\/[^/]+/i, '~')
}

function Topbar({ route, target, query, onQuery, mode, onToggleMode }) {
  return (
    <div className="topbar">
      <div className="prompt">
        <span className="path">{promptPath(target)}</span>
        <span className="sep">$</span>
        <span className="cmd">geneseed</span>{' '}
        <span className="flag">--tab={TAB_FLAG[route.view] || route.view}</span>
        <span className="cur" />
      </div>
      <div className="topbar-spacer" />
      <Search value={query} onChange={onQuery} />
      <button className="iconbtn" title={mode === 'light' ? 'Switch to dark' : 'Switch to light'}
        onClick={onToggleMode}>
        <Icon name={mode === 'light' ? 'moon' : 'sun'} />
      </button>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const [overview, setOverview] = useState(null)
  const [themes, setThemes] = useState([])           // for the voice popover
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [runs, setRuns] = useState([])               // [{id, action, status, output}]
  const [activeId, setActiveId] = useState(null)     // job id being polled
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || 'dark' } catch { return 'dark' }
  })
  const appRef = useRef(null)

  const loadOverview = () =>
    api.overview().then(setOverview).catch((e) => setToast({ kind: 'err', msg: e.message }))

  useEffect(() => { loadOverview() }, [])
  useEffect(() => { api.themes().then((t) => setThemes(t.themes)).catch(() => {}) }, [])

  // Hydrate the console from the server's run history (survives reload and
  // restart); resume polling if a job is still running from a previous tab.
  useEffect(() => {
    api.jobs().then(({ jobs }) => {
      if (!jobs.length) return
      setRuns(jobs.map((j) => ({
        id: j.id, action: j.action, status: j.status,
        output: j.output || '', duration: j.duration,
      })))
      const running = jobs.find((j) => j.status === 'running')
      if (running) { setActiveId(running.id); setConsoleOpen(true) }
    }).catch(() => {})
  }, [])

  // The UI wears the deployed theme's accent, adjusted for light/dark mode.
  useEffect(() => {
    if (overview?.accent) applyAccent(appRef.current, overview.accent, mode)
  }, [overview, mode])
  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode) } catch {}
  }, [mode])

  // Poll the running job, streaming output into its console run, then refresh.
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(async () => {
      try {
        const j = await api.job(activeId)
        setRuns((rs) => rs.map((r) =>
          r.id === activeId
            ? { ...r, output: j.output || '', status: j.status, duration: j.duration }
            : r))
        if (j.status !== 'running') {
          clearInterval(t)
          setActiveId(null)
          loadOverview()
        }
      } catch (e) { clearInterval(t) }
    }, 600)
    return () => clearInterval(t)
  }, [activeId])

  const runAction = async (name, opts) => {
    try {
      const { job_id } = await api.action(name, opts)
      const label = name === 'build' && opts?.theme
        ? `build (${opts.theme} · ${opts.emit})` : name
      setRuns((rs) => [...rs, { id: job_id, action: label, status: 'running', output: '' }])
      setActiveId(job_id)
      setConsoleOpen(true)
    } catch (e) { setToast({ kind: 'err', msg: e.message }) }
  }

  const cancelJob = (id) =>
    api.cancelJob(id).catch((e) => setToast({ kind: 'err', msg: e.message }))

  return (
    <div className={`app ${mode === 'light' ? 'light' : ''}`} ref={appRef}>
      <div className="atmos" />
      <Rail route={route} overview={overview} themes={themes}
        onOpenVoice={() => setVoiceOpen((v) => !v)} />
      {voiceOpen && (
        <VoicePopover themes={themes} current={overview?.theme}
          onPick={(name) => {
            setVoiceOpen(false)
            runAction('build', { theme: name, emit: overview?.emit })
          }}
          onClose={() => setVoiceOpen(false)} />
      )}
      <div className="col">
        <Topbar route={route} target={overview?.target} query={query} onQuery={setQuery}
          mode={mode} onToggleMode={() => setMode((m) => (m === 'light' ? 'dark' : 'light'))} />
        <div className="page">
          <div className="pad">
            {route.view === 'dashboard' &&
              <Dashboard overview={overview} themes={themes} onAction={runAction} />}
            {route.view === 'section' && <Section section={route.section} query={query} counts={overview?.counts} />}
            {route.view === 'item' &&
              <Section
                section={{ agent: 'agents', skill: 'skills', law: 'laws' }[route.type] || route.type}
                selected={route.name}
                query={query}
                counts={overview?.counts}
              />}
            {route.view === 'diff' && <Diff />}
            {route.view === 'doctor' && <Doctor />}
            {route.view === 'themes' && <Themes onAction={runAction} />}
            {route.view === 'graph' && <Graph />}
            {route.view === 'settings' && <Settings onAction={runAction} />}
          </div>
        </div>
        <Console runs={runs} open={consoleOpen} busy={!!activeId}
          onToggle={() => setConsoleOpen((v) => !v)} onClear={() => setRuns([])}
          onCancel={cancelJob} />
      </div>
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
```

Notes:
- Rail items are `<a href>` (real hash links, middle-click works) styled by `.rail-item`; add `a.rail-item { color: var(--text-2); }` and `a.rail-item:hover { color: var(--text); }` to the APP EXTRAS block of `styles.css` if anchor color bleeds accent.
- `.page` needs bottom padding ≥ console height — cultivar.css already pads 120px.
- The old `.layout`/`.header` CSS is gone; nothing references it after this task.

- [ ] **Step 4: Smoke-run the suite.** `cd web && npm test` — Dashboard/Settings/etc tests still pass (pages untouched so far); fix only import breakage if any. The dashboard test may reference removed shell DOM — if it fails on shell markup, defer to Task 4 (it rewrites that test) but note it.

- [ ] **Step 5: Commit.**

```bash
git add web/src/App.jsx web/src/components/Console.jsx web/src/components/Search.jsx web/src/components/Icon.jsx web/src/styles.css
git commit -m "feat(web/ui): Cultivar app shell - rail, terminal topbar, console drawer, light mode"
```

---

### Task 4: Dashboard — three directions

**Files:**
- Replace: `web/src/pages/Dashboard.jsx`
- Test: `web/src/__tests__/dashboard.test.jsx`

Data: `overview` + `themes` come as props from App (Task 3). The page additionally fetches `/api/setup` (fingerprint for chips/lineage) and `/api/jobs` (activity feed).

**Readiness formula (deterministic, documented in code):**
`readiness = (deployed ? 0.40 : 0) + doctorScore + (installed_fp === source_fp ? 0.20 : 0) + (diff.missing === 0 ? 0.15 : 0)` where `doctorScore = doctor.ok ? 0.25 : (problems.length <= 2 ? 0.15 : 0.05)`. Not deployed ⇒ ring shows the raw sum (likely < 0.5).

**HEADLINES map (client-side UI copy, from mock.js):** neutral `Loaded & ready`, imperial `The Codex in force`, military `The unit stands ready`, cyberpunk `Jacked in`, wizard `Wards in place`, pirate `The crew stands ready`, gamer `Game loaded`, sports `The squad takes the field`, biker `The crew rolls out`, commentator `Lights out, away we go`, verstappen `Setup's in`, joker `Mic check`, mean `Rules are up`, marvin `Online. Reluctantly.` — fallback `'Loaded & ready'`, and `'Not deployed'` when `!overview.deployed`.

- [ ] **Step 1: Rewrite the test** `web/src/__tests__/dashboard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api.js', () => ({
  api: {
    setup: () => Promise.resolve({
      installed_fp: 'a3f1c9e2', source_fp: 'a3f1c9e2',
      version_verdict: 'up to date (0.1.0)',
    }),
    jobs: () => Promise.resolve({
      jobs: [{ id: 'j1', action: 'doctor', status: 'done', output: '', duration: 4,
        started: Date.now() / 1000 - 120 }],
    }),
  },
}))

import Dashboard from '../pages/Dashboard.jsx'

const overview = {
  deployed: true, theme: 'imperial', accent: 'yellow', emit: 'opencode-global',
  target: '/home/u/.config/opencode', build_time: '2026-06-12 09:41',
  doctor: { ok: false, problems: ['1 dead cross-link'], checked_at: '2026-06-12' },
  diff: { edited: 3, added: 1, missing: 0 },
  counts: { agents: 16, skills: 25, laws: 20, memory: 41, notebook: 6, wiki: 128, config: 4 },
}
const themes = [{ name: 'imperial', accent: 'yellow', tagline: '', sigil: 'The Codex in force.', blurb: '' }]

describe('Dashboard', () => {
  it('renders the status direction with ring, KPIs, and genome counts', async () => {
    render(<Dashboard overview={overview} themes={themes} onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText('germination')).toBeTruthy())
    expect(screen.getByText('The Codex in force')).toBeTruthy()   // headline
    expect(screen.getByText('16')).toBeTruthy()                   // agents KPI
    expect(screen.getByText('128')).toBeTruthy()                  // wiki genome cell
    // readiness: .40 + .15 (1 problem) + .20 (fp match) + .15 (no missing) = 90%
    expect(screen.getByText('90')).toBeTruthy()
  })

  it('switches directions via the segmented control', async () => {
    render(<Dashboard overview={overview} themes={themes} onAction={() => {}} />)
    fireEvent.click(screen.getByText('Lineage'))
    await waitFor(() => expect(screen.getByText('Gene-seed lineage')).toBeTruthy())
    fireEvent.click(screen.getByText('Operator'))
    await waitFor(() => expect(screen.getByText(/entries total/)).toBeTruthy())
  })

  it('shows a loading state without overview', () => {
    render(<Dashboard overview={null} themes={[]} onAction={() => {}} />)
    expect(screen.getByText(/Loading/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it** — `cd web && npx vitest run src/__tests__/dashboard.test.jsx` — expect FAIL (old component).

- [ ] **Step 3: Implement `web/src/pages/Dashboard.jsx`.** Port the prototype `dashboard.jsx` with these exact substitutions — keep the prototype's DOM/classes everywhere else:

```jsx
import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { Icon } from '../components/Icon.jsx'

const SECTION_META = {
  agents:   { label: 'Agents',   desc: 'capability specialists', icon: 'layers' },
  skills:   { label: 'Skills',   desc: 'repeatable workflows',   icon: 'build' },
  laws:     { label: 'Laws',     desc: 'governance rules',       icon: 'doctor' },
  memory:   { label: 'Memory',   desc: 'durable facts',          icon: 'library' },
  notebook: { label: 'Notebook', desc: 'sovereign space',        icon: 'changes' },
  wiki:     { label: 'Wiki',     desc: 'machine knowledge base', icon: 'graph' },
  config:   { label: 'Config',   desc: 'install metadata',       icon: 'settings' },
}
const SECTION_ORDER = ['agents', 'skills', 'laws', 'memory', 'notebook', 'wiki', 'config']

// Voice-flavoured hero headline per theme — UI copy, not server data.
const HEADLINES = {
  neutral: 'Loaded & ready', imperial: 'The Codex in force', military: 'The unit stands ready',
  cyberpunk: 'Jacked in', wizard: 'Wards in place', pirate: 'The crew stands ready',
  gamer: 'Game loaded', sports: 'The squad takes the field', biker: 'The crew rolls out',
  commentator: 'Lights out, away we go', verstappen: "Setup's in", joker: 'Mic check',
  mean: 'Rules are up', marvin: 'Online. Reluctantly.',
}

// Health of the deployment as one number: deployed 40%, doctor up to 25%,
// version in sync 20%, nothing missing on disk 15%.
function readiness(ov, setup) {
  if (!ov) return 0
  const doctorScore = ov.doctor?.ok ? 0.25
    : (ov.doctor?.problems?.length ?? 99) <= 2 ? 0.15 : 0.05
  return (ov.deployed ? 0.40 : 0)
    + doctorScore
    + (setup && setup.installed_fp && setup.installed_fp === setup.source_fp ? 0.20 : 0)
    + (ov.diff && ov.diff.missing === 0 ? 0.15 : 0)
}

function Ring({ value, size = 232 }) { /* …verbatim from prototype dashboard.jsx lines 17-44… */ }

function relTime(epochSecs) {
  const s = Math.max(0, Date.now() / 1000 - epochSecs)
  if (s < 90) return `${Math.round(s)}s`
  if (s < 5400) return `${Math.round(s / 60)}m`
  if (s < 129600) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}
```

then the rest of the component, with these mappings:
  - `Ring` — copy verbatim from the prototype (ticks loop included).
  - `KpiStrip` — 4 cards: Agents/Skills/Laws from `overview.counts`, "Local edits" = `diff.edited + diff.added` with `delta` `+N` shown only when > 0 and `onClick={() => go('#/diff')}`. **No `Spark`** (deviation 1).
  - `Genome` — `SECTION_ORDER` cells, count from `overview.counts[key] ?? '—'`, `onClick={() => go('#/section/' + key)}`.
  - `ActivityFeed({ jobs })` — render up to 8 most-recent jobs (newest first): dot kind `done→ok`, `running→acc`, `failed→bad`; text `<b>{action}</b>`; when `relTime(j.started) + ' ago'`. Empty state: `<div className="empty"><div className="big">No activity yet</div>Actions you run appear here.</div>`.
  - `DirStatus` — hero card: `Ring value={readiness(overview, setup)}`, eyebrow `harness · {deployed ? 'deployed' : 'not deployed'}`, headline `overview.deployed ? (HEADLINES[overview.theme] || 'Loaded & ready') : 'Not deployed'`, voice-readout shows current theme's `sigil` from the `themes` prop (`themes.find((t) => t.name === overview.theme)?.sigil`, render the readout only if non-empty), sub text `One source rendered into <code>{overview.target}</code>…` as prototype, chips: voice/mode/built (`build_time || 'unknown'`)/fp (`setup?.installed_fp || '—'`), buttons Update → `onAction('update')`, Rebuild → `onAction('build', { theme: overview.theme, emit: overview.emit })`, Run doctor → `onAction('doctor')`. Below: `KpiStrip`, then genome + activity grid exactly as the prototype.
  - `DirLineage` — lineage card steps: `['Source', 'src/ — the canonical genetic material', setup?.source_fp || '—', true]`, `['Render', 'build.py → ' + overview.emit, overview.theme + ' voice', true]`, `['Deployed', overview.target, 'inherited by every repo', false]`. Badges: `in sync · {setup?.version_verdict}` as `badge ok` when verdict includes `'up to date'` else `badge warn`; second badge `{diff.edited + diff.added} local edits`. `MiniGraph` — fetch `api.graph()` once in the page (state `graph`), render the prototype's MiniGraph with real nodes/edges but **cap at the first 24 nodes** and only edges between them (the real graph can be 40+ nodes; the mini panel is a teaser). "Open graph" button → `go('#/graph')`. Genome strand rows (`StrandRow`) verbatim with `go('#/section/' + k)`.
  - `DirOperator` — compact status bar (badges from real fields: deployed, voice, mode, fingerprint `setup?.installed_fp || '—'`, doctor issues count or `clean` badge ok, edits) + sections table + run log (`ActivityFeed`).
  - Top-level `Dashboard({ overview, themes, onAction })` — `const [dir, setDir] = useState('status')`, head-row with eyebrow/h1/sub + seg control verbatim; fetch `setup`, `jobs`, `graph` in `useEffect` once (each `.catch(() => {})`); `if (!overview) return <div className="loading">Loading…</div>`.

- [ ] **Step 4: Run tests** — `npx vitest run src/__tests__/dashboard.test.jsx` — expect PASS. Then full suite `npm test`.

- [ ] **Step 5: Commit.**

```bash
git add web/src/pages/Dashboard.jsx web/src/__tests__/dashboard.test.jsx
git commit -m "feat(web/ui): Cultivar dashboard - status, lineage, operator directions"
```

---

### Task 5: Library (Section.jsx)

**Files:**
- Replace: `web/src/pages/Section.jsx`

Keep routing (`go('#/item/…')`), real catalog/item fetching, and `Markdown` rendering. Adopt the prototype's `.lib` two-pane layout with `.lib-tabs` (7 sections + counts) and `.detail-doc` wrapper.

- [ ] **Step 1: Implement:**

```jsx
import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import Markdown from '../components/Markdown.jsx'

const TYPE = { agents: 'agent', skills: 'skill', laws: 'law',
  memory: 'memory', notebook: 'notebook', wiki: 'wiki', config: 'config' }
const SEC_KEYS = ['agents', 'skills', 'laws', 'memory', 'notebook', 'wiki', 'config']
const SEC_LABEL = { agents: 'Agents', skills: 'Skills', laws: 'Laws', memory: 'Memory',
  notebook: 'Notebook', wiki: 'Wiki', config: 'Config' }

function DocView({ section, item }) {
  const type = TYPE[section]
  return (
    <div className="detail-doc">
      <span className="eyebrow">{type}</span>
      <h1 style={{ marginTop: 10 }}>{item.title}</h1>
      <div className="doc-meta">
        <span className="badge acc"><span className="dot" />{type}</span>
        {item.links?.length
          ? <span className="badge"><span className="dot" />{item.links.length} cross-link{item.links.length === 1 ? '' : 's'}</span>
          : null}
      </div>
      {item.desc ? <p style={{ fontSize: 15 }}>{item.desc}</p> : null}
      <Markdown body={item.body} links={item.links} />
    </div>
  )
}

export default function Section({ section, selected, query, counts }) {
  const [items, setItems] = useState([])
  const [item, setItem] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setErr('')
    api.catalog(section).then((c) => setItems(c.items)).catch((e) => setErr(e.message))
  }, [section])

  useEffect(() => {
    if (!selected) { setItem(null); return }
    api.item(TYPE[section], selected).then(setItem).catch((e) => setErr(e.message))
  }, [section, selected])

  const q = (query || '').toLowerCase()
  const shown = items.filter((it) =>
    !q || it.title.toLowerCase().includes(q) || (it.desc || '').toLowerCase().includes(q))

  return (
    <>
      <div className="head-row" style={{ marginBottom: 18 }}>
        <div>
          <span className="eyebrow">browse</span>
          <h1 className="h">Library</h1>
          <p className="sub">Every rule, agent, skill, and note in the deployed harness —
            rendered markdown with clickable cross-links.</p>
        </div>
      </div>
      <div className="lib">
        <div className="card lib-list">
          <div className="lib-tabs">
            {SEC_KEYS.map((k) => (
              <span key={k} className={`lib-tab ${section === k ? 'on' : ''}`}
                onClick={() => go(`#/section/${k}`)}>
                {SEC_LABEL[k]}{counts?.[k] != null
                  ? <span style={{ opacity: .6 }}> {counts[k]}</span> : null}
              </span>
            ))}
          </div>
          <div className="lib-rows">
            {shown.map((it) => (
              <div key={it.name} className={`lib-row ${selected === it.name ? 'on' : ''}`}
                onClick={() => go(`#/item/${TYPE[section]}/${encodeURIComponent(it.name)}`)}>
                <div className="lr-name">{it.title}</div>
                {it.desc ? <div className="lr-desc">{it.desc}</div> : null}
              </div>
            ))}
            {shown.length === 0 &&
              <div className="empty"><div className="big">No matches</div>Try another search.</div>}
          </div>
        </div>
        <div className="card">
          {err ? <p className="badge bad" style={{ margin: 18 }}>{err}</p> : null}
          {item ? <DocView section={section} item={item} />
            : <div className="empty"><div className="big">Select an item</div>Pick something from the list to read it.</div>}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Run the suite** — `npm test`. No Section test exists; ensure nothing else broke.

- [ ] **Step 3: Commit.**

```bash
git add web/src/pages/Section.jsx
git commit -m "feat(web/ui): Cultivar library - section tabs, doc detail pane"
```

---

### Task 6: Graph

**Files:**
- Modify: `web/src/pages/Graph.jsx`
- Test: `web/src/__tests__/graph.test.jsx` (adjust selectors only if they broke)

The existing page already uses `gedge`/`gnode`/`lit`/`dim` classes that cultivar.css styles. Changes are cosmetic:

- [ ] **Step 1:** Replace the `<h2>`/legend block (lines 85-95) with the prototype's head-row + legend (from `tabs.jsx` GraphView lines 149-157), keeping real `data.nodes.length`/`data.edges.length`. Use `.card.graph-wrap` instead of `.panel.graph-wrap`. Node circles: `r={node.type === 'agent' ? 8 : 6}`, text `dx="12" dy="4"`. Add the `near` class: `className={\`gnode ${node.type} ${dimmed(node.id) ? 'dim' : ''} ${hover && neighbors.has(node.id) ? 'near' : ''}\`}`. Keep layout(), hover logic, click-through, and orphan dimming untouched.

- [ ] **Step 2:** `npx vitest run src/__tests__/graph.test.jsx` — fix any selector the markup change broke (e.g. legend text). Expect PASS.

- [ ] **Step 3: Commit.**

```bash
git add web/src/pages/Graph.jsx web/src/__tests__/graph.test.jsx
git commit -m "feat(web/ui): Cultivar graph - legend header, node emphasis"
```

---

### Task 7: Changes (Diff.jsx)

**Files:**
- Replace: `web/src/pages/Diff.jsx`

Keep: load/select/restore-with-confirm/export-with-poll/note. Adopt: head-row with actions, status badges, per-file `.diff-file` cards with checkbox + collapsible classified diff body.

- [ ] **Step 1: Implement.** Key adapter — classify real unified-diff lines:

```jsx
// Map a unified-diff line to its display class. Headers (+++/---) and hunk
// markers read as hunks; the synthetic added/missing banners read as context.
function lineKind(ln) {
  if (ln.startsWith('@@') || ln.startsWith('+++') || ln.startsWith('---')) return 'hunk'
  if (ln.startsWith('+')) return 'add'
  if (ln.startsWith('-')) return 'del'
  return 'ctx'
}
```

Full component: port the prototype `Changes` (tabs.jsx lines 186-243) with:
  - state/handlers copied from the CURRENT Diff.jsx (`load`, `toggle`, `toggleAll`, `exportImprovements`, `restore` — verbatim, including the delete warning and `window.confirm`),
  - `note` rendered as `<p className="sub" style={{ marginBottom: 14 }}>{note}</p>`,
  - guards: `err` → `<p className="badge bad">{err}</p>`; `!data` → `<div className="loading">Loading…</div>`; `!data.deployed` → `<div className="empty"><div className="big">No deployed harness</div>Nothing to diff against.</div>`,
  - head-row: eyebrow `drift from source`, h1 `Local edits`, sub from prototype; buttons: `Restore{sel.size ? \` (${sel.size})\` : ''}` ghost (disabled `busy || sel.size === 0`, onClick `restore`) and `Export improvements` (`<Icon name="download" />`, disabled `busy`, onClick `exportImprovements`),
  - badge row: edited/added/missing counts (`missing` only when > 0, dot `var(--bad)`), select-all checkbox per prototype,
  - per-file card: checkbox (`stopPropagation` on click), `.fname`, status badge (`added→ok`, `edited→warn`, `missing→bad`), line count, chevron button toggling `open` set (default: all files open, as prototype), body `{f.diff.map((ln, i) => <div key={i} className={\`diff-line ${lineKind(ln)}\`}>{ln}</div>)}`,
  - `files.length === 0` → `<div className="empty"><div className="big">In sync</div>Deployed harness matches source.</div>`.

- [ ] **Step 2:** `npm test` — green (no Diff test exists; checking for collateral).

- [ ] **Step 3: Commit.**

```bash
git add web/src/pages/Diff.jsx
git commit -m "feat(web/ui): Cultivar changes - classified collapsible diff cards"
```

---

### Task 8: Doctor

**Files:**
- Replace: `web/src/pages/Doctor.jsx`
- Test: `web/src/__tests__/doctor.test.jsx`

- [ ] **Step 1: Update the test expectations first** (read the current test; adjust selectors to the new DOM): summary line becomes `validated N themes` lowercase mono text + theme badges; clean check shows badge `clean`; problem check shows `1 problem` and the problem text after clicking the head. Run to see it fail.

- [ ] **Step 2: Implement** — port prototype `CheckCard` + `Doctor` (tabs.jsx lines 246-290) keeping the existing `load()` lifecycle (`setData(null)` → fetch → render) and `Re-run checks` button (`<Icon name="refresh" />`, disabled while `!data`). While running show `<div className="loading">Running every check (builds each theme in a sandbox)…</div>`. Wrap in `<div style={{ maxWidth: 820 }}>` with head-row eyebrow `health` / h1 `Doctor` / sub per prototype. Problems render in `.check-body` as `.problem` rows with `✕`.

- [ ] **Step 3:** `npx vitest run src/__tests__/doctor.test.jsx` — PASS.

- [ ] **Step 4: Commit.**

```bash
git add web/src/pages/Doctor.jsx web/src/__tests__/doctor.test.jsx
git commit -m "feat(web/ui): Cultivar doctor - check cards with summary strip"
```

---

### Task 9: Themes

**Files:**
- Replace: `web/src/pages/Themes.jsx`
- Test: `web/src/__tests__/themes.test.jsx`

- [ ] **Step 1: Adjust the test:** button label changes `Apply` → `Apply voice`, current button stays `Applied`. Update those two assertions; run → FAIL.

- [ ] **Step 2: Implement** — port prototype `Themes` (tabs.jsx lines 293-325): `.theme-grid`, card `style={{ '--tc': accentHex(t.accent) }}` with `.tc-glow`, orb, name, `current` badge, tagline in quotes (only if non-empty), `.th-sigil` (only if non-empty), blurb as `<p className="muted" style={{ fontSize: 12.5 }}>{t.blurb}</p>` after the sigil, apply button `btn ${isCur ? 'ghost' : 'soft'}` disabled when current, label `Applied`/`Apply voice`. KEEP the existing `window.confirm` in `apply()` and `onAction('build', { theme: name, emit: data.current.emit })`. Head-row: eyebrow `voice`, h1 `Themes`, sub per prototype. Guards: err badge bad / `loading`.

- [ ] **Step 3:** `npx vitest run src/__tests__/themes.test.jsx` — PASS.

- [ ] **Step 4: Commit.**

```bash
git add web/src/pages/Themes.jsx web/src/__tests__/themes.test.jsx
git commit -m "feat(web/ui): Cultivar themes - accent-glow voice cards"
```

---

### Task 10: Settings

**Files:**
- Replace: `web/src/pages/Settings.jsx`
- Test: `web/src/__tests__/settings.test.jsx`

- [ ] **Step 1: Read the current test, adjust selectors** to the new DOM (kv rows keep the same text content; MCP toggles become `role="switch"` — assert via `getAllByRole('switch')`; absent-preset Add stays a button). Run → FAIL.

- [ ] **Step 2: Implement** — port prototype `Settings` + `McpServers` (tabs.jsx lines 328-425) preserving ALL current behaviour:
  - Installation card: kv rows exactly as the current page (Deployed badge, Target in `<code>`, Install mode, Theme with capitalize, Version verdict badge ok/warn, Installed/Source build mono, Source root, Memory store + facts, Python). Use `.kv`/`.k`/`.v` classes from cultivar.css.
  - Build & update card: `.sel` selects fed by `choices.themes`/`choices.emits`, Build ghost + Update buttons with icons, `onAction` wiring unchanged.
  - MCP card: prototype layout (`.mcp-target`, `.mt-head` with `{t.label} — <code>{t.path}</code>` plus `(has comments — edit by hand)` when `t.commented`); per server: name + state badge + desc; control: when `state !== 'absent'` render `.sw-toggle` div (`on` when enabled, `role="switch"`, `aria-checked`, `aria-disabled` + no-op when `t.commented || busy`), when absent and `s.preset` render `<button className="btn ghost sm">Add</button>` — both call the existing `toggle(t, s)` (`api.mcpToggle(t.path, s.name, s.state !== 'enabled')` then reload). Keep `busyKey` and `note`.
  - Offline package card: prototype copy + `<a className="btn ghost" href="/api/offline-zip" download><Icon name="download" />Download offline package</a>`.
  - Wrap in `<div style={{ maxWidth: 860 }}>` with head-row eyebrow `configure` / h1 `Settings` / sub per prototype.

- [ ] **Step 3:** `npx vitest run src/__tests__/settings.test.jsx` — PASS.

- [ ] **Step 4: Commit.**

```bash
git add web/src/pages/Settings.jsx web/src/__tests__/settings.test.jsx
git commit -m "feat(web/ui): Cultivar settings - kv install card, switch toggles, offline card"
```

---

### Task 11: Final verification

- [ ] **Step 1:** Full JS suite: `cd web && npm test` — all green.
- [ ] **Step 2:** Production build: `npm run build` — succeeds, no warnings about missing assets.
- [ ] **Step 3:** Python suite: repo root `python -m pytest tests/test_web.py -v` — green.
- [ ] **Step 4:** Live smoke (use the `verify` skill or `geneseed web`): start the server, open the console, click through all 7 pages + the 3 dashboard directions, toggle light mode (persists across reload), switch voice from the rail popover (build streams in the drawer, accent updates after), cancel button visible on a running job.
- [ ] **Step 5:** Commit any test/build fixes, then push per repo law (Lex II).

---

## Self-review notes

- Spec coverage: rail+thread ✔ (CSS `.rail-thread` exists but the prototype's Rail never renders it — we match the prototype's JSX, not the dead CSS), topbar ✔, console drawer ✔, voice popover ✔, light mode ✔, all 7 pages ✔, 3 dashboard directions ✔ (confirmed), `rise` animations ride on classnames from CSS ✔.
- Mock-only content (fabricated agents/skills/laws lists, fake doc bodies, ACTION_LOG, fake fingerprints) deliberately never copied — real API everywhere.
- `prompt .cur` blink, `.atmos` grain, focus rings, reduced-motion — all pure CSS, land with Task 2.
- Types consistent: `applyAccent(el, name, mode)` defined in Task 2, used in Task 3; `counts` prop introduced in Task 3 App, consumed in Task 5 Section; `themes` prop from App → Dashboard (Task 4) for sigils.
