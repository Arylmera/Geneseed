import React from 'react'
import { Icon } from '../components/Icon.jsx'
import Installs from './Settings/Installs.jsx'
import McpServers from './Settings/McpServers.jsx'

// The harness orchestration page: every detected install (host × scope) in one place
// — OpenCode and Claude Code, global and per-repo — each independently activated or
// deactivated. "Rebuild all" re-emits every ACTIVE install in its own theme + emit as
// a single background job (the per-install resolution lives in the rebuild-all
// subcommand, so the UI threads no theme/emit). MCP servers live here too because the
// wiring is install-scoped config (OpenCode only — Claude MCP isn't managed by Geneseed).
export default function Harnesses({ onAction, themes, currentTheme, dataRev, onMutated }) {
  return (
    <>
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Harnesses</h3>
          <button className="btn" onClick={() => onAction('build-all')}>
            <Icon name="refresh" /> Rebuild all
          </button>
        </div>
        <p className="sub mb-16">
          Every Geneseed install on this machine — OpenCode and Claude Code, global and per-repo.
          Toggle one off without deleting it (files move aside, reactivate any time).{' '}
          <strong>Rebuild all</strong> re-emits every active install in its own theme and mode, as
          one background job.
        </p>
        <Installs
          onAction={onAction}
          themes={themes}
          currentTheme={currentTheme}
          dataRev={dataRev}
          onMutated={onMutated}
        />
      </div>

      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>MCP servers</h3>
        </div>
        <p className="sub mb-16">
          Wire MCP servers into an OpenCode install, per project or globally — shown only for active
          OpenCode harnesses (Claude MCP isn’t managed here). Toggles rewrite only the{' '}
          <code>mcp</code> block.
        </p>
        <McpServers dataRev={dataRev} onMutated={onMutated} />
      </div>
    </>
  )
}
