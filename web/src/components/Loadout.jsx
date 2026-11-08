import React from 'react'
import StackBar from './StackBar.jsx'

// What one agent loads, and the rules it follows (GET /api/loadout[/<agent>], spec 2026-11-08):
// a stacked bar of the blocks in load order, one line per block, then the rules grouped by kind,
// each linking to its row on the Laws page. Characters are the server's; tokens are chars ÷ 4,
// the estimate the Overview makes, and say so. For an Adept, `base` is the primary's loadout,
// which gives the one-line delta against it.

// One decimal under 10k, none above: 3.5k, 14k.
export const kchars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : String(n))
const TONE = {
  root: 'accent',
  session: 'good',
  'user-rules': 'good',
  catalogue: 'muted',
  spec: 'warn',
}
const KINDS = [
  ['dictate', 'Dictates'],
  ['doctrine', 'Doctrines'],
  ['user', 'User rules'],
]
const DELIVERY = {
  'not-wired': 'not wired, re-emit this install',
  'no-event': 'not delivered on this host',
}

// The delta line: "+ spec 3.5k, + user rules 3.9k, − session files 5.1k". Root and catalogue
// blocks are inherited, so they never appear.
export function loadoutDelta(loadout, base) {
  if (!loadout || !base) return ''
  const only = (a, b) => a.blocks.filter((x) => x.chars > 0 && !b.blocks.some((y) => y.id === x.id))
  const name = (b) =>
    b.id === 'session-files' ? 'session files' : b.label.replace(/^.* spec$/, 'spec')
  return [
    ...only(loadout, base).map((b) => `+ ${name(b)} ${kchars(b.chars)}`),
    ...only(base, loadout).map((b) => `− ${name(b)} ${kchars(b.chars)}`),
  ].join(', ')
}

const ruleHref = (r) =>
  r.kind === 'user' ? '#/personal/rules' : `#/item/law/${encodeURIComponent(r.id)}`

export default function Loadout({ loadout, base, error }) {
  if (error) return <p className="sub">Loadout not measured for this install.</p>
  if (!loadout) return null
  const total = loadout.blocks.reduce((n, b) => n + b.chars, 0)
  const delta = loadoutDelta(loadout, base)
  return (
    <section className="loadout" aria-label="Loadout">
      <h3 className="reader-when-h">Loadout</h3>
      <p className="dim loadout-nc">Not counted: {loadout.notCounted.join('; ')}.</p>
      {delta ? <p className="mono loadout-delta">{delta}</p> : null}
      <StackBar
        label="Loadout"
        legend={false}
        parts={loadout.blocks.map((b) => ({
          key: b.id,
          label: b.label,
          n: b.chars,
          tone: TONE[b.source],
        }))}
      />
      <p className="mono dim">
        {kchars(total)} chars, about {kchars(Math.round(total / 4))} tokens (chars ÷ 4)
      </p>
      <ul className="loadout-blocks">
        {loadout.blocks.map((b) => (
          <li key={b.id}>
            <i className={`tone-${TONE[b.source] || 'muted'}`} aria-hidden="true" />
            <span>{b.label}</span> <span className="mono">{kchars(b.chars)}</span>{' '}
            <span className="dim">
              {DELIVERY[b.delivery] ?? `≈ ${kchars(Math.round(b.chars / 4))} tokens, ${b.loadedBy}`}
            </span>
          </li>
        ))}
      </ul>
      {KINDS.map(([kind, title]) => {
        const rs = (loadout.rules || []).filter((r) => r.kind === kind)
        return rs.length ? (
          <div key={kind} className="loadout-rules">
            <h4 className="reader-when-h">
              {title} <span className="mono dim">{rs.length}</span>
            </h4>
            <ul>
              {rs.map((r) => (
                <li key={`${r.layer ?? ''}${r.id}`}>
                  <a href={ruleHref(r)}>
                    <span className="mono">{r.id}</span> {r.title}
                  </a>
                  {r.layer && r.layer !== 'install' ? (
                    <span className="dim"> ({r.layer})</span>
                  ) : null}
                  {r.citedBySpec ? <span className="tag">cited by spec</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null
      })}
    </section>
  )
}
