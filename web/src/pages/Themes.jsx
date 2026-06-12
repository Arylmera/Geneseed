import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { accentHex } from '../accents.js'

export default function Themes({ onAction }) {
  const [data, setData] = useState(null) // { themes, emits, current }
  const [err, setErr] = useState('')

  useEffect(() => { api.themes().then(setData).catch((e) => setErr(e.message)) }, [])

  if (err) return <div className="container"><p className="badge warn">{err}</p></div>
  if (!data) return <div className="container">Loading…</div>

  const apply = (name) => {
    if (!window.confirm(
      `Rebuild the deployed harness with the "${name}" voice?\nThe rebuild runs in the console.`)) return
    onAction('build', { theme: name, emit: data.current.emit })
  }

  return (
    <div className="container">
      <h2>Themes</h2>
      <p className="muted">
        Every theme ships the same harness in a different voice. Applying one
        rebuilds the deployed install ({data.current.emit}) — content and behaviour
        stay identical, and the UI takes on its colour.
      </p>
      <div className="cards theme-cards">
        {data.themes.map((t) => {
          const current = t.name === data.current.theme
          return (
            <div
              className={`card no-hover theme-card ${current ? 'theme-current' : ''}`}
              style={{ '--card-accent': accentHex(t.accent) }}
              key={t.name}
            >
              <div className="theme-head">
                <span className="theme-orb" />
                <h3>{t.name}</h3>
                {current && <span className="badge ok">current</span>}
              </div>
              {t.tagline && <p className="theme-tagline">“{t.tagline}”</p>}
              <p className="muted theme-blurb">{t.blurb}</p>
              {t.sigil && <p className="theme-sigil">{t.sigil}</p>}
              <button
                className={`btn sm ${current ? 'ghost' : ''}`}
                onClick={() => apply(t.name)}
                disabled={current}
              >
                {current ? 'Applied' : 'Apply'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
