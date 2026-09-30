import React, { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon.jsx'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import { useConfirm } from '../../hooks/useConfirm.jsx'
import { FOOTPRINT_OPTIONS } from './controls.jsx'
import DeployForm from './DeployForm.jsx'
import InstallPanel from './InstallPanel.jsx'

// Join key for the MCP-target -> install pairing: an install owns the targets the API tags
// with its (host, root). Keying on the install identity (not the config's dirname) is what
// lets a Claude global target, whose ~/.claude.json sits OUTSIDE its ~/.claude root, still
// attach to the right install.
const installKey = (host, root) => `${host} ${root}`

// The voice REFERENCE: what each voice sounds like, and nothing you can act on. A <select>
// of fourteen bare names cannot tell you that; the panel's Voice picker is where you
// choose. A <details>: disclosure, keyboard operable, closed by default.
function VoiceGallery({ themes, current }) {
  if (!themes.length || !current) return null
  const rows = [...themes].sort((a, b) => (a.name === current ? -1 : b.name === current ? 1 : 0))
  return (
    <details className="panel voice-ref">
      <summary>
        <span className="vr-title">Voices</span>
        <span className="mono dim">{themes.length} to choose from, set per install</span>
      </summary>
      <div className="vr-list">
        {rows.map((t) => (
          <div className={`voice-row${t.name === current ? ' current' : ''}`} key={t.name}>
            <span className="vr-name">{t.name}</span>
            <span className="vr-desc">{t.tagline ? `“${t.tagline}”` : t.blurb}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

// The checkout this console runs from, and whether the install it views is built from it.
function Checkout({ setup, overview }) {
  if (!setup) return null
  const synced = setup.installed_fp && setup.installed_fp === setup.source_fp
  return (
    <section className="panel" aria-labelledby="checkout-h">
      <div className="panel-head">
        <h2 id="checkout-h">This checkout</h2>
        <span className={`mono ${synced ? 't-good' : 't-warn'}`}>{setup.version_verdict}</span>
      </div>
      <dl className="kv-grid">
        <dt>Source</dt>
        <dd className="mono">{setup.root}</dd>
        <dt>Version</dt>
        <dd className="mono">{overview?.version || 'unknown'}</dd>
        <dt>Fingerprint</dt>
        <dd className="mono">{setup.source_fp}</dd>
      </dl>
    </section>
  )
}

// Installs / Hosts: every install on this machine (host × scope) as a table, and the one
// you pick in a side panel with its build choices, MCP wiring and removal. Every mutation
// refetches through dataRev / onMutated; nothing reloads the page.
export default function Hosts({
  onAction,
  themes = [],
  currentTheme,
  overview,
  setup,
  dataRev,
  onMutated,
}) {
  const confirm = useConfirm()
  const { data: instData, error: instErr } = useAsync(() => api.installs(), [dataRev])
  const { data: mcpData, error: mcpErr } = useAsync(() => api.mcp(), [dataRev])
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('') // install toggle in flight
  const [mcpBusy, setMcpBusy] = useState('') // mcp server toggle in flight
  // Each install's build choices, keyed by id: { theme, footprint, posture, mode }, each
  // key present only once the user has picked it (choiceFor fills the rest).
  const [picks, setPicks] = useState({})
  const [deploying, setDeploying] = useState(false)
  const [removing, setRemoving] = useState(null) // null | { id, host, path, memory }
  const [picked, setPicked] = useState('') // the install shown in the panel

  const mcpByInstall = useMemo(() => {
    const m = {}
    for (const t of mcpData?.targets || []) {
      const k = installKey(t.host || 'opencode', t.root)
      ;(m[k] || (m[k] = [])).push(t)
    }
    return m
  }, [mcpData])

  if (instErr || mcpErr) return <ErrorState error={instErr || mcpErr} />
  if (!instData || !mcpData) return <Loading />

  // Globals first, then the per-repo installs; within each, active before the rest.
  const rank = { active: 0, disabled: 1, absent: 2 }
  const installs = [...instData.installs].sort(
    (a, b) =>
      (a.scope === 'global' ? 0 : 1) - (b.scope === 'global' ? 0 : 1) ||
      (rank[a.state] ?? 3) - (rank[b.state] ?? 3),
  )
  const current =
    installs.find((i) => i.id === picked) ||
    installs.find((i) => i.selected) ||
    installs.find((i) => i.state === 'active') ||
    installs[0]

  // What an install acts on, per choice: the explicit pick, else its own (active), else
  // the default, and for the voice the currently deployed one, so a new install matches.
  const choiceFor = (inst) => {
    const p = picks[inst.id] || {}
    return {
      theme: p.theme || inst.theme || currentTheme || 'neutral',
      footprint: p.footprint || inst.footprint || 'full',
      posture: p.posture || inst.posture || 'peer',
      mode: p.mode || inst.mode || 'direct',
    }
  }
  const setPick = (inst, key, v) =>
    setPicks((p) => ({ ...p, [inst.id]: { ...p[inst.id], [key]: v } }))
  const unchanged = (inst) => {
    const c = choiceFor(inst)
    return (
      c.theme === inst.theme &&
      c.footprint === (inst.footprint || 'full') &&
      c.posture === (inst.posture || 'peer') &&
      c.mode === (inst.mode || 'direct')
    )
  }
  const options = {
    theme: themes.map((t) => t.name),
    footprint: FOOTPRINT_OPTIONS,
    posture: instData.postures || [],
    mode: instData.modes || [],
  }

  // Install a not-installed location, or rebuild an active one with its picks. Both go
  // through the 'install' action (a non-destructive in-place emit), streamed to the console.
  const applyVoice = async (inst) => {
    const { theme, footprint, posture, mode } = choiceFor(inst)
    const msg =
      inst.state === 'absent'
        ? `Install Geneseed into ${inst.path} with the “${theme}” voice (${footprint} footprint, ${posture} posture, ${mode} mode)? ` +
          `Files are added non-destructively (your own config is left untouched); deactivate or uninstall later.`
        : `Rebuild this install (voice “${theme}”, ${footprint} footprint, ${posture} posture, ${mode} mode)? It rebuilds in place, non-destructive.`
    const ok = await confirm(msg, {
      title: inst.state === 'absent' ? 'Install Geneseed?' : 'Rebuild this install?',
      confirmLabel: inst.state === 'absent' ? 'Install' : 'Rebuild',
    })
    if (ok)
      onAction?.('install', {
        host: inst.host,
        scope: inst.scope,
        path: inst.path,
        theme,
        footprint,
        posture,
        mode,
      })
  }

  const toggleInstall = async (inst) => {
    if (
      inst.state === 'active' &&
      !(await confirm(
        'Deactivate this install? Files are moved aside, not deleted; reactivate any time.',
        { title: 'Deactivate this install?', confirmLabel: 'Deactivate' },
      ))
    )
      return
    setBusyKey(inst.id)
    setNote('')
    try {
      const res = await api.installToggle(
        inst.host,
        inst.path,
        inst.state === 'active' ? 'deactivate' : 'activate',
      )
      if (!res.ok) {
        const failed = Array.isArray(res.failed) ? res.failed.join(', ') : ''
        setNote(res.error || (failed && `unrestored: ${failed}`) || 'action failed')
        return
      }
      onMutated?.()
    } catch (e) {
      setNote(e.message)
    } finally {
      setBusyKey('')
    }
  }

  // Permanently delete an install. Destructive and irreversible: the inline question and
  // its memory disposition are the only guards.
  const confirmRemove = async () => {
    const r = removing
    if (!r) return
    setBusyKey(r.id)
    setNote('')
    try {
      const res = await api.installRemove(r.host, r.path, r.memory)
      if (!res.ok) {
        setNote(res.error || 'remove failed')
        return
      }
      setRemoving(null)
      onMutated?.()
    } catch (e) {
      setNote(e.message)
    } finally {
      setBusyKey('')
    }
  }

  // A preset lands with its token and API URL deliberately blank; this opens the FOLDER
  // holding the config on the machine running the daemon, so they can be filled in. `ok`
  // means the request went out, not that a window appeared, so the note names the folder.
  const revealMcp = async (target) => {
    setNote('')
    try {
      const r = await api.mcpReveal(target.path)
      setNote(`Opening ${r.dir}. If no window appeared, open that folder by hand.`)
    } catch (e) {
      setNote(e.message)
    }
  }

  const toggleMcp = async (target, s) => {
    const key = target.path + s.name
    setMcpBusy(key)
    setNote('')
    try {
      await api.mcpToggle(target.path, s.name, s.state !== 'enabled')
      onMutated?.()
    } catch (e) {
      setNote(e.message)
    } finally {
      setMcpBusy('')
    }
  }

  // The deploy form's default host: the one you already use.
  const defaultHost =
    installs.find((i) => i.selected)?.host ||
    installs.find((i) => i.state === 'active')?.host ||
    installs[0]?.host ||
    'opencode'
  const STATE = { active: ['Active', 'ok'], disabled: ['Disabled', 'warn'] }

  return (
    <div className="hosts">
      <div className="hosts-main">
        <div className="toolbar">
          <span className="dim">
            {installs.filter((i) => i.state === 'active').length} active of {installs.length}{' '}
            detected. Inside a folder with its own harness, only that folder’s harness loads.
          </span>
          {onAction ? (
            <div className="row gap-8">
              <button type="button" className="btn ghost" onClick={() => setDeploying((d) => !d)}>
                <Icon name="folder" /> Deploy to a repo…
              </button>
              <button type="button" className="btn ghost" onClick={() => onAction('build-all')}>
                <Icon name="refresh" /> Rebuild all
              </button>
            </div>
          ) : null}
        </div>
        {deploying ? (
          <div className="panel">
            <DeployForm
              host={defaultHost}
              theme={currentTheme || 'neutral'}
              options={options}
              onAction={onAction}
              onClose={() => setDeploying(false)}
              onNote={setNote}
            />
          </div>
        ) : null}
        {note ? (
          <p className="tag bad note" role="status">
            {note}
          </p>
        ) : null}
        <section className="panel flush" aria-label="Installs">
          <div className="tbl-scroll">
            <table className="tbl hosts-tbl">
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Path</th>
                  <th>Voice</th>
                  <th>Footprint</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {installs.map((inst) => {
                  const [label, tone] = STATE[inst.state] || ['Not installed', '']
                  const on = current?.id === inst.id
                  const quiet = inst.state === 'absent'
                  return (
                    <tr key={inst.id} className={`${on ? 'on' : ''}${quiet ? ' quiet' : ''}`}>
                      <td>
                        <button
                          type="button"
                          className="row-pick"
                          aria-pressed={on}
                          onClick={() => {
                            setPicked(inst.id)
                            setRemoving(null)
                          }}
                        >
                          {inst.host} · {inst.scope}
                        </button>
                      </td>
                      <td className="mono path-cell" title={inst.path}>
                        {inst.path}
                      </td>
                      <td>{quiet ? '' : inst.theme || ''}</td>
                      <td>{quiet ? '' : inst.footprint || ''}</td>
                      <td>
                        <span className={`tag ${tone}`}>{label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
        <Checkout setup={setup} overview={overview} />
        <VoiceGallery themes={themes} current={overview?.theme} />
      </div>
      {current ? (
        <InstallPanel
          key={current.id}
          inst={current}
          targets={mcpByInstall[installKey(current.host, current.path)] || []}
          choice={choiceFor(current)}
          unchanged={unchanged(current)}
          options={options}
          onPick={(key, v) => setPick(current, key, v)}
          canAct={!!onAction}
          busy={busyKey === current.id}
          mcpBusy={mcpBusy}
          removing={removing?.id === current.id ? removing : null}
          onRemoving={(r) =>
            setRemoving(
              r && { id: current.id, host: current.host, path: current.path, memory: r.memory },
            )
          }
          onApply={() => applyVoice(current)}
          onToggleInstall={() => toggleInstall(current)}
          onRemove={confirmRemove}
          onRevealMcp={revealMcp}
          onToggleMcp={toggleMcp}
        />
      ) : null}
    </div>
  )
}
