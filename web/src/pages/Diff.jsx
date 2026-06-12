import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function Diff() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [exporting, setExporting] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => { api.diff().then(setData).catch((e) => setErr(e.message)) }, [])

  const exportImprovements = async () => {
    setExporting(true)
    try {
      const { job_id } = await api.action('export')
      let j
      do { await new Promise((r) => setTimeout(r, 700)); j = await api.job(job_id) }
      while (j.status === 'running')
      setNote(j.status === 'done' ? 'Improvements file written.' : 'Export failed — see logs.')
    } catch (e) { setNote(e.message) } finally { setExporting(false) }
  }

  if (err) return <div className="container"><p className="badge warn">{err}</p></div>
  if (!data) return <div className="container">Loading…</div>
  if (!data.deployed)
    return <div className="container"><p>No deployed harness to diff against.</p></div>

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Local edits ({data.files.length})</h2>
        <button className="btn" onClick={exportImprovements} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export improvements'}
        </button>
      </div>
      {note ? <p className="muted">{note}</p> : null}
      {data.files.length === 0 ? <p className="muted">Deployed harness matches source.</p> : null}
      {data.files.map((f) => (
        <div className="detail" key={f.rel} style={{ marginBottom: 12 }}>
          <strong>{f.rel}</strong> <span className="badge">{f.status}</span>
          <pre className="markdown">{f.diff.join('\n')}</pre>
        </div>
      ))}
    </div>
  )
}
