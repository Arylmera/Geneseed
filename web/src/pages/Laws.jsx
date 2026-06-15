import React, { useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Six-class taxonomy distilled from the rules in src/laws/universal.md.
// Holds the chip label, the dot colour, and the one-line essence rendered
// in the table's "Principle" column.
const LAW_CATS = {
  security: { label: 'Security', c: 'oklch(0.74 0.085 45)' },
  verify: { label: 'Verification', c: 'oklch(0.78 0.075 200)' },
  process: { label: 'Process', c: 'oklch(0.76 0.075 150)' },
  craft: { label: 'Craft', c: 'oklch(0.78 0.085 95)' },
  context: { label: 'Context', c: 'oklch(0.74 0.08 280)' },
  comms: { label: 'Communication', c: 'oklch(0.76 0.085 345)' },
}
const LAW_CAT_ORDER = ['security', 'verify', 'process', 'craft', 'context', 'comms']

const LAW_META = {
  1: ['security', 'Secrets never touch tracked files — only .env or a manager.'],
  2: ['process', 'One purpose per change; no silent scope creep.'],
  3: ['verify', 'Check the real state before claiming anything is true.'],
  4: ['security', 'Destructive and outward acts need explicit confirmation.'],
  5: ['craft', 'If it repeats, make it a script or skill — reuse first.'],
  6: ['context', 'Durable decisions get written to memory before the session ends.'],
  7: ['verify', 'Stop and report a broken step; never paper over it.'],
  8: ['comms', 'Answer what is asked — no filler, no performative agreement.'],
  9: ['comms', 'Reply in the language the user writes in.'],
  10: ['comms', 'All config and instruction files are written in English.'],
  11: ['craft', 'Update the docs in the same change as the code.'],
  12: ['craft', 'Confirm nothing equivalent exists before adding it.'],
  13: ['craft', "Match the surrounding code's patterns and style."],
  14: ['process', 'Write a short plan and keep a worklog for non-trivial tasks.'],
  15: ['process', 'Treat the context window as scarce; locate, then read the slice.'],
  16: ['context', 'Read the shared install folder; own only your notebook.'],
  17: ['context', "Read the project's own docs before changing a part."],
  18: ['context', 'Load context.json at session start, and act on it.'],
  19: ['context', "Discover the host's real tools before deciding one is missing."],
  20: ['security', 'Every commit and push needs explicit, repeated consent.'],
}

// Tiny inline formatter: render `code` spans and *emphasis* in plain rule text.
// The full rule bodies are kept lightly marked-up in src/laws/universal.md, so a
// minimal formatter is enough — we don't need the full Markdown renderer here.
function LawText({ text }) {
  const parts = String(text).split(/(`[^`]+`|\*[^*]+\*)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`'))
          return <code key={i}>{p.slice(1, -1)}</code>
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2)
          return <em key={i}>{p.slice(1, -1)}</em>
        return <React.Fragment key={i}>{p}</React.Fragment>
      })}
    </>
  )
}

// The laws API returns `name` as a Roman numeral (I, II, … XX) — that's the
// shape `_parse_laws` extracts from the source markdown's headings. Convert to
// an Arabic integer so we can use it as a LAW_META key and pad the displayed
// numeral. Returns NaN for anything that isn't a recognised Roman numeral, in
// which case the caller falls back to the raw `name`.
const ROMAN_VAL = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
function romanToInt(raw) {
  if (!raw) return NaN
  const s = String(raw).toUpperCase()
  if (!/^[IVXLCDM]+$/.test(s)) return NaN
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN_VAL[s[i]]
    const next = ROMAN_VAL[s[i + 1]]
    total += next && next > v ? -v : v
  }
  return total
}

// Strip the "Rule <num> — " prefix the catalog includes in `title`, so the
// table shows just the law's name. The server emits the Roman numeral, so we
// match either the Roman form or the Arabic equivalent for resilience.
function lawName(rawTitle, romanNum, arabicNum) {
  const re = new RegExp(`^Rule\\s+(${romanNum}|${arabicNum})\\s*[—-]\\s*`)
  return rawTitle.replace(re, '').trim() || rawTitle
}

// One expandable row: lazy-loads its full body via /api/item/law/<roman>
// the first time it opens. Cached on subsequent toggles so re-opening is
// instant. The endpoint takes the Roman num (matching api_item's lookup),
// not the Arabic integer we use for display + classification.
function LawRow({ law, isOpen, onToggle }) {
  const cat = LAW_CATS[law.cat]
  const { data: detail } = useAsync(
    () => (isOpen ? api.item('law', law.roman) : Promise.resolve(null)),
    [isOpen, law.roman],
  )
  const body = detail?.body || law.ess
  return (
    <>
      <button
        className={`law-row ${isOpen ? 'on' : ''}`}
        style={{ '--cc': cat.c }}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="law-no">
          <span className="x">›</span>
          {law.pad}
        </span>
        <span className="law-name">{law.name}</span>
        <span className="law-princ">{law.ess}</span>
        <span className="law-class">
          <span className="cdot" />
          {cat.label}
        </span>
      </button>
      {isOpen && (
        <div className="law-expand">
          {detail ? (
            <p>
              <LawText text={body} />
            </p>
          ) : (
            <p className="dim">Loading…</p>
          )}
          <div className="law-srcline">
            $ geneseed law {law.roman} · laws/universal.md
          </div>
        </div>
      )}
    </>
  )
}

// `selected` is the Roman numeral from a #/item/law/<roman> deep-link (Spotlight,
// the old Library route). The open row is driven straight off the URL so those
// links pre-open the rule and any opened rule is itself shareable.
export default function Laws({ selected }) {
  const { data, error } = useAsync(() => api.catalog('laws'), [])
  const [sel, setSel] = useState('all')
  const open = selected || null
  const toggle = (roman) => go(open === roman ? '#/laws' : `#/item/law/${roman}`)

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const laws = (data.items || []).map((it) => {
    const roman = it.name
    const n = romanToInt(roman)
    const pad = Number.isFinite(n) ? String(n).padStart(2, '0') : String(roman)
    // Prefer the API's classification (server-side LAW_CLASS) and fall back to
    // the local LAW_META map if an older server didn't return one. The
    // principle line is always local — it's display copy, not domain data.
    const [metaCat, ess] = LAW_META[n] || ['craft', '']
    const cat = (it.klass && LAW_CATS[it.klass] ? it.klass : metaCat)
    return { n, roman, pad, name: lawName(it.title, roman, n), cat, ess }
  })
  const counts = {}
  laws.forEach((l) => {
    counts[l.cat] = (counts[l.cat] || 0) + 1
  })
  const shown = sel === 'all' ? laws : laws.filter((l) => l.cat === sel)

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">governance</div>
          <h1 className="h">Laws</h1>
          <p className="sub">
            The universal rules the agent obeys in every task, in every repository. Pick a class to
            filter, or open any rule to read its canonical text.
          </p>
        </div>
      </div>
      <div className="law-toolbar">
        <div className="law-cats">
          <button
            className={`law-cat ${sel === 'all' ? 'on' : ''}`}
            onClick={() => setSel('all')}
          >
            <span>All</span>
            <span className="cn">{laws.length}</span>
          </button>
          {LAW_CAT_ORDER.map((k) => (
            <button
              key={k}
              className={`law-cat ${sel === k ? 'on' : ''}`}
              style={{ '--cc': LAW_CATS[k].c }}
              onClick={() => setSel(k)}
            >
              <span className="cdot" />
              <span>{LAW_CATS[k].label}</span>
              <span className="cn">{counts[k] || 0}</span>
            </button>
          ))}
        </div>
        <span className="law-readout">
          <b>{shown.length}</b> rules · <b>6</b> classes · source <b>laws/universal.md</b>
        </span>
      </div>
      <div className="card law-wrap">
        <div className="law-rowhead">
          <span>№</span>
          <span>Rule</span>
          <span>Principle</span>
          <span>Class</span>
        </div>
        {shown.map((l) => (
          <LawRow
            key={l.roman}
            law={l}
            isOpen={open === l.roman}
            onToggle={() => toggle(l.roman)}
          />
        ))}
        {shown.length === 0 && (
          <div className="empty" style={{ padding: 32 }}>
            <div className="big">No rules in this class</div>
            Try another class — or pick All.
          </div>
        )}
      </div>
    </>
  )
}
