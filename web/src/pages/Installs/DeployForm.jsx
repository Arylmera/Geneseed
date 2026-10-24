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
// the voice the deployed one. An empty folder is the form's own error, shown next to the
// field it is about; the folder picker's failures go to the page's note line (`onNote`),
// and a rejected deploy (400) to the job toast.
export default function DeployForm({ host, theme, options, onAction, onClose, onNote }) {
  const [deploy, setDeploy] = useState({
    path: '',
    host,
    theme,
    footprint: 'lean', // a new install is lean, as `--footprint` is in the CLI
    posture: 'peer',
    mode: 'direct',
    trust: 'balanced',
  })
  const [browsing, setBrowsing] = useState(false) // native folder picker in flight
  const [err, setErr] = useState('') // the folder field's own error
  const set = (k, v) => setDeploy((d) => ({ ...d, [k]: v }))

  // The native folder chooser lives on the daemon host: a browser can't reveal a disk
  // path, so the server pops a real Finder/dialog on the user's own screen.
  const browseFolder = async () => {
    setBrowsing(true)
    onNote('')
    try {
      const r = await api.pickFolder()
      if (r.path) {
        set('path', r.path)
        setErr('')
      } else if (r.error) onNote(r.error)
    } catch (e) {
      onNote(e.message)
    } finally {
      setBrowsing(false)
    }
  }

  const submitDeploy = async () => {
    const path = deploy.path.trim()
    if (!path) {
      setErr('Choose or type a folder to deploy into.')
      return
    }
    setErr('')
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
      trust: deploy.trust,
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
          onChange={(e) => {
            set('path', e.target.value)
            setErr('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && submitDeploy()}
          aria-label="Folder to deploy into"
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? 'dp-path-err' : undefined}
        />
        <button className="btn ghost sm" disabled={browsing} onClick={browseFolder}>
          {browsing ? 'Choosing…' : 'Browse…'}
        </button>
      </div>
      {err ? (
        <p id="dp-path-err" className="tag bad note" role="alert">
          {err}
        </p>
      ) : null}
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
        <PickSelects value={deploy} options={options} onChange={set} who="the new harness" />
        {/* Secondary: the panel beside the form keeps the page's one filled action. */}
        <button className="btn ghost sm" onClick={submitDeploy}>
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
