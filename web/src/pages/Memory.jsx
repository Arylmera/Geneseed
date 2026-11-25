import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { useConfirm } from '../hooks/useConfirm.jsx'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import Stat from '../components/Stat.jsx'
import StackBar from '../components/StackBar.jsx'
import { Spark } from '../lib/activity.jsx'
import Library from './Library.jsx'
import { Topics, MEMORY_EMPTY } from './memoryParts.jsx'

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`
const kb = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`)
// A token is about four bytes of English: the figure the page prints next to a size, never a measure.
const tokens = (bytes) => `~${Math.round(bytes / 4)} tokens`

// The gate log's decisions, in the order the chart reads them, each with its tone and its words.
export const DECISIONS = [
  { key: 'created', label: 'Created', tone: 'good' },
  { key: 'merged', label: 'Merged', tone: 'accent' },
  { key: 'archived', label: 'Archived', tone: 'muted' },
  { key: 'duplicate', label: 'Turned away (duplicate)', tone: 'warn' },
  { key: 'nothing', label: 'Nothing stored', tone: 'muted' },
  { key: 'failed', label: 'Failed', tone: 'bad' },
]
const DAYS = 30

// The log's lines as 30 per-day counts for each decision, oldest day first, ending today (local days). A line
// with no parseable date counts nowhere.
export function perDay(log, now = Date.now()) {
  const day = (t) => new Date(t).toDateString()
  const keys = Array.from({ length: DAYS }, (_, i) => day(now - (DAYS - 1 - i) * 86400000))
  const at = new Map(keys.map((k, i) => [k, i]))
  const rows = Object.fromEntries(DECISIONS.map((d) => [d.key, Array(DAYS).fill(0)]))
  for (const e of log || []) {
    const t = Date.parse(e.at)
    const i = Number.isFinite(t) ? at.get(day(t)) : undefined
    if (i !== undefined && rows[e.decision]) rows[e.decision][i] += 1
  }
  return rows
}

function Decisions({ log }) {
  const rows = perDay(log)
  const sums = DECISIONS.map((d) => ({ ...d, n: rows[d.key].reduce((s, v) => s + v, 0) }))
  const total = sums.reduce((s, d) => s + d.n, 0)
  return (
    <section className="card pad-md mem-card" aria-labelledby="mem-dec-h">
      <div className="panel-head">
        <h2 id="mem-dec-h">Learn decisions · {DAYS} days</h2>
        <span className="mono dim">{plural(total, 'decision')}</span>
      </div>
      {total ? (
        <>
          <StackBar parts={sums.filter((d) => d.n)} label="Decisions" />
          <ul className="gate-rows mem-rows">
            {sums.map((d, j) => (
              <li key={d.key}>
                <span>{d.label}</span>
                <Spark vals={rows[d.key]} i={j} sweep />
                <span className="mono">{d.n}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="dim">
          No learn decision in {DAYS} days. Each session that ends adds one line here: what was
          stored, merged or turned away.
        </p>
      )}
    </section>
  )
}

function Cleanup({ m, onAction, onDecided }) {
  const confirm = useConfirm()
  const [err, setErr] = React.useState('')
  const pending = m.plan.pending
  const decide = async (body) => {
    setErr('')
    try {
      const r = await api.memoryDecide(body)
      if (r?.ok === false) setErr(r.error)
      else if (r?.stale?.length)
        setErr(`Dropped ${r.stale.join(', ')}: changed since the cleanup judged it.`)
    } catch (e) {
      setErr(e.body?.error ?? e.message)
    }
    onDecided()
  }
  const run = async () => {
    const ok = await confirm(
      'The learn model reads the facts in batches, merges copies, archives task residue and splits large topics. ' +
        'The whole store is copied aside first, and only the changes it is unsure of wait for you.',
      { title: 'Clean up the memory store?', confirmLabel: 'Clean up' },
    )
    if (ok) await onAction('memory-clean', {})
  }
  return (
    <section className="card pad-md mem-card" aria-labelledby="mem-clean-h">
      <div className="panel-head">
        <h2 id="mem-clean-h">Cleanup</h2>
        <span className="mono dim">
          {m.plan.at ? `last ${new Date(m.plan.at).toLocaleDateString()}` : 'never run'} ·{' '}
          {m.plan.reviewed} of {m.facts} judged
        </span>
      </div>
      <p className="dim">
        {m.learn
          ? `Runs on this install's learn model (${m.learn.command}).`
          : 'This install bakes no learn model: rebuild it with --learn light to clean up from here.'}{' '}
        Preview judges the facts and changes nothing: every action then waits below for you.
      </p>
      <div className="mem-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={!m.learn}
          onClick={() => onAction('memory-clean', { dryRun: true })}
        >
          Preview cleanup
        </button>
        <button type="button" className="btn" disabled={!m.learn} onClick={run}>
          Clean up now
        </button>
      </div>
      {err ? (
        <p className="mem-err" role="alert">
          {err}
        </p>
      ) : null}
      {pending.length ? (
        <>
          <div className="panel-head mem-sub">
            <h3>Waiting for you</h3>
            <span className="mem-actions">
              <button type="button" className="btn ghost" onClick={() => decide({ all: true })}>
                Apply all
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => decide({ all: true, reject: true })}
              >
                Reject all
              </button>
            </span>
          </div>
          <ul className="mem-list">
            {pending.map((a) => (
              <li key={a.slug}>
                <span>
                  <span className="mono">{a.action}</span> {a.slug}
                  {a.into ? <span className="dim"> into {a.into}</span> : null}
                  {a.reason ? <span className="dim"> · {a.reason}</span> : null}
                </span>
                <span className="mem-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => decide({ names: [a.slug] })}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => decide({ names: [a.slug], reject: true })}
                  >
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="dim">Nothing waits for you.</p>
      )}
      {m.backups.length ? (
        <p className="dim mem-xs">
          {plural(m.backups.length, 'backup')} in archived-cleanup/, newest {m.backups[0]}.
        </p>
      ) : null}
    </section>
  )
}

const WHEN = (t) => {
  const d = new Date(t)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

function Recent({ log }) {
  const rows = [...(log || [])].reverse().slice(0, 40)
  if (!rows.length) return null
  return (
    <section className="card pad-md mem-card" aria-labelledby="mem-log-h">
      <div className="panel-head">
        <h2 id="mem-log-h">Recent decisions</h2>
        <span className="mono dim">newest first</span>
      </div>
      <ul className="mem-list mem-log">
        {rows.map((e, i) => (
          <li key={i}>
            <span className="mono dim mem-xs">{WHEN(e.at)}</span>
            <span className={`mem-dec mem-${e.decision}`}>{e.decision}</span>
            <span className="mem-what">
              {e.slug ? <span className="mono">{e.slug}</span> : null}
              {e.of ? <span className="dim"> → {e.of}</span> : null}
              {e.reason ? <span className="dim"> · {e.reason}</span> : null}
            </span>
            <span className="dim mem-xs">{e.source}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Archived({ m, onDecided }) {
  const [err, setErr] = React.useState('')
  if (!m.archivedCount) return null
  const restore = async (name) => {
    setErr('')
    try {
      const r = await api.memoryRestore(name)
      if (r?.ok === false) setErr(r.error)
    } catch (e) {
      setErr(e.body?.error ?? e.message)
    }
    onDecided()
  }
  return (
    <section className="card pad-md mem-card" aria-labelledby="mem-arch-h">
      <div className="panel-head">
        <h2 id="mem-arch-h">Archived</h2>
        <span className="mono dim">{plural(m.archivedCount, 'fact')}</span>
      </div>
      {err ? (
        <p className="mem-err" role="alert">
          {err}
        </p>
      ) : null}
      <ul className="mem-list">
        {m.archived.map((a) => (
          <li key={a.name}>
            <span>
              <span className="mono">{a.name}</span>
              {a.desc ? <span className="dim"> · {a.desc}</span> : null}
            </span>
            <button type="button" className="btn ghost" onClick={() => restore(a.name)}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Memory: the store the agent reads at every session start, and what keeps it small. The numbers and the
// decisions come from GET /api/memory (js/web/memory-api.mjs); the fact list below is the Library reader locked
// to memory, as it was on Personal, so an opened fact keeps its address on this page.
export default function Memory({ item, dataRev, onAction, onCountsChanged }) {
  const [rev, setRev] = React.useState(0)
  const { data: m, error, reload } = useAsync(() => api.memory(), [dataRev, rev])
  const [topic, setTopic] = React.useState(null)
  const bump = () => {
    setRev((r) => r + 1)
    onCountsChanged?.()
  }
  const header = (
    <PageHeader
      title="Memory"
      sub="The facts the agent reads at session start, what learn kept or turned away, and the cleanup that keeps the store small."
    />
  )
  if (error) {
    return (
      <>
        {header}
        <ErrorState title="The memory store could not be read" error={error} onRetry={reload} />
      </>
    )
  }
  if (!m) return header
  if (!m.facts && !m.archivedCount && !m.log.length && !item) {
    return (
      <>
        {header}
        <EmptyState title={MEMORY_EMPTY.title} action={MEMORY_EMPTY.action}>
          {MEMORY_EMPTY.body}
        </EmptyState>
      </>
    )
  }
  const largest = m.topics.reduce((a, t) => (t.bytes > (a?.bytes ?? -1) ? t : a), null)
  return (
    <>
      {header}
      <div className="mem-stats">
        <Stat label="Facts" value={m.facts} delta={plural(m.topics.length, 'topic')} />
        <Stat label="Archived" value={m.archivedCount} />
        <Stat label="Waiting for you" value={m.plan.pending.length} />
        <Stat label="Index at session start" value={kb(m.mapBytes)} delta={tokens(m.mapBytes)} />
        <Stat
          label="Largest topic file"
          value={largest ? kb(largest.bytes) : '—'}
          delta={largest ? `${largest.topic} · ${plural(largest.n, 'fact')}` : null}
        />
      </div>
      <div className="mem-grid">
        <Decisions log={m.log} />
        <Cleanup m={m} onAction={onAction} onDecided={bump} />
      </div>
      <Topics
        topics={m.topics.map(({ topic: t, n }) => ({ topic: t, n }))}
        picked={topic}
        onPick={setTopic}
      />
      <Library
        lock="memory"
        topic={topic}
        base="#/memory"
        selected={item}
        dataRev={dataRev + rev}
        onCountsChanged={bump}
        onRulesChanged={bump}
      />
      <Recent log={m.log} />
      <Archived m={m} onDecided={bump} />
    </>
  )
}
