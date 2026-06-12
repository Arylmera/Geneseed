import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

function CheckCard({ group }) {
  const clean = group.problems.length === 0
  const [open, setOpen] = useState(!clean)
  return (
    <div className={`panel check ${clean ? '' : 'check-bad'}`}
         onClick={() => !clean && setOpen((v) => !v)}
         style={{ cursor: clean ? 'default' : 'pointer' }}>
      <div className="check-head">
        <h3>{group.label}</h3>
        <span className={`badge ${clean ? 'ok' : 'err'}`}>
          {clean ? 'clean' : `${group.problems.length} problem${group.problems.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {!clean && open && (
        <ul className="check-problems">
          {group.problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function Doctor() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  const load = () => {
    setData(null)
    setErr('')
    api.doctor().then(setData).catch((e) => setErr(e.message))
  }
  useEffect(load, [])

  if (err) return <div className="container"><p className="badge warn">{err}</p></div>

  return (
    <div className="container narrow">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Doctor</h2>
        <button className="btn ghost" onClick={load} disabled={!data}>
          {data ? 'Re-run checks' : 'Running…'}
        </button>
      </div>
      {!data ? (
        <p className="muted">Running every check (builds each theme in a sandbox) — this
          takes a few seconds…</p>
      ) : (
        <>
          <p className="muted">
            Validated theme{data.themes.length === 1 ? '' : 's'}: {data.themes.join(', ')} ·{' '}
            {data.ok
              ? <span className="badge ok">all checks clean</span>
              : <span className="badge err">{data.problems.length} problem{data.problems.length === 1 ? '' : 's'}</span>}
          </p>
          {data.groups.map((g) => <CheckCard key={g.label} group={g} />)}
        </>
      )}
    </div>
  )
}
