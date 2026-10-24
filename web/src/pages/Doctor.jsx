import React, { useRef, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// `i` staggers the cards in as the result lands, and each status dot pops as its card
// arrives: the checks read as having been run one after another, which is what happened.
function CheckCard({ group, i }) {
  const clean = group.problems.length === 0
  const [open, setOpen] = useState(!clean)
  return (
    <div
      className={`card check rise ${clean ? '' : 'bad'} ${open ? 'open' : ''}`}
      style={{ '--i': i * 0.6 }}
    >
      <button
        className="check-head"
        onClick={() => setOpen((v) => !v)}
        disabled={clean}
        aria-expanded={clean ? undefined : open}
      >
        <span className={`feed-dot ${clean ? 'ok' : 'bad'}`} />
        <h3>{group.label}</h3>
        <span className={`badge ${clean ? 'ok' : 'bad'}`}>
          <span className="dot" />
          {clean
            ? 'clean'
            : `${group.problems.length} problem${group.problems.length === 1 ? '' : 's'}`}
        </span>
        {!clean && <Icon name="chevron" className="chev glyph" />}
      </button>
      {!clean && open && (
        <div className="check-body">
          {group.problems.map((p) => (
            <div className="problem" key={p}>
              <span className="x">✕</span>
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Doctor({ dataRev }) {
  // Mount and every `dataRev` bump (a finished job) read the daemon's cached verdict; only
  // Re-run asks for a fresh one. The loader spends the flag, so the next read is cached again.
  const fresh = useRef(false)
  const { data, error, reload, setData } = useAsync(() => {
    const f = fresh.current
    fresh.current = false
    return api.doctor(f)
  }, [dataRev])
  // Re-running clears the result first so the button reads "Running…" and the
  // sandbox-build loading copy shows while every theme is re-validated.
  const rerun = () => {
    fresh.current = true
    setData(null)
    reload()
  }

  if (error) return <ErrorState error={error} onRetry={reload} />

  // Problems lead; clean checks fold into one closed <details> — a wall of green buried them.
  const dirty = data ? data.groups.filter((g) => g.problems.length) : []
  const clean = data ? data.groups.filter((g) => !g.problems.length) : []

  return (
    <div className="narrow">
      <div className="head-row mb-16">
        <div>
          <h2 className="h">Doctor</h2>
          <p className="sub">
            Every check builds each theme in a sandbox and validates the result: token resolution,
            link integrity, parity, and drift.
          </p>
        </div>
        <button className="btn" onClick={rerun} disabled={!data}>
          <Icon name="refresh" />
          {data ? 'Re-run checks' : 'Running…'}
        </button>
      </div>

      {!data ? (
        <Loading label="Running every check (builds each theme in a sandbox)…" />
      ) : (
        <>
          <div className="card pad-md mb-16 doc-summary">
            <div className="row wrap between gap-12">
              <div className="row wrap gap-10">
                <span className="dim mono">
                  validated {data.themes.length} theme{data.themes.length === 1 ? '' : 's'}
                </span>
                {data.checked_at ? (
                  <span className="dim mono" title={data.checked_at}>
                    checked {data.checked_at.slice(11)}
                  </span>
                ) : null}
                {data.themes.map((t) => (
                  <span key={t} className="badge cap">
                    {t}
                  </span>
                ))}
              </div>
              {data.ok ? (
                <span className="badge ok">
                  <span className="dot" />
                  all clean
                </span>
              ) : (
                <span className="badge bad">
                  <span className="dot" />
                  {data.problems.length} problem{data.problems.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>
          <div className="stack gap-12">
            {dirty.map((g, i) => (
              <CheckCard key={g.label} group={g} i={i} />
            ))}
            {clean.length ? (
              <details className="check-fold">
                <summary>
                  {clean.length} clean check{clean.length === 1 ? '' : 's'}
                </summary>
                <div className="stack gap-12">
                  {clean.map((g, i) => (
                    <CheckCard key={g.label} group={g} i={dirty.length + i} />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
