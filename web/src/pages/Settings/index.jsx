import React, { useEffect, useState } from 'react'
import { api } from '../../api/index.js'
import { Icon } from '../../components/Icon.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import McpServers from './McpServers.jsx'
import ServerControl from './ServerControl.jsx'

// The settings page: the install snapshot, the build/update picker, the MCP
// wiring panel (its own component), and the offline-package download.
export default function Settings({ onAction }) {
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
          <span className="eyebrow">configure</span>
          <h1 className="h">Settings</h1>
          <p className="sub">
            The deployed install at a glance, plus the same actions as the TUI — build, update, MCP
            wiring, and an offline package.
          </p>
        </div>
      </div>

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

      {/* MCP servers card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>MCP servers</h3>
        </div>
        <p className="sub mb-16">
          Wire MCP servers into OpenCode — per project or globally. Toggles rewrite only the{' '}
          <code>mcp</code> block.
        </p>
        <McpServers />
      </div>

      {/* Offline package card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Offline package</h3>
        </div>
        <p className="sub mb-16">
          For air-gapped machines: download a zip of this source tree, carry it over, then{' '}
          <code>geneseed upgrade --zip &lt;file&gt;</code> — same validation, no network.
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
