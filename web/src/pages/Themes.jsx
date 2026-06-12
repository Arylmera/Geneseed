import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { accentHex } from '../accents.js'

export default function Themes({ onAction }) {
  const [data, setData] = useState(null) // { themes, emits, current }
  const [err, setErr] = useState('')
  const ref = useRef(null)

  useEffect(() => { api.themes().then((d) => { ref.current = d; setData(d) }).catch((e) => setErr(e.message)) }, [])

  if (err) return <p className="badge bad">{err}</p>
  if (!data) return <div className="loading" />

  const apply = (name) => {
    if (!window.confirm(
      `Rebuild the deployed harness with the "${name}" voice?\nThe rebuild runs in the console.`)) return
    onAction('build', { theme: name, emit: data.current.emit })
  }

  return (
    <>
      <div className="head-row">
        <div>
          <span className="eyebrow">voice</span>
          <h1 className="h">Themes</h1>
          <p className="sub">
            Every theme ships the same harness in a different voice. Applying one
            rebuilds the deployed install — structure and behaviour stay identical,
            only the words and the accent change.
          </p>
        </div>
      </div>
      <div className="theme-grid">
        {data.themes.map((t) => {
          const isCur = t.name === data.current.theme
          return (
            <div
              key={t.name}
              className={`card theme-card${isCur ? ' current' : ''}`}
              style={{ '--tc': accentHex(t.accent) }}
            >
              <span className="tc-glow" />
              <div className="th-head">
                <span className="th-orb" />
                <span className="th-name">{t.name}</span>
                {isCur && (
                  <span className="badge ok" style={{ marginLeft: 'auto' }}><span className="dot" />current</span>
                )}
              </div>
              {t.tagline && <p className="th-tag">{'“'}{t.tagline}{'”'}</p>}
              {t.sigil && <div className="th-sigil">{t.sigil}</div>}
              <p className="muted" style={{ fontSize: 12.5 }}>{t.blurb}</p>
              <button
                className={`btn ${isCur ? 'ghost' : 'soft'}`}
                disabled={isCur}
                onClick={() => apply(t.name)}
              >
                {isCur ? 'Applied' : 'Apply voice'}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
