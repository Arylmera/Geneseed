import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Loading from '../components/Loading.jsx'
import Markdown from '../components/Markdown.jsx'
import KitApply, { KitState } from '../components/KitApply.jsx'
import { GroupedRows, LibList, filterRows } from '../components/LibRows.jsx'
import RailCats, { groupsOf } from '../components/RailCats.jsx'
import { Switch } from './Installs/controls.jsx'
import { kitsLocked, kitsOf, useKitStaging } from '../hooks/useKitStaging.js'

const enc = encodeURIComponent
const ON = 'Enabled'
const OFF = 'Not enabled'
const words = (s) => (s || '').split(/\s+/).filter(Boolean).length
const uniq = (a) => [...new Set(a.filter(Boolean))]
const short = (c) => (c || '').slice(0, 7)

// A kit as a list row. Each field the backend may not send yet reads as nothing.
function kitRows(kits, installs) {
  return [ON, OFF].flatMap((group) =>
    kits
      .map((k) => ({ k, on: installs.filter((i) => kitsOf(i).includes(k.name)) }))
      .filter(({ on }) => on.length > 0 === (group === ON))
      .map(({ k, on }) => {
        const credits = k.credits || []
        const from = uniq(credits.map((c) => c.author || c.repo)).join(', ')
        const licence = uniq(credits.map((c) => c.license)).join(', ')
        return {
          name: k.name,
          desc: k.description,
          group,
          def: k,
          meta: [
            `${(k.skills || []).length} skills · ${(k.agents || []).length} agents · ${words(k.rules)} rule words`,
            on.length ? `on in ${on.map((i) => `${i.host} · ${i.scope}`).join(', ')}` : null,
            from ? `from ${from}${licence ? ` (${licence})` : ''}` : null,
          ]
            .filter(Boolean)
            .join(' — '),
        }
      }),
  )
}

// A member links to its Library entry only while the catalog lists it: a kit that is off for
// the selected harness has its members uninstalled, and the Library would 404 them.
const Links = ({ type, names, listed }) =>
  names.length ? (
    <ul className="kit-links">
      {names.map((n) => (
        <li key={n}>
          {listed?.has(n) ? (
            <a href={`#/item/${type}/${enc(n)}`}>{n}</a>
          ) : (
            <span className="kit-link-off" title="Installed when this kit is on">
              {n}
            </span>
          )}
        </li>
      ))}
    </ul>
  ) : (
    <p className="panel-note">None.</p>
  )

function KitDetail({ kit, installs, stage, listed }) {
  const credits = kit.credits || []
  return (
    <>
      <div className="reader-tags">
        <span className="tag acc">Kit</span>
        {uniq(credits.map((c) => c.license)).map((l) => (
          <span className="tag" key={l}>
            {l}
          </span>
        ))}
      </div>
      <h2 className="reader-title">{kit.name}</h2>
      {kit.description ? <p className="reader-lede">{kit.description}</p> : null}
      <p className="mono dim reader-src">kits/{kit.name}/</p>
      <hr className="hr" />

      <h3 className="loop-h2">Installs</h3>
      {installs.length ? (
        <ul className="kit-list kit-box" aria-label={`Installs for ${kit.name}`}>
          {installs.map((row) => {
            const locked = kitsLocked(row)
            const who = `${row.host} · ${row.scope}`
            return (
              <li className="kit-install" key={row.id}>
                <div className="kit-row">
                  <div className="kit-main">
                    <b>{who}</b>
                    <span className="mono dim">{row.path}</span>
                  </div>
                  <KitState row={row} />
                  <Switch
                    on={stage.setOf(row).has(kit.name)}
                    disabled={locked || stage.running(row)}
                    label={`${kit.name} for ${who}`}
                    onToggle={() => stage.toggle(row, kit.name)}
                  />
                </div>
                {locked && <p className="kit-lock">{row.reason || row.error}</p>}
                <KitApply row={row} stage={stage} />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="panel-note">No install yet.</p>
      )}

      {credits.length ? (
        <>
          <h3 className="loop-h2">Upstream</h3>
          <dl className="loop-facts">
            {credits.map((c) => (
              <React.Fragment key={c.key || c.repo}>
                <dt>{c.author || c.repo}</dt>
                <dd>
                  <span className="mono">{c.repo}</span>
                  {c.commit ? <span className="mono dim">@ {short(c.commit)}</span> : null}
                  {c.compareUrl ? (
                    <a
                      href={c.compareUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Compare ${c.repo} @ ${short(c.commit)} with HEAD`}
                    >
                      compare
                    </a>
                  ) : null}
                  {c.license ? <span className="tag">{c.license}</span> : null}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </>
      ) : null}

      <h3 className="loop-h2">Skills</h3>
      <Links type="skill" names={kit.skills || []} listed={listed?.skills} />
      <h3 className="loop-h2">Agents</h3>
      <Links type="agent" names={kit.agents || []} listed={listed?.agents} />

      {kit.rules ? (
        <>
          <h3 className="loop-h2">
            Rules{' '}
            <span className="mono dim">
              {words(kit.rules)}
              {kit.rulesWordBudget ? ` / ${kit.rulesWordBudget}` : ''} words
            </span>
          </h3>
          <div className="lib-doc detail-doc">
            <Markdown body={kit.rules} />
          </div>
        </>
      ) : null}

      {kit.banned?.length ? (
        <>
          <h3 className="loop-h2">Banned APIs</h3>
          <ul className="kit-links" aria-label="Banned APIs">
            {kit.banned.map((b) => (
              <li key={b}>
                <span className="kit-link-off">{b}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  )
}

// The Kits page, in the Library's three panes: a rail (its title, plus an enabled-or-not
// filter once there are enough kits to narrow), the kits, the
// selected kit. `#/kits` opens on the first kit, `#/kits/<name>` on that one. A kit is
// switched per install here with the same staged-Apply flow as Installs / Kits.
export default function Kits({ item, onAction, dataRev }) {
  const { data, error } = useAsync(() => api.kits(), [dataRev])
  const stage = useKitStaging(data, onAction)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')

  const kits = data?.kits || []
  const installs = data?.installs || []
  const rows = kitRows(kits, installs)
  const pool = cat === 'all' ? rows : rows.filter((r) => r.group === cat)
  const shown = filterRows(pool, q)
  // An unknown name is its own state: opening the first kit would let a stale link switch a kit nobody named.
  const missing = !!item && !!data && !rows.some((r) => r.name === item)
  const sel = missing ? null : rows.find((r) => r.name === item) || rows[0] || null
  const { data: cat2 } = useAsync(
    () =>
      Promise.all([api.catalog('skills'), api.catalog('agents')])
        .then(([s, a]) => ({
          skills: new Set((s.items || []).map((i) => i.name)),
          agents: new Set((a.items || []).map((i) => i.name)),
        }))
        .catch(() => null),
    [dataRev],
  )
  const err = error || data?.error
  // A Status filter earns its place only over a list long enough to need narrowing.
  const railCats = rows.length >= 8 ? groupsOf(rows) : []

  return (
    <>
      <ErrorState error={err} style={{ margin: '0 0 var(--sp-3)' }} />
      <div className="library">
        <aside className="lib-kinds" aria-label="Kits sections">
          <div className="lib-title">
            <h1 className="h">Kits</h1>
            <span className="dim">Optional bundles</span>
          </div>
          {/* No self-link: the page has one section, and a link to where you are goes nowhere. */}
          {railCats.length > 1 ? (
            <nav className="kind-list" aria-label="Sections">
              <RailCats
                label="Status"
                total={rows.length}
                cats={railCats}
                cat={cat}
                onChange={setCat}
              />
            </nav>
          ) : null}
        </aside>

        <LibList
          label="Kits"
          count={q.trim() ? `${shown.length} of ${pool.length}` : data ? pool.length : ''}
          q={q}
          onQ={setQ}
          matched={shown.length}
          inView={[item]}
        >
          {!data ? (
            err ? null : (
              <Loading />
            )
          ) : rows.length === 0 ? (
            err ? null : (
              <EmptyState title="No kits">This Geneseed ships no kit.</EmptyState>
            )
          ) : (
            <GroupedRows
              rows={shown}
              activeName={sel?.name}
              hrefOf={(r) => `#/kits/${enc(r.name)}`}
            />
          )}
        </LibList>

        <article className="lib-reader" aria-label="Entry">
          {missing ? (
            <EmptyState title="No such kit" action={<a href="#/kits">Back to all kits</a>}>
              No kit is named “{item}”.
            </EmptyState>
          ) : sel ? (
            <KitDetail
              key={sel.name}
              kit={sel.def}
              installs={installs}
              stage={stage}
              listed={cat2}
            />
          ) : null}
        </article>
      </div>
    </>
  )
}
