import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { accentHex } from '../../lib/accents.js'
import { Icon } from '../../components/Icon.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'

// Shown on the Dashboard when no harness is deployed yet. Walks a voice + an
// install mode, then deploys via the existing `build` action (emit
// opencode-global writes to the global config dir) — the same path the CLI
// setup wizard uses, so there is no parallel install logic. The console streams
// the run; when it finishes the overview reloads and the real dashboard appears.
export default function Onboarding({ onAction }) {
  const { data, error } = useAsync(() => api.themes(), [])
  // The selections are seeded from the loaded data and only diverge once the
  // user picks. Deriving them (rather than seeding via an effect) means the
  // Deploy button is enabled the instant the data renders — no flash of a
  // disabled control, and no render-timing race.
  const [pickedTheme, setPickedTheme] = useState('')
  const [pickedEmit, setPickedEmit] = useState('')

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const theme = pickedTheme || data.current?.theme || 'neutral'
  const hasGlobal = data.emits?.some((e) => e.name === 'opencode-global')
  const emit =
    pickedEmit ||
    (hasGlobal ? 'opencode-global' : data.current?.emit || data.emits?.[0]?.name || '')
  const setTheme = setPickedTheme
  const setEmit = setPickedEmit

  return (
    <div className="narrow-lg">
      <div className="head-row mb-18">
        <div>
          <h1 className="h">Deploy your harness</h1>
          <p className="sub">
            Geneseed isn&apos;t implanted on this machine yet. Pick a voice and an install mode,
            then deploy. The graft runs in the console below, and this dashboard lights up when it
            lands.
          </p>
        </div>
      </div>

      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>1 · Choose a voice</h3>
        </div>
        <div className="row wrap gap-10">
          {data.themes.map((t) => (
            <button
              key={t.name}
              className={`btn ${t.name === theme ? 'soft' : 'ghost'}`}
              onClick={() => setTheme(t.name)}
              title={t.blurb || t.tagline || t.name}
            >
              <span
                className="po"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: accentHex(t.accent),
                  boxShadow: `0 0 8px ${accentHex(t.accent)}`,
                }}
              />
              <span style={{ textTransform: 'capitalize' }}>{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>2 · Install mode</h3>
        </div>
        <p className="sub mb-16">
          <code>opencode-global</code> deploys once to your global config so every repo on this
          machine inherits the harness (recommended). Other modes render into a chosen directory.
        </p>
        <label className="stack" style={{ gap: 6, maxWidth: 360 }}>
          <span className="tick">Mode</span>
          <select className="sel" value={emit} onChange={(e) => setEmit(e.target.value)}>
            {data.emits.map((em) => (
              <option key={em.name} value={em.name}>
                {em.name}
                {em.desc ? ` · ${em.desc}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        className="btn"
        disabled={!theme || !emit}
        onClick={() => onAction('build', { theme, emit })}
      >
        <Icon name="build" />
        Deploy harness
      </button>
    </div>
  )
}
