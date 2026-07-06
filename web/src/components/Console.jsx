import React, { useEffect, useRef } from 'react'
import { Icon } from './Icon.jsx'

// Bottom console drawer. Every action triggered from the UI streams here live;
// history is hydrated from the server so it survives reload and restart.
export default function Console({ runs, open, onToggle, onClear, onCancel, busy }) {
  const bodyRef = useRef(null)
  const lastLen = runs.length ? runs[runs.length - 1].output.length : 0
  useEffect(() => {
    const el = bodyRef.current
    if (el && open) el.scrollTop = el.scrollHeight
  }, [runs.length, lastLen, open])

  return (
    <div
      className="console"
      style={{
        height: '42vh',
        transform: open ? 'none' : 'translateY(calc(42vh - 42px))',
      }}
    >
      <div className="console-head" onClick={onToggle}>
        <span className="ttl">
          <span className={`live ${busy ? 'on' : ''}`} />
          terminal
        </span>
        <span className="count">{runs.length}</span>
        <div className="right" onClick={(e) => e.stopPropagation()}>
          <button className="iconbtn" title="Clear" onClick={onClear} disabled={!runs.length}>
            <Icon name="clear" />
          </button>
          <button
            className="iconbtn"
            title={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            onClick={onToggle}
          >
            <Icon
              name="chevron"
              className="glyph"
              style={{ transform: open ? 'rotate(90deg)' : 'rotate(-90deg)' }}
            />
          </button>
        </div>
      </div>
      {open && (
        <div className="console-body" ref={bodyRef}>
          {runs.length === 0 && (
            <div className="console-empty">
              No commands run yet. Actions you trigger stream here.
            </div>
          )}
          {runs.map((r) => (
            <div className="run" key={r.id}>
              <div className="run-head">
                <span className="pr">$</span>
                <span className="act">{r.action}</span>
                <span className={`st ${r.status}`}>
                  {r.status === 'running'
                    ? '…running'
                    : `${r.status === 'done' ? '✓ done' : '✗ failed'}${r.duration ? ` · ${r.duration}s` : ''}`}
                </span>
                {r.status === 'running' && onCancel && (
                  <button
                    className="iconbtn run-cancel"
                    title="Cancel this run"
                    onClick={() => onCancel(r.id)}
                  >
                    <Icon name="x" />
                  </button>
                )}
              </div>
              {r.output && <pre className="run-out">{r.output}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
