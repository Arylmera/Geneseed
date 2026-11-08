import React, { useState } from 'react'
import StackBar from './StackBar.jsx'

// What one agent loads, and the rules it follows (GET /api/loadout[/<agent>], spec 2026-11-08,
// direction A "grouped ledger"): the total first, then the blocks folded into three groups in a
// stacked bar and a card each, then the rules, then what is not counted. Characters are the
// server's; tokens are chars ÷ 4, the estimate the Overview makes, and say so. For an Adept,
// `base` is the primary's loadout, which gives the delta pills against it. `install` names the
// install the figures were read from, so a screenshot always says which one it shows.

// One decimal under 10k, none above: 3.5k, 14k.
export const kchars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : String(n))
const tok = (n) => Math.round(n / 4)
// The three groups, in the order the panel shows them: what every agent inherits first, then
// what only this agent carries (its spec, its user rules or the primary's session files).
const GROUPS = [
  { key: 'root', label: 'Constitution', tone: 'accent', has: (b) => b.source === 'root' },
  { key: 'catalogue', label: 'Catalogues', tone: 'muted', has: (b) => b.source === 'catalogue' },
  {
    key: 'agent',
    label: 'This agent',
    tone: 'warn',
    has: (b) => b.source !== 'root' && b.source !== 'catalogue',
  },
]
const KINDS = [
  ['dictate', 'Dictates'],
  ['doctrine', 'Doctrines'],
  ['user', 'User rules'],
]
const DELIVERY = {
  'not-wired': 'not wired, re-emit this install',
  'no-event': 'not delivered on this host',
}

// The delta: "+ spec 3.5k, + user rules 3.9k, − session files 5.1k". Root and catalogue blocks
// are inherited, so they never appear. The pills split this string on ", ", so it stays the
// delta's one source.
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
const ruleKey = (r) => `${r.layer ?? ''}${r.id}`

function Row({ label, n, children }) {
  return (
    <li>
      <span>{label}</span>
      {children}
      <span className="mono">{kchars(n)}</span>
    </li>
  )
}

export default function Loadout({ loadout, base, error, install }) {
  const [all, setAll] = useState(false)
  if (error) return <p className="sub">Loadout not measured for this install.</p>
  if (!loadout) return null
  const sum = (bs) => bs.reduce((n, b) => n + b.chars, 0)
  const total = sum(loadout.blocks)
  const delta = loadoutDelta(loadout, base)
  const groups = GROUPS.map((g) => {
    const blocks = loadout.blocks.filter(g.has)
    return { ...g, blocks, n: sum(blocks) }
  })
  const [root, cats, own] = groups
  const rootMax = Math.max(1, ...root.blocks.map((b) => b.chars))

  // A sub-agent's user rules reach it only through the SubagentStart hook: where that is not
  // wired, the server still lists the install's rules, but the agent never sees them. The
  // primary has no user-rules block (its rules come with the session files), so it always counts.
  const ur = loadout.blocks.find((b) => b.id === 'user-rules')
  const lost = ur ? DELIVERY[ur.delivery] : undefined
  const rules = loadout.rules || []
  const followed = rules.filter((r) => !(lost && r.kind === 'user'))
  const cited = rules.filter((r) => r.citedBySpec)
  const packs = []
  for (const r of rules) {
    const name =
      r.kind === 'dictate' ? 'Dictates' : r.kind === 'user' ? 'User rules' : r.id.split('.')[0]
    const p = packs.find((x) => x.name === name)
    if (p) p.n += 1
    else packs.push({ name, n: 1, user: r.kind === 'user' })
  }
  const byKind = KINDS.map(([kind, title]) => [
    title,
    followed.filter((r) => r.kind === kind).length,
  ]).filter(([, n]) => n > 0)

  return (
    <section className="loadout" aria-label="Loadout">
      <header className="loadout-head">
        <div>
          <h3 className="loadout-eyebrow mono">Loadout · {install || loadout.host}</h3>
          <p className="loadout-total">
            <strong>{kchars(tok(total))}</strong>
            <span className="dim">tokens at start · {kchars(total)} chars</span>
          </p>
        </div>
        {delta ? (
          <div className="loadout-delta">
            <span className="dim">Against the {base?.noun || 'Primary agent'}</span>
            <ul>
              {delta.split(', ').map((d) => (
                <li key={d} className={`mono loadout-pill${d.startsWith('+') ? ' is-plus' : ''}`}>
                  {d}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <div className="loadout-bar">
        <StackBar
          label="Loadout"
          legend={false}
          parts={groups.map((g) => ({ key: g.key, label: g.label, n: g.n, tone: g.tone }))}
        />
        <ul className="loadout-groups" aria-hidden="true">
          {groups.map((g) =>
            g.n > 0 ? (
              <li key={g.key} style={{ flexGrow: g.n }}>
                <span>{g.label}</span>{' '}
                <span className="mono dim">
                  {kchars(g.n)} · {Math.round((g.n / total) * 100)}%
                </span>
              </li>
            ) : null,
          )}
        </ul>
      </div>

      <details className="loadout-card" open={loadout.agent === 'primary'}>
        <summary>
          <i className="tone-accent" aria-hidden="true" />
          <strong>Constitution</strong>
          <span className="dim">root file, loaded by the host</span>
          <span className="mono dim loadout-sum">
            {kchars(root.n)} · ≈ {kchars(tok(root.n))} tok
          </span>
        </summary>
        <ul className="loadout-root">
          {root.blocks.map((b) => (
            <Row key={b.id} label={b.label} n={b.chars}>
              <span className="loadout-mini" aria-hidden="true">
                <span style={{ width: `${Math.max(4, (b.chars / rootMax) * 100)}%` }} />
              </span>
            </Row>
          ))}
        </ul>
      </details>

      <div className="loadout-pair">
        <div className="loadout-card">
          <p className="loadout-card-h">
            <i className="tone-muted" aria-hidden="true" />
            <strong>Catalogues</strong>
            <span className="mono dim loadout-sum">{kchars(cats.n)}</span>
          </p>
          <ul className="loadout-list">
            {cats.blocks.map((b) => (
              <Row key={b.id} label={b.label} n={b.chars} />
            ))}
          </ul>
          <p className="dim loadout-note">Listed by the host, not by Geneseed.</p>
        </div>
        <div className="loadout-card is-own">
          <p className="loadout-card-h">
            <i className="tone-warn" aria-hidden="true" />
            <strong>This agent</strong>
            <span className="mono dim loadout-sum">{kchars(own.n)}</span>
          </p>
          <ul className="loadout-list">
            {own.blocks.map((b) => (
              <Row key={b.id} label={b.label} n={b.chars}>
                {b.id === 'user-rules' ? (
                  <span className={`loadout-pill${lost ? ' is-plus' : ''}`}>
                    {lost || 'injected at sub-agent start'}
                  </span>
                ) : null}
              </Row>
            ))}
          </ul>
        </div>
      </div>

      <section className="loadout-rules" aria-label="Rules it follows">
        <div className="loadout-rules-h">
          <h4 className="loadout-eyebrow mono">Rules it follows · {followed.length}</h4>
          <span className="dim">{byKind.map(([t, n]) => `${n} ${t}`).join(' · ')}</span>
        </div>
        {cited.length ? (
          <div className="loadout-cited">
            <span className="loadout-cited-h">Cited by its spec</span>
            {cited.map((r) => (
              <a key={ruleKey(r)} href={ruleHref(r)}>
                <span className="mono">{r.id}</span> · {r.title}
              </a>
            ))}
          </div>
        ) : null}
        <ul className="loadout-packs">
          {packs.map((p) =>
            p.user && lost ? (
              <li key={p.name} className="is-muted">
                <span>User rules</span> <span className="mono">{p.n}</span>{' '}
                <span className="dim">{lost}</span>
              </li>
            ) : (
              <li key={p.name}>
                <a href={p.user ? '#/personal/rules' : '#/laws'}>
                  <span>{p.name}</span> <span className="mono dim">{p.n}</span>
                </a>
              </li>
            ),
          )}
        </ul>
        {rules.length ? (
          <button
            type="button"
            className="btn ghost sm"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
          >
            {all ? 'Show fewer' : `Show all ${rules.length} rules`}
          </button>
        ) : null}
        {all
          ? KINDS.map(([kind, title]) => {
              const rs = rules.filter((r) => r.kind === kind)
              const muted = lost && kind === 'user'
              return rs.length ? (
                <div key={kind} className={muted ? 'is-muted' : undefined}>
                  <h5 className="reader-when-h">
                    {title} <span className="mono dim">{rs.length}</span>
                    {muted ? <span className="dim"> · {lost}</span> : null}
                  </h5>
                  <ul>
                    {rs.map((r) => (
                      <li key={ruleKey(r)}>
                        <a href={ruleHref(r)}>
                          <span className="mono">{r.id}</span> {r.title}
                        </a>
                        {r.layer && r.layer !== 'install' ? (
                          <span className="dim"> ({r.layer})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            })
          : null}
      </section>

      <p className="dim loadout-foot">
        Not counted: {loadout.notCounted.join('; ')}. Tokens are chars ÷ 4.
      </p>
    </section>
  )
}
