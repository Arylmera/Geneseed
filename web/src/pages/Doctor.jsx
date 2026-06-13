import React, { useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

function CheckCard({ group }) {
  const clean = group.problems.length === 0
  const [open, setOpen] = useState(!clean)
  return (
    <div className={`card check ${clean ? '' : 'bad'} ${open ? 'open' : ''}`}>
      <div
        className="check-head"
        onClick={() => !clean && setOpen((v) => !v)}
        style={{ cursor: clean ? 'default' : 'pointer' }}
      >
        <span className={`feed-dot ${clean ? 'ok' : 'bad'}`} style={{ width: 9, height: 9 }} />
        <h3>{group.label}</h3>
        <span className={`badge ${clean ? 'ok' : 'bad'}`}>
          <span className="dot" />
          {clean ? 'clean' : `${group.problems.length} problem${group.problems.length === 1 ? '' : 's'}`}
        </span>
        {!clean && <Icon name="chevron" className="chev glyph" />}
      </div>
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

export default function Doctor() {
  const { data, error, reload, setData } = useAsync(() => api.doctor(), [])
  // Re-running clears the result first so the button reads "Running…" and the
  // sandbox-build loading copy shows while every theme is re-validated.
  const rerun = () => { setData(null); reload() }

  if (error) return <ErrorState error={error} />

  return (
    <div className="narrow">
      <div className="head-row mb-16">
        <div>
          <span className="eyebrow">health</span>
          <h1 className="h">Doctor</h1>
          <p className="sub">
            Every check builds each theme in a sandbox and validates the result — token
            resolution, link integrity, parity, and drift.
          </p>
        </div>
        <button className="btn ghost" onClick={rerun} disabled={!data}>
          <Icon name="refresh" />
          {data ? 'Re-run checks' : 'Running…'}
        </button>
      </div>

      {!data ? (
        <Loading label="Running every check (builds each theme in a sandbox)…" />
      ) : (
        <>
          <div className="card pad-md mb-16">
            <div className="row wrap between gap-12">
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span className="dim mono" style={{ fontSize: 12 }}>
                  validated {data.themes.length} theme{data.themes.length === 1 ? '' : 's'}
                </span>
                {data.themes.map((t) => (
                  <span key={t} className="badge" style={{ textTransform: 'capitalize' }}>
                    {t}
                  </span>
                ))}
              </div>
              {data.ok
                ? <span className="badge ok"><span className="dot" />all clean</span>
                : <span className="badge bad"><span className="dot" />{data.problems.length} problem{data.problems.length === 1 ? '' : 's'}</span>}
            </div>
          </div>
          <div className="stack gap-12">
            {data.groups.map((g) => <CheckCard key={g.label} group={g} />)}
          </div>
        </>
      )}
    </div>
  )
}
