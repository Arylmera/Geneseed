import React, { useEffect, useState } from 'react'
import { api } from '../../api/index.js'
import { Icon } from '../../components/Icon.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { FLAVOURS } from '../../hooks/useFlavour.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Installs from './Installs.jsx'
import McpServers from './McpServers.jsx'
import ServerControl from './ServerControl.jsx'

// The settings page: the console direction picker, the install snapshot, the
// build/update picker, the MCP wiring panel (its own component), and the
// offline-package download.
export default function Settings({ onAction, flavour, onFlavour }) {
  const { data: setup, error } = useAsync(() => api.setup(), [])
  const [choices, setChoices] = useState(null) // { themes, emits, current }
  const [theme, setTheme] = useState('')
  const [emit, setEmit] = useState('')

  // Themes seed the build picker's defaults, so this load keeps its own effect.
  useEffect(() => {
    api
      .themes()
      .then((t) => {
        setChoices(t)
        setTheme(t.current.theme)
        setEmit(t.current.emit)
      })
      .catch(() => {})
  }, [])

  if (error) return <ErrorState error={error} />
  if (!setup) return <Loading />

  const upToDate = (setup.version_verdict || '').includes('up to date')

  return (
    <div className="narrow-lg">
      <div className="head-row mb-18">
        <div>
          <h1 className="h">Settings</h1>
          <p className="sub">
            The deployed install at a glance, plus the same actions as the TUI: build, update, MCP
            wiring, and an offline package.
          </p>
        </div>
      </div>

      {/* Console direction card — picks the visual flavour of the console.
          Persisted to localStorage; the change is live (no rebuild needed). */}
      {flavour && onFlavour && (
        <div className="card pad-lg mb-16">
          <div className="card-head">
            <h3>Console direction</h3>
          </div>
          <p className="sub mb-16">
            Three takes on the same data. Pick a direction — it applies instantly and persists
            across reloads.
          </p>
          <div className="dir-grid">
            {FLAVOURS.map((f) => (
              <button
                key={f.id}
                className={`dir-tile dir-${f.id} ${flavour === f.id ? 'on' : ''}`}
                onClick={() => onFlavour(f.id)}
                aria-pressed={flavour === f.id}
              >
                <span className="dir-thumb" aria-hidden="true">
                  <span className="dir-thumb-rail" />
                  <span className="dir-thumb-bar" />
                  <span className="dir-thumb-bar" style={{ width: '70%' }} />
                  <span className="dir-thumb-bar" style={{ width: '52%' }} />
                  <span className="dir-thumb-dot" />
                </span>
                <span className="dir-meta">
                  <span className="dir-name">
                    {f.short}
                    {flavour === f.id && <span className="dir-check">● active</span>}
                  </span>
                  <span className="dir-tag">{f.tagline}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Installation card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Installation</h3>
        </div>
        {/* These JSX values are tuple data, not list items — each rendered row
            is keyed by `k` in the .map below, so the inner elements need no key. */}
        {/* eslint-disable react/jsx-key */}
        {[
          [
            'Deployed',
            <span className={`badge ${setup.deployed ? 'ok' : 'warn'}`}>
              {setup.deployed ? 'yes' : 'no'}
            </span>,
          ],
          ['Target', <code>{setup.target}</code>],
          ['Install mode', setup.emit],
          ['Theme', <span style={{ textTransform: 'capitalize' }}>{setup.theme}</span>],
          [
            'Version',
            <span className={`badge ${upToDate ? 'ok' : 'warn'}`}>{setup.version_verdict}</span>,
          ],
          ['Installed build', <span className="mono">{setup.installed_fp || '(none)'}</span>],
          ['Source build', <span className="mono">{setup.source_fp}</span>],
          ['Source root', setup.root],
          [
            'Memory store',
            <span>
              {setup.memory_dir || '(not found)'} · {setup.facts} fact{setup.facts === 1 ? '' : 's'}
            </span>,
          ],
          ['Python', setup.python],
        ].map(([k, v]) => (
          <div className="kv" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
        {/* eslint-enable react/jsx-key */}
      </div>

      {/* Build & update card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Build &amp; update</h3>
        </div>
        <p className="sub mb-16">
          Rebuild the deployed harness in a chosen voice and mode, or pull the latest Geneseed and
          re-render. Either runs live in the terminal.
        </p>
        {choices && (
          <div className="row wrap gap-16" style={{ alignItems: 'flex-end' }}>
            <label className="stack" style={{ gap: 6 }}>
              <span className="tick">Voice</span>
              <select className="sel" value={theme} onChange={(e) => setTheme(e.target.value)}>
                {choices.themes.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 6 }}>
              <span className="tick">Mode</span>
              <select className="sel" value={emit} onChange={(e) => setEmit(e.target.value)}>
                {choices.emits.map((em) => (
                  <option key={em.name} value={em.name}>
                    {em.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn ghost" onClick={() => onAction('build', { theme, emit })}>
              <Icon name="build" />
              Build
            </button>
            <button className="btn" onClick={() => onAction('update')}>
              <Icon name="refresh" />
              Update
            </button>
          </div>
        )}
      </div>

      {/* Harness installs card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Harness installs</h3>
        </div>
        <p className="sub mb-16">
          Turn a whole OpenCode install off without deleting it. Deactivating moves the rules and
          owned artifacts aside; reactivating restores the exact bytes.
        </p>
        <Installs />
      </div>

      {/* MCP servers card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>MCP servers</h3>
        </div>
        <p className="sub mb-16">
          Wire MCP servers into OpenCode, per project or globally. Toggles rewrite only the{' '}
          <code>mcp</code> block.
        </p>
        <McpServers />
      </div>

      {/* Maintenance card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Maintenance</h3>
        </div>
        <p className="sub mb-16">
          Put <code>geneseed</code> on your PATH so it runs from any directory, or remove a global
          install. Your memory store is always kept. Each runs live in the console.
        </p>
        <div className="row wrap gap-10">
          <button className="btn ghost" onClick={() => onAction('link')}>
            <Icon name="external" />
            Add to PATH
          </button>
          <button className="btn ghost" onClick={() => onAction('unlink')}>
            Remove from PATH
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              if (
                window.confirm(
                  'Uninstall the global Geneseed harness? Your memory store is kept; everything else this install added is removed.',
                )
              )
                onAction('uninstall')
            }}
          >
            <Icon name="clear" />
            Uninstall
          </button>
        </div>
      </div>

      {/* Offline package card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Offline package</h3>
        </div>
        <p className="sub mb-16">
          For air-gapped machines: download a zip of this source tree, carry it over, then{' '}
          <code>geneseed upgrade --zip &lt;file&gt;</code>. Same validation, no network.
        </p>
        <a className="btn ghost" href="/api/offline-zip" download>
          <Icon name="download" />
          Download offline package
        </a>
      </div>

      {/* Server card */}
      <div className="card pad-lg">
        <div className="card-head">
          <h3>Server</h3>
        </div>
        <p className="sub mb-16">
          The console runs a small local server. Leave it running in the background and reopen any
          time, or stop it when you are done.
        </p>
        <ServerControl />
      </div>
    </div>
  )
}
