import React, { useMemo, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// The harness orchestration page as one table: every detected install (host × scope) is
// a row — OpenCode and Claude, global and per-repo — independently activated, re-themed,
// or deactivated. The MCP servers wired into an install live INSIDE its row: an active
// install with MCP wiring expands to a detail panel listing its servers (OpenCode under
// opencode.json's `mcp`, Claude under .mcp.json / ~/.claude.json's `mcpServers`).
// "Rebuild all" re-emits every active install in its own voice + mode as one background
// job. Mutations refetch via dataRev / onMutated — no full reload, nothing flashes.

// A voice <select> in the app's `.sel` style. Renders nothing until the theme list loads.
function VoiceSelect({ label, value, themes, onChange }) {
  if (!themes.length) return null
  return (
    <select
      className="sel"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {themes.map((t) => (
        <option key={t.name} value={t.name}>
          {t.name}
        </option>
      ))}
    </select>
  )
}

// An on/off switch — deactivates a whole install (files moved aside, not deleted) or
// reactivates it; also drives individual MCP servers. The on-disk stash is the truth.
function Switch({ on, disabled, label, onToggle }) {
  const keyToggle = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ') e.preventDefault()
      onToggle()
    }
  }
  return (
    <div
      className={`sw-toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onToggle}
      onKeyDown={disabled ? undefined : keyToggle}
    />
  )
}

// Join key for the MCP-target → install pairing: an install owns the targets the API
// tags with its (host, root). Keying on the install identity (not the config's dirname)
// is what lets a Claude global target — whose ~/.claude.json sits OUTSIDE its ~/.claude
// root — still attach to the right row.
const installKey = (host, root) => `${host} ${root}`

// A short, honest description of what `remove` deletes, by host × scope — shown in the
// confirm. A project install is the deployed bundle; a global is the config-dir layer.
const removeLayer = (host, scope) => {
  if (scope === 'project') {
    return host === 'claude'
      ? '.claude/ + the CLAUDE.md block'
      : host === 'bob'
        ? '.bob/ + the AGENTS.md block'
        : '.opencode/ + AGENT.md + the bundle'
  }
  return host === 'claude'
    ? "~/.claude's agents/skills + the CLAUDE.md block + settings hooks"
    : host === 'bob'
      ? "~/.bob's agents/skills + the AGENTS.md block + settings hooks"
      : "~/.config/opencode's AGENT.md, agents, skills, plugins + the opencode.json entry"
}

export default function Harnesses({ onAction, themes = [], currentTheme, dataRev, onMutated }) {
  const { data: instData, error: instErr } = useAsync(() => api.installs(), [dataRev]) // { installs }
  const { data: mcpData, error: mcpErr } = useAsync(() => api.mcp(), [dataRev]) // { targets }
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('') // install toggle in flight
  const [mcpBusy, setMcpBusy] = useState('') // mcp server toggle in flight
  const [pick, setPick] = useState({}) // chosen voice, keyed by row id
  const [collapsed, setCollapsed] = useState({}) // explicit collapses; MCP rows open by default
  const [deploy, setDeploy] = useState(null) // null = closed; { path, host, theme } = the deploy form
  const [browsing, setBrowsing] = useState(false) // native folder picker in flight
  const [removing, setRemoving] = useState(null) // null = closed; { id, host, path, memory } = remove-confirm

  // Group MCP targets by their owning install (host, root). api_mcp only returns targets
  // for active installs, so every group has a matching harness row to nest beneath.
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

  const installs = instData.installs
  const activeCount = installs.filter((i) => i.state === 'active').length

  // Two sections: machine-wide globals first, then the per-repo (folder) installs. Same
  // columns and row renderer (renderInstall) — only the grouping differs.
  const sections = [
    {
      key: 'global',
      title: 'Global',
      sub: 'machine-wide',
      rows: installs.filter((i) => i.scope === 'global'),
      empty: 'No global installs detected.',
    },
    {
      key: 'project',
      title: 'Per-project',
      sub: 'one folder each',
      rows: installs.filter((i) => i.scope !== 'global'),
      empty: 'No per-project installs yet — use “Deploy to folder…”.',
    },
  ]

  // The voice a row acts on: the explicit pick, else the install's own theme (active
  // rows), else the current deployed voice — so a new install matches your existing one.
  const voiceFor = (inst) => pick[inst.id] || inst.theme || currentTheme || 'neutral'
  const setVoice = (inst, v) => setPick((p) => ({ ...p, [inst.id]: v }))

  // Install a not-installed location, or re-theme an active one — both rebuild via the
  // 'install' action (a non-destructive in-place re-emit), streamed to the console.
  const applyVoice = (inst) => {
    const theme = voiceFor(inst)
    const msg =
      inst.state === 'absent'
        ? `Install Geneseed into ${inst.path} with the “${theme}” voice? Files are added ` +
          `non-destructively (your own config is left untouched); deactivate or uninstall later.`
        : `Re-theme this install to the “${theme}” voice? It rebuilds in place — non-destructive.`
    if (window.confirm(msg))
      onAction?.('install', { host: inst.host, scope: inst.scope, path: inst.path, theme })
  }

  const toggleInstall = async (inst) => {
    if (
      inst.state === 'active' &&
      !window.confirm(
        'Deactivate this install? Files are moved aside, not deleted — reactivate any time.',
      )
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
      onMutated?.() // refetch installs + MCP (the active set drives MCP targets) — no full reload
    } catch (e) {
      setNote(e.message)
    } finally {
      setBusyKey('')
    }
  }

  // Permanently delete a folder install (the trash icon's confirm sub-row). Destructive
  // and irreversible — the on-disk confirm + the memory disposition are the only guards.
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
      onMutated?.() // refetch installs + MCP — the removed row drops out
    } catch (e) {
      setNote(e.message)
    } finally {
      setBusyKey('')
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

  const toggleOpen = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  // Deploy a fresh per-repo harness into a folder the user chooses — the open-ended
  // sibling of a row's Install (which only targets pre-detected locations). The build
  // registers the new root, so it then shows up as its own row. Default the host to the
  // one you already use (selected view → any active install → first row) so a Claude
  // shop isn't silently pushed toward OpenCode.
  const defaultHost = () =>
    installs.find((i) => i.selected)?.host ||
    installs.find((i) => i.state === 'active')?.host ||
    installs[0]?.host ||
    'opencode'
  const openDeploy = () =>
    setDeploy({ path: '', host: defaultHost(), theme: currentTheme || 'neutral' })

  // The native folder chooser lives on the daemon host: a browser can't reveal a disk
  // path, so the server pops a real Finder/dialog on the user's own screen.
  const browseFolder = async () => {
    setBrowsing(true)
    setNote('')
    try {
      const r = await api.pickFolder()
      // Guard d: the user may have cancelled the popover during the (blocking) native
      // dialog — don't resurrect a closed form with an undefined host/theme.
      if (r.path) setDeploy((d) => (d ? { ...d, path: r.path } : d))
      else if (r.error) setNote(r.error)
    } catch (e) {
      setNote(e.message)
    } finally {
      setBrowsing(false)
    }
  }

  const submitDeploy = async () => {
    const path = (deploy?.path || '').trim()
    if (!path) {
      setNote('Choose or type a folder to deploy into.')
      return
    }
    setNote('')
    // Close only if the job was accepted (truthy job id). A rejected path (400 —
    // missing/unwritable folder, the editable field's main failure mode) keeps the
    // popover open with the typed path intact; the error shows as a toast.
    const jobId = await onAction?.('deploy', { host: deploy.host, path, theme: deploy.theme })
    if (jobId) setDeploy(null)
  }

  return (
    <div className="card pad-lg mb-16">
      <div className="card-head">
        <h3>Harnesses</h3>
        <div className="right">
          <span className="tick">
            {activeCount} active · {installs.length} total
          </span>
          {onAction ? (
            <button className="btn" onClick={() => (deploy ? setDeploy(null) : openDeploy())}>
              <Icon name="folder" /> Deploy to folder…
            </button>
          ) : null}
          <button className="btn" onClick={() => onAction('build-all')}>
            <Icon name="refresh" /> Rebuild all
          </button>
        </div>
      </div>

      {deploy ? (
        <div className="deploy-pop">
          <div className="dp-row">
            <input
              className="inp dp-path"
              type="text"
              placeholder="/path/to/project — or click Browse…"
              value={deploy.path}
              onChange={(e) => setDeploy((d) => ({ ...d, path: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submitDeploy()}
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
                onChange={(e) => setDeploy((d) => ({ ...d, host: e.target.value }))}
              >
                <option value="opencode">OpenCode</option>
                <option value="claude">Claude Code</option>
                <option value="bob">BOB (IBM)</option>
              </select>
            </label>
            <label className="dp-field">
              <span>Voice</span>
              <VoiceSelect
                label="voice for the new harness"
                value={deploy.theme}
                themes={themes}
                onChange={(v) => setDeploy((d) => ({ ...d, theme: v }))}
              />
            </label>
            <button className="btn sm" onClick={submitDeploy}>
              Deploy
            </button>
            <button className="btn ghost sm" onClick={() => setDeploy(null)}>
              Cancel
            </button>
          </div>
          <p className="sub dp-note">
            Adds a per-repo harness (
            <code>
              {deploy.host === 'claude'
                ? '.claude/ + CLAUDE.md'
                : deploy.host === 'bob'
                  ? '.bob/ + AGENTS.md'
                  : '.opencode/ + AGENT.md'}
            </code>
            ) into the folder, non-destructively. It’s then tracked here even after you leave its directory.
          </p>
        </div>
      ) : null}
      <p className="sub mb-16">
        Every Geneseed install on this machine — OpenCode and Claude Code, global and per-repo.
        Toggle one off without deleting it (files move aside, reactivate any time). Active rows
        expand to wire their MCP servers. <strong>Rebuild all</strong> re-emits every active install
        in its own voice and mode, as one background job.
      </p>
      <p className="sub mb-16">
        <strong>Per-folder now overrides global.</strong> Inside a folder that has its own
        harness, the <em>same host’s</em> global harness steps aside — only the folder’s harness
        loads there (the global one still applies everywhere else). Set{' '}
        <code>GENESEED_STACK_GLOBAL=1</code> to load both. Existing installs pick this up on their
        next rebuild.
      </p>

      {note ? <p className="badge bad mb-16">{note}</p> : null}

      <div className="tbl-scroll">
        <table className="tbl harness-tbl">
          <thead>
            <tr>
              <th aria-label="expand" />
              <th>Harness</th>
              <th>Voice</th>
              <th>MCP</th>
              <th>Status</th>
              <th className="th-acts" />
            </tr>
          </thead>
          {sections.map((sec) => (
            <tbody key={sec.key}>
              <tr className="h-group">
                <td colSpan={6}>
                  {sec.title}
                  <span className="hg-sub"> · {sec.sub}</span>
                </td>
              </tr>
              {sec.rows.length ? (
                sec.rows.map(renderInstall)
              ) : (
                <tr className="h-empty-row">
                  <td colSpan={6} className="h-empty">
                    {sec.empty}
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  )

  // One install row + its (conditional) remove-confirm and MCP-detail sub-rows. A function
  // declaration so it hoists above the return; closes over this render's state/handlers.
  function renderInstall(inst) {
    const on = inst.state === 'active'
              const targets = mcpByInstall[installKey(inst.host, inst.path)] || []
              const hasMcp = targets.length > 0
              const open = hasMcp && !collapsed[inst.id]
              const enabled = targets.reduce(
                (n, t) => n + t.servers.filter((s) => s.state === 'enabled').length,
                0,
              )
              const label = `voice for ${inst.host} · ${inst.scope}`
              const badge = on ? 'active' : inst.state === 'disabled' ? 'disabled' : 'not installed'
              return (
                <React.Fragment key={inst.id}>
                  <tr>
                    <td className="h-exp-cell">
                      {hasMcp ? (
                        <button
                          className="h-exp"
                          aria-expanded={open}
                          aria-label={`${open ? 'collapse' : 'expand'} MCP for ${inst.host} · ${inst.scope}`}
                          onClick={() => toggleOpen(inst.id)}
                        >
                          <Icon name="chevron" className={`glyph${open ? ' open' : ''}`} />
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <span className="name">
                        {inst.host} · {inst.scope}
                      </span>
                      <code className="h-path" title={inst.path}>
                        {inst.path}
                      </code>
                    </td>
                    <td className="mono">{inst.theme || '—'}</td>
                    <td>
                      {hasMcp ? (
                        <span className={enabled ? 'mono' : 'mono muted'}>{enabled} on</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${on ? 'ok' : ''}`}>{badge}</span>
                    </td>
                    <td>
                      {/* Four fixed lanes so controls align into columns regardless of which
                          ones a row shows: voice · install/re-theme · switch · trash. Every
                          lane is always rendered (empty when N/A) so nothing shifts sideways. */}
                      <div className="h-acts">
                        <div className="ha-cell ha-voice">
                          {(inst.state === 'absent' || on) && onAction ? (
                            <VoiceSelect
                              label={label}
                              value={voiceFor(inst)}
                              themes={themes}
                              onChange={(v) => setVoice(inst, v)}
                            />
                          ) : null}
                        </div>
                        <div className="ha-cell ha-btn">
                          {inst.state === 'absent' && onAction ? (
                            <button className="btn ghost sm" onClick={() => applyVoice(inst)}>
                              Install
                            </button>
                          ) : on && onAction ? (
                            <button
                              className="btn ghost sm"
                              disabled={voiceFor(inst) === inst.theme}
                              onClick={() => applyVoice(inst)}
                            >
                              Re-theme
                            </button>
                          ) : null}
                        </div>
                        <div className="ha-cell ha-sw">
                          {inst.state !== 'absent' ? (
                            <Switch
                              on={on}
                              disabled={busyKey === inst.id}
                              label={`activate ${inst.host} · ${inst.scope}`}
                              onToggle={() => toggleInstall(inst)}
                            />
                          ) : null}
                        </div>
                        <div className="ha-cell ha-trash">
                          {inst.state !== 'absent' && onAction ? (
                            <button
                              className="btn ghost sm h-trash"
                              aria-label={`remove ${inst.host} · ${inst.scope} from ${inst.path}`}
                              title="Remove this harness"
                              disabled={busyKey === inst.id}
                              onClick={() =>
                                setRemoving((r) =>
                                  r?.id === inst.id
                                    ? null
                                    : { id: inst.id, host: inst.host, path: inst.path, memory: 'keep' },
                                )
                              }
                            >
                              <Icon name="clear" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                  {removing?.id === inst.id ? (
                    <tr className="h-detail-row h-remove-row">
                      <td />
                      <td colSpan={5} className="h-detail">
                        <div className="h-remove">
                          <div className="hr-msg">
                            <strong>
                              {inst.scope === 'project'
                                ? 'Remove this harness from the folder?'
                                : `Remove the global ${inst.host} install?`}
                            </strong>
                            <span className="sub">
                              Deletes <code>{removeLayer(inst.host, inst.scope)}</code>
                              {inst.scope === 'project'
                                ? ' and de-lists it.'
                                : '; the row stays, marked “not installed.”'}{' '}
                              This can’t be undone.
                            </span>
                          </div>
                          <label className="hr-field">
                            <span>Memory &amp; notebook</span>
                            <select
                              className="sel"
                              aria-label="memory disposition"
                              value={removing.memory}
                              onChange={(e) => setRemoving((r) => ({ ...r, memory: e.target.value }))}
                            >
                              <option value="keep">keep in place</option>
                              <option value="archive">archive aside</option>
                              <option value="delete">delete too</option>
                            </select>
                          </label>
                          <div className="hr-acts">
                            <button
                              className="btn sm hr-go"
                              disabled={busyKey === inst.id}
                              onClick={confirmRemove}
                            >
                              {busyKey === inst.id ? 'Removing…' : 'Remove'}
                            </button>
                            <button className="btn ghost sm" onClick={() => setRemoving(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {open ? (
                    <tr className="h-detail-row">
                      <td />
                      <td colSpan={5} className="h-detail">
                        {targets.map((t) => (
                          <div className="mcp-target" key={t.path}>
                            <div className="mt-head">
                              {t.label} · <code>{t.path}</code>
                              {t.commented && ' (has comments; edit by hand)'}
                            </div>
                            {t.servers.map((s) => {
                              const key = t.path + s.name
                              const isDisabled = !!(t.commented || mcpBusy === key)
                              return (
                                <div className="mcp-row" key={s.name}>
                                  <div className="mcp-info">
                                    <div className="mi-top">
                                      <strong>{s.label}</strong>
                                      <span
                                        className={`badge ${s.state === 'enabled' ? 'ok' : ''}`}
                                      >
                                        {s.state}
                                      </span>
                                    </div>
                                    <p>{s.desc}</p>
                                  </div>
                                  {s.state !== 'absent' ? (
                                    <Switch
                                      on={s.state === 'enabled'}
                                      disabled={isDisabled}
                                      label={`${s.label} server`}
                                      onToggle={() => toggleMcp(t, s)}
                                    />
                                  ) : s.preset ? (
                                    <button
                                      className="btn ghost sm"
                                      disabled={isDisabled}
                                      onClick={() => toggleMcp(t, s)}
                                    >
                                      Add
                                    </button>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              )
  }
}
