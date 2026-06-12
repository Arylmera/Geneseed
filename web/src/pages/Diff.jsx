import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function Diff() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [expanded, setExpanded] = useState(() => new Set())

  const load = () =>
    api.diff().then((d) => { setData(d); setSel(new Set()) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const toggle = (rel) => setSel((s) => {
    const n = new Set(s)
    n.has(rel) ? n.delete(rel) : n.add(rel)
    return n
  })
  const toggleAll = () => setSel((s) =>
    s.size === data.files.length ? new Set() : new Set(data.files.map((f) => f.rel)))

  const exportImprovements = async () => {
    setBusy(true)
    try {
      const { job_id } = await api.action('export')
      let j
      do { await new Promise((r) => setTimeout(r, 700)); j = await api.job(job_id) }
      while (j.status === 'running')
      setNote(j.status === 'done' ? 'Improvements file written.' : 'Export failed — see logs.')
    } catch (e) { setNote(e.message) } finally { setBusy(false) }
  }

  const restore = async () => {
    const files = [...sel]
    const added = files.filter((rel) =>
      data.files.find((f) => f.rel === rel)?.status === 'added')
    const warning = added.length
      ? `Restoring will DELETE ${added.length} deployed-only file(s):\n${added.join('\n')}\n\n`
      : ''
    if (!window.confirm(
      `${warning}Discard local edits and restore ${files.length} file(s) from source?`)) return
    setBusy(true)
    try {
      const res = await api.restore(files)
      const errs = res.errors.length ? ` · ${res.errors.length} error(s): ${res.errors.join('; ')}` : ''
      setNote(`Restored ${res.restored.length}, deleted ${res.deleted.length}${errs}`)
      await load()
    } catch (e) { setNote(e.message) } finally { setBusy(false) }
  }

  if (err) return <div className="container"><p className="badge warn">{err}</p></div>
  if (!data) return <div className="container">Loading…</div>
  if (!data.deployed)
    return <div className="container"><p>No deployed harness to diff against.</p></div>

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Local edits ({data.files.length})</h2>
        <div className="row-actions" style={{ margin: 0, gap: 20 }}>
          <button className="btn ghost" onClick={restore} disabled={busy || sel.size === 0}>
            Restore selected from source{sel.size ? ` (${sel.size})` : ''}
          </button>
          <button className="btn" onClick={exportImprovements} disabled={busy}>
            {busy ? 'Working…' : 'Export improvements'}
          </button>
        </div>
      </div>
      <p className="muted">
        Restore discards the deployed copy and rewrites it from source — keep your
        edits instead by exporting improvements first.
      </p>
      {note ? <p className="muted">{note}</p> : null}
      {data.files.length === 0 ? <p className="muted">Deployed harness matches source.</p> : null}
      {data.files.length > 0 && (
        <label className="muted" style={{ display: 'block', marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={sel.size === data.files.length}
            onChange={toggleAll}
          /> Select all
        </label>
      )}
      {data.files.map((f) => {
        // Long diffs collapse to a preview so a big drift stays scannable.
        const PREVIEW = 8
        const long = f.diff.length > PREVIEW + 4
        const open = !long || expanded.has(f.rel)
        const shownDiff = open ? f.diff : f.diff.slice(0, PREVIEW)
        return (
          <div className="detail" key={f.rel} style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={sel.has(f.rel)} onChange={() => toggle(f.rel)} />
              <strong>{f.rel}</strong> <span className="badge">{f.status}</span>
              <span className="muted" style={{ fontSize: 12 }}>{f.diff.length} lines</span>
            </label>
            <pre className="markdown">{shownDiff.join('\n')}</pre>
            {long && (
              <button
                className="btn ghost sm"
                onClick={() => setExpanded((s) => {
                  const n = new Set(s)
                  n.has(f.rel) ? n.delete(f.rel) : n.add(f.rel)
                  return n
                })}
              >
                {open ? 'Collapse' : `Show all ${f.diff.length} lines`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
