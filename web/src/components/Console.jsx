import React, { useEffect, useRef } from 'react'

// Persistent right-side terminal. Shows every action triggered from the UI as a
// command run, streaming its output live. Not a popup — always docked.
export default function Console({ runs, collapsed, onToggle, onClear, onCancel }) {
  const bodyRef = useRef(null)

  // Autoscroll to the newest output as it streams in.
  const lastLen = runs.length ? runs[runs.length - 1].output.length : 0
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [runs.length, lastLen])

  if (collapsed) {
    return (
      <button className="console-tab" onClick={onToggle} title="Show console">
        ▤ Console{runs.length ? ` (${runs.length})` : ''}
      </button>
    )
  }

  return (
    <aside className="console">
      <div className="console-head">
        <span className="console-title">Console</span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={onClear} disabled={!runs.length}>Clear</button>
        <button className="btn ghost sm" onClick={onToggle} title="Hide console">⟩</button>
      </div>
      <div className="console-body" ref={bodyRef}>
        {runs.length === 0 && (
          <div className="console-empty">No commands run yet. Actions you trigger appear here.</div>
        )}
        {runs.map((r) => (
          <div className="run" key={r.id}>
            <div className="run-head">
              <span className="prompt">$</span>
              <span className="run-action">{r.action}</span>
              <span className={`run-status ${r.status}`}>
                {r.status === 'running' ? '…'
                  : `${r.status === 'done' ? '✓ done' : '✗ failed'}${r.duration ? ` · ${r.duration}s` : ''}`}
              </span>
              {r.status === 'running' && onCancel && (
                <button
                  className="btn ghost sm run-cancel"
                  onClick={() => onCancel(r.id)}
                  title="Cancel this run"
                >✕</button>
              )}
            </div>
            {r.output && <pre className="run-out">{r.output}</pre>}
          </div>
        ))}
      </div>
    </aside>
  )
}
