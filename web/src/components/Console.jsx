import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon.jsx'
import { formatDuration, parseRun, runTone } from '../lib/runPhases.js'

const PILL = { running: 'Running', failed: 'Failed', done: 'Done', warn: 'Done' }
// The run list's visible state, beside the dot, so the state never rests on colour alone.
const MARK = { running: 'running', failed: '✗', warn: '⚠' }
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

// Bottom console drawer. Every action triggered from the UI streams here live;
// history is hydrated from the server so it survives reload and restart. The left column lists
// the runs, the right one shows the picked run as a phase timeline read by `parseRun`, with its
// raw output one click away.
export default function Console({ runs, open, onToggle, onClear, onCancel, busy, finish }) {
  const bodyRef = useRef(null)
  const headRef = useRef(null)
  // A click pins a run until the next run starts: the pin remembers the run count it was made
  // at, and any other count means "follow the newest" again.
  const [pin, setPin] = useState({ id: null, at: 0 })
  // The run whose raw log is open: picking another run shows its phases again.
  const [logFor, setLogFor] = useState(null)
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

  // useJobs keeps the same array on quiet poll ticks, so this parses only when output changed.
  const parsed = useMemo(() => runs.map((r) => parseRun(r.output, r.status)), [runs])
  const picked = pin.at === runs.length ? pin.id : null
  const found = picked === null ? -1 : runs.findIndex((r) => r.id === picked)
  const at = found === -1 ? runs.length - 1 : found
  const run = runs[at]
  const view = parsed[at]

  const outLen = run ? run.output.length : 0
  // Another run starts at its top; a running one then follows its own tail below.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [run?.id])
  useEffect(() => {
    const el = bodyRef.current
    if (el && open && run?.status === 'running') el.scrollTop = el.scrollHeight
  }, [outLen, open, run?.status])

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
      {open &&
        (runs.length === 0 ? (
          <div className="console-body">
            <div className="console-empty">
              No commands run yet. Actions you trigger stream here.
            </div>
          </div>
        ) : (
          <div className="console-body cx">
            <ul className="cx-runs" aria-label="Runs">
              {runs
                .map((r, i) => {
                  const tone = runTone(r.status, parsed[i])
                  return (
                    <li key={r.id}>
                      <button
                        className={`cx-run${i === at ? ' on' : ''}`}
                        aria-current={i === at ? 'true' : undefined}
                        onClick={() => setPin({ id: r.id, at: runs.length })}
                      >
                        <span className={`cx-dot ${tone}`} aria-hidden="true" />
                        <span className="cx-run-main">
                          <span className="cx-run-act">{r.action}</span>
                          {parsed[i].detail && (
                            <span className="cx-run-sub" title={parsed[i].detail}>
                              {parsed[i].detail}
                            </span>
                          )}
                        </span>
                        <span className="cx-run-dur">
                          {MARK[tone] && (
                            <span className={`cx-mark ${tone}`} aria-hidden="true">
                              {MARK[tone]}
                            </span>
                          )}
                          {r.status === 'running' ? '' : formatDuration(r.duration)}
                        </span>
                        <span className="sr-only">
                          {PILL[tone]}
                          {tone === 'warn' ? ' with warnings' : ''}
                        </span>
                      </button>
                    </li>
                  )
                })
                .reverse()}
            </ul>
            <section className="cx-detail" ref={bodyRef} aria-label={`Run ${run.action}`}>
              <RunDetail
                run={run}
                view={view}
                showLog={logFor === run.id}
                onLog={() => setLogFor((v) => (v === run.id ? null : run.id))}
                onCancel={onCancel}
              />
            </section>
          </div>
        ))}
    </div>
  )
}

function RunDetail({ run, view, showLog, onLog, onCancel }) {
  const tone = runTone(run.status, view)
  const sum = [
    run.status === 'running' ? 'running' : formatDuration(run.duration),
    plural(view.warnings, 'warning'),
    plural(view.notices, 'notice'),
  ].filter(Boolean)
  return (
    <>
      <header className="cx-head">
        <h3 className="cx-title">{run.action}</h3>
        <span className={`cx-pill ${tone}`}>{PILL[tone]}</span>
        {run.status === 'running' && onCancel && (
          <button
            className="iconbtn run-cancel"
            title="Cancel this run"
            aria-label={`Cancel the ${run.action} run`}
            onClick={() => onCancel(run.id)}
          >
            <Icon name="x" />
          </button>
        )}
        <button className="cx-logbtn" aria-pressed={showLog} onClick={onLog}>
          Full log
        </button>
      </header>
      <p className="cx-sum">{sum.join(' · ')}</p>
      {showLog ? (
        <pre className="run-out">{run.output}</pre>
      ) : (
        <>
          {view.phases.length === 0 && !view.other.length && (
            <div className="console-empty">
              {run.status === 'running' ? 'Waiting for output…' : 'No output'}
            </div>
          )}
          <ol className="cx-phases">
            {view.phases.map((p, i) => (
              <Phase key={i} n={i + 1} p={p} />
            ))}
          </ol>
          {view.runWarnings.length > 0 && (
            <div className="cx-other">
              <div className="cx-ph-title">Run warnings</div>
              {view.runWarnings.map((w, i) => (
                <Warning key={i} w={w} />
              ))}
            </div>
          )}
          {view.other.length > 0 && <OtherOutput lines={view.other} />}
        </>
      )}
    </>
  )
}

// An amber box: the short title, one sentence, and the full text one click away.
function Warning({ w }) {
  return (
    <div className="cx-warn">
      <b>{w.title}</b>
      {w.body && <p>{w.body}</p>}
      {w.text !== w.title && (
        <details>
          <summary>Full text</summary>
          <p className="cx-warn-full">{w.text}</p>
        </details>
      )}
    </div>
  )
}

function Phase({ n, p }) {
  return (
    <li className={`cx-phase ${p.state}`}>
      <span className="cx-num" aria-hidden="true">
        {n}
      </span>
      <div className="cx-ph">
        <div className="cx-ph-head">
          <span className="cx-ph-title">{p.title}</span>
          <span className="cx-ph-state">{p.stateText}</span>
        </div>
        {p.detail && <div className="cx-ph-detail">{p.detail}</div>}
        {p.errors.map((e, i) => (
          <div className="cx-err" key={`e${i}`}>
            {e}
          </div>
        ))}
        {p.failLine && <div className="cx-err">{p.failLine}</div>}
        {p.warnings.map((w, i) => (
          <Warning key={`w${i}`} w={w} />
        ))}
        {p.notices.map((x, i) => (
          <div className="cx-note" key={`n${i}`} title={x.text}>
            {x.title}
          </div>
        ))}
        {p.lines.length > 0 && <pre className="cx-lines">{p.lines.join('\n')}</pre>}
      </div>
    </li>
  )
}

// The final section: lines read before the first phase: the history file keeps only an output's tail, so a long
// run's opening `$` line can be gone.
function OtherOutput({ lines }) {
  return (
    <div className="cx-other">
      <div className="cx-ph-title">Other output</div>
      <pre className="cx-lines">{lines.join('\n')}</pre>
    </div>
  )
}
