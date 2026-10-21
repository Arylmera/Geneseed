import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { accentHex } from '../../lib/accents.js'
import { Icon } from '../../components/Icon.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'

// Shown on the Dashboard when no harness is deployed yet. Walks a voice + an
// install mode, then deploys: a GLOBAL mode through the existing `build` action
// (it writes the host's own config dir), a PROJECT mode through `deploy` with the
// folder the user chose — the Installs page's route, which validates the folder.
// Build used to take project modes too, with no folder, and the generator's
// default `./Harness` landed inside the Geneseed checkout (reported 2026-10).
// The portable `files` bundle is not a host install; the CLI covers it. The
// console streams the run; when it finishes the overview reloads.
export const isProjectEmit = (emit) => Boolean(emit) && !emit.endsWith('-global')

export default function Onboarding({ onAction }) {
  const { data, error } = useAsync(() => api.themes(), [])
  // The selections are seeded from the loaded data and only diverge once the
  // user picks. Deriving them (rather than seeding via an effect) means the
  // Deploy button is enabled the instant the data renders — no flash of a
  // disabled control, and no render-timing race.
  const [pickedTheme, setPickedTheme] = useState('')
  const [pickedEmit, setPickedEmit] = useState('')
  const [folder, setFolder] = useState('')
  const [note, setNote] = useState('')
  const [browsing, setBrowsing] = useState(false) // native folder picker in flight

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const theme = pickedTheme || data.current?.theme || 'neutral'
  const emits = (data.emits || []).filter((e) => e.name !== 'files')
  const hasGlobal = data.emits?.some((e) => e.name === 'opencode-global')
  const emit =
    pickedEmit || (hasGlobal ? 'opencode-global' : data.current?.emit || emits[0]?.name || '')
  const setTheme = setPickedTheme
  const setEmit = setPickedEmit
  const project = isProjectEmit(emit)

  // The chooser runs on the daemon host: a browser cannot reveal a disk path.
  const browseFolder = async () => {
    setBrowsing(true)
    setNote('')
    try {
      const r = await api.pickFolder()
      if (r.path) setFolder(r.path)
      else if (r.error) setNote(r.error)
    } catch (e) {
      setNote(e.message)
    } finally {
      setBrowsing(false)
    }
  }

  const submit = () => {
    if (!project) return onAction('build', { theme, emit })
    const path = folder.trim()
    if (!path) return setNote('Choose or type the project folder to install into.')
    setNote('')
    // project-scope emit name == host name (opencode / claude / bob / openclaude)
    return onAction('deploy', { host: emit, path, theme })
  }

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
          A <code>-global</code> mode deploys once to that tool&apos;s global config, so every repo
          on this machine inherits the harness (recommended). A project mode installs into the
          repository folder you choose.
        </p>
        <label className="stack" style={{ gap: 6, maxWidth: 360 }}>
          <span className="tick">Mode</span>
          <select className="sel" value={emit} onChange={(e) => setEmit(e.target.value)}>
            {emits.map((em) => (
              <option key={em.name} value={em.name}>
                {em.name}
                {em.desc ? ` · ${em.desc}` : ''}
              </option>
            ))}
          </select>
        </label>
        {project && (
          <div className="row gap-10" style={{ maxWidth: 560, marginTop: 12 }}>
            <input
              className="inp"
              style={{ flex: 1 }}
              type="text"
              placeholder="/path/to/project, or click Browse…"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              aria-label="Project folder to install into"
            />
            <button className="btn ghost sm" disabled={browsing} onClick={browseFolder}>
              {browsing ? 'Choosing…' : 'Browse…'}
            </button>
          </div>
        )}
        {note && (
          <p className="sub" style={{ marginTop: 12 }}>
            {note}
          </p>
        )}
      </div>

      <button
        className="btn btn-grid"
        disabled={!theme || !emit || (project && !folder.trim())}
        onClick={submit}
      >
        <Icon name="build" />
        Deploy harness
      </button>
    </div>
  )
}
