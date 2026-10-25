import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Loading from '../components/Loading.jsx'
import Markdown from '../components/Markdown.jsx'
import PageHeader from '../components/PageHeader.jsx'
import DataTable from '../components/DataTable.jsx'
import { Bar } from '../components/StackBar.jsx'
import KitApply, { KitState, kitHint } from '../components/KitApply.jsx'
import { Switch } from './Installs/controls.jsx'
import { kitsLocked, kitsOf, useKitStaging } from '../hooks/useKitStaging.js'

const enc = encodeURIComponent
const words = (s) => (s || '').split(/\s+/).filter(Boolean).length
const uniq = (a) => [...new Set(a.filter(Boolean))]
const short = (c) => (c || '').slice(0, 7)

// A member links to its Library entry only while the catalog lists it: the catalog is the
// install the topbar views, and the Library would 404 a member it lacks. Unlinked, the chip says
// "installed when on" only while the kit is on NOWHERE; on for other installs, it says where.
const offTitle = (onN, of) =>
  onN
    ? `Not in the install the topbar views; on in ${onN} of ${plural(of, 'install')}`
    : 'Installed when this kit is on'
const Links = ({ type, names, listed, offNote = offTitle(0) }) =>
  names.length ? (
    <ul className="kit-links">
      {names.map((n) => (
        <li key={n}>
          {listed?.has(n) ? (
            <a href={`#/item/${type}/${enc(n)}`}>{n}</a>
          ) : (
            <span className="kit-link-off" title={offNote}>
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
  const offNote = offTitle(
    installs.filter((r) => kitsOf(r).includes(kit.name)).length,
    installs.length,
  )
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
      <Links type="skill" names={kit.skills || []} listed={listed?.skills} offNote={offNote} />
      <h3 className="loop-h2">Agents</h3>
      <Links type="agent" names={kit.agents || []} listed={listed?.agents} offNote={offNote} />

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

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const who = (row) => `${row.host} · ${row.scope}`

// Where one kit stands on one install: on, off, or a switch staged against that.
function cellState(stage, row, name) {
  const was = kitsOf(row).includes(name)
  const now = stage.setOf(row).has(name)
  if (was === now) return { now, note: now ? 'on' : 'off', staged: false }
  return { now, note: now ? 'staged on' : 'staged off', staged: true }
}

// One kit in the gallery: what it adds (counts and members), whose work it adapts, and a dot per
// install saying where it is on. The heading opens its page: rules, banned APIs, upstream commit.
function KitCard({ kit, installs, stage, listed, max }) {
  const credits = kit.credits || []
  const skills = kit.skills || []
  const agents = kit.agents || []
  const cells = installs.map((r) => ({ row: r, ...cellState(stage, r, kit.name) }))
  const onN = cells.filter((c) => kitsOf(c.row).includes(kit.name)).length
  const stagedN = cells.filter((c) => c.staged).length
  const offNote = offTitle(onN, installs.length)
  const where = `on in ${onN} of ${plural(installs.length, 'install')}${stagedN ? ` · ${stagedN} staged` : ''}`
  return (
    <article className={`kit-card${stagedN ? ' staged' : ''}`} aria-labelledby={`kit-${kit.name}`}>
      <header className="kit-card-head">
        <div className="kit-main">
          <h2 className="kit-card-title" id={`kit-${kit.name}`}>
            <a className="kit-name" href={`#/kits/${enc(kit.name)}`}>
              {kit.name}
            </a>
          </h2>
          {kit.description ? <p className="kit-desc">{kit.description}</p> : null}
        </div>
        {uniq(credits.map((c) => c.license)).map((l) => (
          <span className="tag" key={l}>
            {l}
          </span>
        ))}
      </header>
      <div className="kit-counts">
        <span>Skills</span>
        <Bar value={skills.length} max={max} label="Skills" />
        <span className="mono">{skills.length}</span>
        <span>Agents</span>
        <Bar value={agents.length} max={max} label="Agents" />
        <span className="mono">{agents.length}</span>
      </div>
      {/* No "None." here: the counts above already say 0. */}
      {skills.length ? (
        <Links type="skill" names={skills} listed={listed?.skills} offNote={offNote} />
      ) : null}
      {agents.length ? (
        <Links type="agent" names={agents} listed={listed?.agents} offNote={offNote} />
      ) : null}
      <footer className="kit-card-foot">
        {credits.length ? (
          <span className="kit-credit">
            Adapted from{' '}
            {credits.map((c, i) => (
              <React.Fragment key={c.key || c.repo}>
                {i ? ', ' : null}
                {/* shortcut: assumes a GitHub upstream, as the API's own compareUrl does. */}
                <a href={`https://github.com/${c.repo}`} target="_blank" rel="noreferrer">
                  {c.repo}
                </a>
                {c.author ? ` · ${c.author}` : null}
              </React.Fragment>
            ))}
          </span>
        ) : (
          <span />
        )}
        {installs.length ? (
          <span className="kit-where">
            <span
              className="kit-dots"
              role="img"
              aria-label={cells.map((c) => `${who(c.row)}: ${c.note}`).join(', ')}
            >
              {cells.map((c) => (
                <span
                  key={c.row.id}
                  className={`kit-dot${c.now ? ' on' : ''}${c.staged ? ' staged' : ''}`}
                  title={`${who(c.row)}: ${c.note}`}
                />
              ))}
            </span>
            <span className="mono dim">{where}</span>
          </span>
        ) : null}
      </footer>
    </article>
  )
}

// Kits × installs: a switch per cell, staged until Apply. Each row describes that install, not
// the harness the topbar selects.
function KitMatrix({ kits, installs, stage }) {
  const columns = [
    {
      key: 'install',
      label: 'Install',
      render: (row) => (
        <div className="kit-main">
          <b>{who(row)}</b>
          <span className="mono dim">{row.path}</span>
          {kitsLocked(row) ? (
            <span className="kit-lock-note">{row.reason || row.error}</span>
          ) : null}
        </div>
      ),
    },
    ...kits.map((k) => ({
      key: `kit:${k.name}`,
      label: k.name,
      render: (row) => {
        const c = cellState(stage, row, k.name)
        return (
          <span className="kit-cell">
            <Switch
              on={c.now}
              disabled={kitsLocked(row) || stage.running(row)}
              label={`${k.name} for ${who(row)}`}
              onToggle={() => stage.toggle(row, k.name)}
            />
            <span className={`kit-note${c.staged ? ' staged' : ''}`}>{c.note}</span>
          </span>
        )
      },
    })),
    {
      key: 'change',
      label: 'Change',
      render: (row) => {
        const { on, off } = stage.change(row)
        const all = [...on.map((k) => `+ ${k}`), ...off.map((k) => `− ${k}`)]
        return <span className={`tag${all.length ? ' acc' : ''}`}>{all.join(', ') || 'none'}</span>
      },
    },
  ]
  return (
    <section className="panel flush kit-matrix" aria-labelledby="kit-mx-h">
      <div className="kit-matrix-head">
        <h2 id="kit-mx-h">On which install</h2>
        <span className="dim">
          Each row describes that install, not the one selected in the topbar.
        </span>
      </div>
      {installs.length ? (
        <DataTable
          caption="Kits per install"
          captionHidden
          columns={columns}
          rows={installs}
          rowKey={(r) => r.id}
        />
      ) : (
        <p className="panel-note">No install yet.</p>
      )}
    </section>
  )
}

// The page's one primary action. The server runs one job at a time, so Apply rebuilds ONE
// install — the one rebuilding, else the first staged that has not just failed (a failed one
// must not hide the rest) — and the bar moves on to the next once that refetch lands. Discard
// drops that install's staging.
function StagedBar({ installs, stage }) {
  const dirtyOf = (r) => {
    const { on, off } = stage.change(r)
    return on.length + off.length
  }
  const staged = installs.filter((r) => dirtyOf(r) > 0)
  const row =
    installs.find((r) => stage.running(r)) ||
    staged.find((r) => !stage.failed(r)) ||
    staged[0] ||
    null
  const n = staged.reduce((s, r) => s + dirtyOf(r), 0)
  const running = !!row && stage.running(row)
  const more = staged.filter((r) => r !== row).length
  return (
    <div className={`kit-bar${row ? ' staged' : ''}`} role="region" aria-label="Staged changes">
      <b>
        {n ? `${plural(n, 'change')} on ${plural(staged.length, 'install')}` : 'No staged changes'}
      </b>
      {row ? (
        <span className="kit-hint staged" role="status">
          {who(row)}: {kitHint(row, stage)}
          {more ? ` — ${more} more staged, applied one at a time` : ''}
        </span>
      ) : null}
      <span className="kit-bar-acts">
        <button
          type="button"
          className="btn ghost sm"
          aria-label={row ? `Discard staged kits for ${who(row)}` : 'Discard staged kits'}
          disabled={!row || running}
          onClick={() => stage.discard(row)}
        >
          Discard
        </button>
        <button
          type="button"
          className="btn sm"
          aria-label={row ? `Apply and rebuild kits for ${who(row)}` : 'Apply and rebuild kits'}
          disabled={!row || kitsLocked(row) || !dirtyOf(row) || running || stage.busy}
          title={stage.busy && !running ? 'A job is running' : undefined}
          onClick={() => stage.apply(row)}
        >
          Apply and rebuild
        </button>
      </span>
    </div>
  )
}

// `#/kits` is the gallery (a card per kit) over the kits × installs matrix, closed by the
// staged-changes bar; `#/kits/<name>` is one kit's page: its rules, credits, members and one
// switch per install. Both use the same staged-Apply flow as Installs / Kits.
export default function Kits({ item, onAction, dataRev }) {
  const { data, error } = useAsync(() => api.kits(), [dataRev])
  const stage = useKitStaging(data, onAction)
  const { data: listed } = useAsync(
    () =>
      Promise.all([api.catalog('skills'), api.catalog('agents')])
        .then(([s, a]) => ({
          skills: new Set((s.items || []).map((i) => i.name)),
          agents: new Set((a.items || []).map((i) => i.name)),
        }))
        .catch(() => null),
    [dataRev],
  )
  const kits = data?.kits || []
  const installs = data?.installs || []
  const err = error || data?.error

  if (item) {
    const kit = kits.find((k) => k.name === item)
    return (
      <>
        <PageHeader title="Kits" crumbs={[{ label: 'Kits', href: '#/kits' }, { label: item }]} />
        <ErrorState error={err} style={{ margin: '0 0 var(--sp-3)' }} />
        {!data ? (
          err ? null : (
            <Loading />
          )
        ) : !kit ? (
          // An unknown name is its own state: a stale link must not switch a kit nobody named.
          <EmptyState title="No such kit" action={<a href="#/kits">Back to all kits</a>}>
            No kit is named “{item}”.
          </EmptyState>
        ) : (
          <article className="panel kit-page" aria-label="Entry">
            <KitDetail kit={kit} installs={installs} stage={stage} listed={listed} />
          </article>
        )}
      </>
    )
  }

  const max = Math.max(
    1,
    ...kits.flatMap((k) => [(k.skills || []).length, (k.agents || []).length]),
  )
  return (
    <>
      <PageHeader
        eyebrow={
          data ? `${plural(kits.length, 'kit')} · ${plural(installs.length, 'install')}` : null
        }
        title="Kits"
        sub="A kit adds a stack's skills, agents and rules to an install. Turn one on per install, then apply once."
      />
      <ErrorState error={err} style={{ margin: '0 0 var(--sp-3)' }} />
      {!data ? (
        err ? null : (
          <Loading />
        )
      ) : kits.length === 0 ? (
        err ? null : (
          <EmptyState title="No kits">This Geneseed ships no kit.</EmptyState>
        )
      ) : (
        <div className="kit-page-body">
          <div className="kit-gallery">
            {kits.map((k) => (
              <KitCard
                key={k.name}
                kit={k}
                installs={installs}
                stage={stage}
                listed={listed}
                max={max}
              />
            ))}
          </div>
          <KitMatrix kits={kits} installs={installs} stage={stage} />
          {installs.length ? <StagedBar installs={installs} stage={stage} /> : null}
        </div>
      )}
    </>
  )
}
