import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { HOSTS, hostInfo } from '../../lib/hosts.js'
import { PickSelects } from './controls.jsx'

// Deploy a fresh per-repo harness into a folder the user chooses — the open-ended
// sibling of a row's Install (which only targets pre-detected locations). The build
// registers the new root, so it then shows up as its own row.
//
// Mounted while open, so every opening starts from the defaults: `host` is the one the
// page reckons you already use (so a Claude shop isn't silently pushed toward OpenCode),
// the voice the deployed one. Failures go to the page's note line (`onNote`), which
// sits above the table this form opens over.
export default function DeployForm({ host, theme, options, onAction, onClose, onNote }) {
  const [deploy, setDeploy] = useState({
    path: '',
    host,
    theme,
    footprint: 'full',
    posture: 'peer',
    mode: 'direct',
  })
  const [browsing, setBrowsing] = useState(false) // native folder picker in flight
  const set = (k, v) => setDeploy((d) => ({ ...d, [k]: v }))

  // The native folder chooser lives on the daemon host: a browser can't reveal a disk
  // path, so the server pops a real Finder/dialog on the user's own screen.
  const browseFolder = async () => {
    setBrowsing(true)
    onNote('')
    try {
      const r = await api.pickFolder()
      if (r.path) set('path', r.path)
      else if (r.error) onNote(r.error)
    } catch (e) {
      onNote(e.message)
    } finally {
      setBrowsing(false)
    }
  }

  const submitDeploy = async () => {
    const path = deploy.path.trim()
    if (!path) {
      onNote('Choose or type a folder to deploy into.')
      return
    }
    onNote('')
    // Close only if the job was accepted (truthy job id). A rejected path (400 —
    // missing/unwritable folder, the editable field's main failure mode) keeps the
    // popover open with the typed path intact; the error shows as a toast.
    const jobId = await onAction?.('deploy', {
      host: deploy.host,
      path,
      theme: deploy.theme,
      footprint: deploy.footprint,
      posture: deploy.posture,
      mode: deploy.mode,
    })
    if (jobId) onClose()
  }

  return (
    <div className="deploy-pop">
      <div className="dp-row">
        <input
          className="inp dp-path"
          type="text"
          placeholder="/path/to/project, or click Browse…"
          value={deploy.path}
          onChange={(e) => set('path', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitDeploy()}
          aria-label="Folder to deploy into"
        />
        <button className="btn ghost sm" disabled={browsing} onClick={browseFolder}>
          {browsing ? 'Choosing…' : 'Browse…'}
        </button>
      </div>
      <div className="dp-row">
        <label className="dp-field">
          <span>Deploy as</span>
          <select
            className="sel"
            aria-label="host for the new harness"
            value={deploy.host}
            onChange={(e) => set('host', e.target.value)}
          >
            {HOSTS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <PickSelects
          layout="form"
          value={deploy}
          options={options}
          onChange={set}
          who="the new harness"
        />
        <button className="btn sm" onClick={submitDeploy}>
          Deploy
        </button>
        <button className="btn ghost sm" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="sub dp-note">
        Adds a per-repo harness (<code>{hostInfo(deploy.host).deployAdds}</code>) into the folder,
        non-destructively. It’s then tracked here even after you leave its directory.
      </p>
    </div>
  )
}
