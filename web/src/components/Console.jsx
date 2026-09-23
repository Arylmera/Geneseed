import React, { useEffect, useRef } from 'react'
import { Icon } from './Icon.jsx'

// Bottom console drawer. Every action triggered from the UI streams here live;
// history is hydrated from the server so it survives reload and restart.
export default function Console({ runs, open, onToggle, onClear, onCancel, busy, finish }) {
  const bodyRef = useRef(null)
  const headRef = useRef(null)
  // The end of a watched run flashes the head once, green or red — the console is usually
  // collapsed to its 42px strip, and a dot that merely stops pulsing is easy to miss.
  // A class toggle, not state: restarting a CSS animation needs the class off, a reflow,
  // and the class back on, which a re-render cannot express.
  useEffect(() => {
    const el = headRef.current
    if (!finish || !el) return
    el.classList.remove('flash-ok', 'flash-bad')
    void el.offsetWidth
    el.classList.add(finish.status === 'done' ? 'flash-ok' : 'flash-bad')
  }, [finish])
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
      <div
        className="console-head"
        ref={headRef}
        onClick={onToggle}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget)
            e.currentTarget.classList.remove('flash-ok', 'flash-bad')
        }}
      >
        {/* indeterminate: a job reports no percentage, only that it is still going */}
        {busy && <span className="console-progress" aria-hidden="true" />}
        <span className="ttl">
          <span className={`live ${busy ? 'on' : ''}`} />
          terminal
        </span>
        <span className="count">{runs.length}</span>
        <div className="right" onClick={(e) => e.stopPropagation()}>
          <button
            className="iconbtn"
            title="Clear"
            aria-label="Clear run history"
            onClick={onClear}
            disabled={!runs.length}
          >
            <Icon name="clear" />
          </button>
          <button
            className="iconbtn"
            title={open ? 'Collapse' : 'Expand'}
            aria-label={open ? 'Collapse console' : 'Expand console'}
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
                    aria-label={`Cancel the ${r.action} run`}
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
