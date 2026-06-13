import React, { useEffect, useState } from 'react'
import { api } from '../api/index.js'
import { Icon } from '../components/Icon.jsx'

// Map a unified-diff line to its display class. Headers (+++/---) and hunk
// markers read as hunks; the synthetic added/missing banners read as context.
function lineKind(ln) {
  if (ln.startsWith('@@') || ln.startsWith('+++') || ln.startsWith('---')) return 'hunk'
  if (ln.startsWith('+')) return 'add'
  if (ln.startsWith('-')) return 'del'
  return 'ctx'
}

export default function Diff() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [open, setOpen] = useState(() => new Set())

  const load = () =>
    api.diff().then((d) => {
      setData(d)
      setSel(new Set())
      setOpen(new Set(d.files.map((f) => f.rel)))
    }).catch((e) => setErr(e.message))
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

  if (err) return <p className="badge bad">{err}</p>
  if (!data) return <div className="loading">Loading…</div>
  if (!data.deployed)
    return (
      <div className="empty">
        <div className="big">No deployed harness</div>
        Nothing to diff against.
      </div>
    )

  const files = data.files
  const editedCount = files.filter((f) => f.status === 'edited').length
  const addedCount = files.filter((f) => f.status === 'added').length
  const missingCount = files.filter((f) => f.status === 'missing').length

  const toggleOpenFile = (rel) => setOpen((s) => {
    const n = new Set(s)
    n.has(rel) ? n.delete(rel) : n.add(rel)
    return n
  })

  return (
    <>
      <div className="head-row" style={{ marginBottom: 16 }}>
        <div>
          <span className="eyebrow">drift from source</span>
          <h1 className="h">Local edits</h1>
          <p className="sub">The agent refines its own deployed files in place. Export them as improvements before any rebuild overwrites them.</p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button
            className="btn ghost"
            disabled={busy || sel.size === 0}
            onClick={restore}
          >
            Restore{sel.size ? ` (${sel.size})` : ''}
          </button>
          <button className="btn" disabled={busy} onClick={exportImprovements}>
            <Icon name="download" />Export improvements
          </button>
        </div>
      </div>

      {note ? <p className="sub" style={{ marginBottom: 14 }}>{note}</p> : null}

      {files.length === 0 ? (
        <div className="empty">
          <div className="big">In sync</div>
          Deployed harness matches source.
        </div>
      ) : (
        <>
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="badge"><span className="dot" style={{ background: 'var(--warn)' }} />{editedCount} edited</span>
              <span className="badge"><span className="dot" style={{ background: 'var(--good)' }} />{addedCount} added</span>
              {missingCount > 0 && (
                <span className="badge"><span className="dot" style={{ background: 'var(--bad)' }} />{missingCount} missing</span>
              )}
            </div>
            <label className="row dim" style={{ gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={{ accentColor: 'var(--accent)' }}
                checked={sel.size === files.length}
                onChange={toggleAll}
              />
              Select all
            </label>
          </div>

          <div className="stack" style={{ gap: 12 }}>
            {files.map((f) => {
              const isOpen = open.has(f.rel)
              const statusClass = f.status === 'added' ? 'ok' : f.status === 'missing' ? 'bad' : 'warn'
              return (
                <div className={`card diff-file${isOpen ? ' open' : ''}`} key={f.rel}>
                  <div className="diff-head">
                    <input
                      type="checkbox"
                      className="chk"
                      checked={sel.has(f.rel)}
                      onChange={() => toggle(f.rel)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="fname">{f.rel}</span>
                    <span className={`badge ${statusClass}`}>
                      <span className="dot" />{f.status}
                    </span>
                    <span className="dim mono" style={{ marginLeft: 'auto', fontSize: 11 }}>{f.diff.length} lines</span>
                    <button
                      className="iconbtn"
                      onClick={() => toggleOpenFile(f.rel)}
                      style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
                    >
                      <Icon name="chevron" />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="diff-body">
                      {f.diff.map((ln, i) => (
                        <div key={i} className={`diff-line ${lineKind(ln)}`}>{ln}</div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
