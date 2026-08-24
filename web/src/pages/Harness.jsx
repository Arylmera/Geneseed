import React, { useMemo, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Setup → Harness: this machine's install first, everything else under it.
//
// THE PAGE THAT ATE THE THEMES TAB. Two tabs used to answer one question between them —
// "what is deployed here, and in what voice" — and the split meant picking a voice was a
// different screen from seeing which install it would land on. So the voice gallery is a
// card on this page now (`#/themes` still resolves here, router.js's VIEW_ALIAS), and the
// page reads top-down the way the decision does: the install you are on, the voice it
// speaks, then every other install on the machine.
//
// The table below is unchanged and deliberately kept: every detected install (host × scope)
// is a row — OpenCode and Claude, global and per-repo — independently activated, re-themed,
// or deactivated. The MCP servers wired into an install live INSIDE its row: an active
// install with MCP wiring expands to a detail panel listing its servers (OpenCode under
// opencode.json's `mcp`, Claude under .mcp.json / ~/.claude.json's `mcpServers`).
// "Rebuild all" re-emits every active install in its own voice + mode as one background
// job. Mutations refetch via dataRev / onMutated — no full reload, nothing flashes.
//
// "Single-harness home" was a decision about the DASHBOARD, not about this page: the
// dashboard stopped leading with a fleet tree, and the fleet moved here, where managing it
// is the whole point.

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

// A footprint <select> in the app's `.sel` style: lean | full. A fixed two-option pair,
// so unlike VoiceSelect it needs no async list — the choice is the same on every host.
function FootprintSelect({ label, value, onChange }) {
  return (
    <select
      className="sel"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="full">full</option>
      <option value="lean">lean</option>
    </select>
  )
}

// A posture <select> in the app's `.sel` style: the collaboration register inlined into
// the install's AGENT.md. The list is discovered server-side (src/postures/), so a new
// posture appears here with no UI change; falls back to nothing until it loads.
function PostureSelect({ label, value, postures, onChange }) {
  if (!postures.length) return null
  return (
    <select
      className="sel"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {postures.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  )
}

// A mode <select> in the app's `.sel` style: the operating register inlined into
// the install's AGENT.md. The list is discovered server-side (src/modes/), so a new
// mode appears here with no UI change; falls back to nothing until it loads.
function ModeSelect({ label, value, modes, onChange }) {
  if (!modes.length) return null
  return (
    <select
      className="sel"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {modes.map((m) => (
        <option key={m} value={m}>
          {m}
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
        : host === 'copilot'
          ? ".github's Geneseed agents/skills + the AGENTS.md block"
          : '.opencode/ + AGENT.md + the bundle'
  }
  return host === 'claude'
    ? "~/.claude's agents/skills + the CLAUDE.md block + settings hooks"
    : host === 'bob'
      ? "~/.bob's agents/skills + the AGENTS.md block + settings hooks"
      : host === 'copilot'
        ? "~/.copilot's agents/skills + the copilot-instructions.md block"
        : "~/.config/opencode's AGENT.md, agents, skills, plugins + the opencode.json entry"
}

// Sovereign-repo exclusions: folders where every global install goes dormant. Its own
// small card, self-contained (own fetch/reload) so it doesn't need to thread through the
// harness table's dataRev/onMutated — /api/excludes' `installs` field is a DIFFERENT list
// than the harness table's (host, scope, path) rows: it's excludes_snapshot()'s "which
// global installs exist to manage exclusions for", so the card hides itself independently
// of whatever the table above is showing.
function ExclusionsCard() {
  const { data, error, reload } = useAsync(() => api.excludes(), [])
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState([])

  const mutate = async (action, path) => {
    setBusy(true)
    try {
      const res = await api.excludeMutate(action, path)
      setMsgs(res.messages || [])
    } catch (e) {
      // A 409 (nothing to remove, no global install) throws — the body still carries
      // the human messages exclude_add/exclude_remove built, same as Rules.jsx's mutate.
      setMsgs(e.body?.messages || [e.message])
    } finally {
      setBusy(false)
      reload()
    }
  }

  const pick = async () => {
    setBusy(true)
    try {
      const r = await api.pickFolder()
      if (r.path) await mutate('add', r.path)
      else if (r.error) setMsgs([r.error])
    } catch (e) {
      setMsgs([e.message])
    } finally {
      setBusy(false)
    }
  }

  if (error || !data?.installs?.length) return null // no global install -> nothing to manage

  return (
    <div className="card pad-lg mb-16">
      <div className="card-head">
        <h3>Excluded folders</h3>
      </div>
      <p className="sub mb-16">
        Sovereign repos: inside these folders every global harness goes dormant — hooks stay silent
        and the global preamble is not loaded.
      </p>
      {(data.excludes || []).map((e) => (
        <div className="row wrap between gap-12" key={e.path}>
          <code>{e.path}</code>
          <span className="mono muted">[{e.hosts.join(', ')}]</span>
          <button className="btn ghost sm" disabled={busy} onClick={() => mutate('remove', e.path)}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn ghost sm" disabled={busy} onClick={pick}>
        <Icon name="folder" /> Exclude a folder…
      </button>
      {msgs.map((m, i) => (
        <p key={i} className="sub">
          {m}
        </p>
      ))}
    </div>
  )
}

// This machine's own install, as the prototype's first card: where it lives, how it was
// built, and when. `overview.install` is the detected (host, scope, path) the console is
// pointed at — null before the overview loads, and null for a target that matches no
// detected install, in which case the card simply does not render and the table below is
// still the whole truth.
function ThisInstall({ overview }) {
  const inst = overview?.install
  if (!inst) return null
  return (
    <div className="card pad-lg mb-16">
      <div className="card-head">
        <h3>
          {inst.host} · {inst.scope}
        </h3>
        <span className="tick right">active</span>
      </div>
      <div className="kv">
        <span className="k">path</span>
        <code className="v">{inst.path}</code>
      </div>
      <div className="kv">
        <span className="k">voice</span>
        <span className="v mono">{overview.theme || '—'}</span>
      </div>
      <div className="kv">
        <span className="k">footprint</span>
        <span className="v mono">{overview.footprint || '—'}</span>
      </div>
      <div className="kv">
        <span className="k">built</span>
        <span className="v mono">{overview.build_time || 'never'}</span>
      </div>
      <p className="sub motto">
        Per-folder overrides global: inside a folder with its own harness, only the folder’s harness
        loads there.
      </p>
    </div>
  )
}

// The voice gallery — the whole of the retired Themes tab, restated as the prototype's rows
// rather than a card grid. The deployed voice is pinned first and marked; applying any other
// one re-emits the install in place (structure identical, only words and accent shift).
//
// It reads the `themes` App already fetched for the voice popover instead of fetching its
// own list: the old page's `api.themes()` call existed because it was mounted standalone.
// The voice REFERENCE — what each voice sounds like, and nothing you can act on.
//
// ⚠ IT USED TO CARRY AN "APPLY VOICE" BUTTON PER ROW, AND THAT WAS A SECOND DOOR ONTO A
// CHOICE THAT ALREADY HAD ONE. Every install in the table below picks its own voice beside
// its own footprint, posture and mode; a gallery at the top of the page could only ever act
// on ONE install (the deployed one), so the same word meant "for this machine" here and
// "for this row" a scroll further down. What the gallery is genuinely good for is the thing
// a <select> of fourteen bare names cannot do: tell you what a voice actually sounds like
// before you pick it. So it keeps the taglines and gives up the buttons.
//
// A <details>, not a state hook: this is disclosure, and the platform element is keyboard
// operable, findable by in-page search when open, and needs no state to go wrong. Closed by
// default — the install card above already states which voice is deployed, so the list is
// something you open when choosing, not something you read every visit.
function VoiceGallery({ themes, overview }) {
  // Gated on the overview as well as the theme list: `useOverview` fills the two from
  // independent effects, and a list that marked nothing as current — or marked the wrong
  // row — is worse than one that appears a moment later.
  if (!themes.length || !overview) return null
  const current = overview.theme
  // Current first, then source order — a list whose current row is somewhere in the middle
  // makes you hunt for the one fact you came to read.
  const rows = [...themes].sort((a, b) => (a.name === current ? -1 : b.name === current ? 1 : 0))
  return (
    <details className="card voice-ref mb-16">
      <summary>
        <span className="vr-title">Voice</span>
        <span className="vr-current">{current}</span>
        <span className="tick vr-hint">
          {themes.length} to choose from — set it per install below
        </span>
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

export default function Harnesses({
  onAction,
  themes = [],
  currentTheme,
  overview,
  dataRev,
  onMutated,
}) {
  const { data: instData, error: instErr } = useAsync(() => api.installs(), [dataRev]) // { installs }
  const { data: mcpData, error: mcpErr } = useAsync(() => api.mcp(), [dataRev]) // { targets }
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('') // install toggle in flight
  const [mcpBusy, setMcpBusy] = useState('') // mcp server toggle in flight
  const [pick, setPick] = useState({}) // chosen voice, keyed by row id
  const [fpick, setFpick] = useState({}) // chosen footprint, keyed by row id
  const [ppick, setPpick] = useState({}) // chosen posture, keyed by row id
  const [mpick, setMpick] = useState({}) // chosen mode, keyed by row id
  const [collapsed, setCollapsed] = useState({}) // explicit collapses; MCP rows open by default
  const [deploy, setDeploy] = useState(null) // null = closed; { path, host, theme } = the deploy form
  const [browsing, setBrowsing] = useState(false) // native folder picker in flight
  const [removing, setRemoving] = useState(null) // null = closed; { id, host, path, memory } = remove-confirm
  // The id of the absent row whose install wizard is open, or ''. An absent row used to
  // carry four selects and a button inline — the same seven lanes an active row needs to
  // align against — so a machine with three uninstalled hosts showed twelve dropdowns for
  // choices nobody had asked to make yet. The row now offers one button and discloses the
  // steps when you take it; the payload it POSTs is unchanged.
  const [wizard, setWizard] = useState('')

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
  const postures = instData.postures || []
  const modes = instData.modes || []
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
      empty: 'No per-project installs yet; use “Deploy to folder…”.',
    },
  ]

  // The voice a row acts on: the explicit pick, else the install's own theme (active
  // rows), else the current deployed voice — so a new install matches your existing one.
  const voiceFor = (inst) => pick[inst.id] || inst.theme || currentTheme || 'neutral'
  const setVoice = (inst, v) => setPick((p) => ({ ...p, [inst.id]: v }))
  // The footprint a row acts on: the explicit pick, else the install's own, else full.
  const footprintFor = (inst) => fpick[inst.id] || inst.footprint || 'full'
  const setFootprint = (inst, v) => setFpick((p) => ({ ...p, [inst.id]: v }))
  // The posture a row acts on: the explicit pick, else the install's own, else peer.
  const postureFor = (inst) => ppick[inst.id] || inst.posture || 'peer'
  const setPosture = (inst, v) => setPpick((p) => ({ ...p, [inst.id]: v }))
  // The mode a row acts on: the explicit pick, else the install's own, else direct.
  const modeFor = (inst) => mpick[inst.id] || inst.mode || 'direct'
  const setMode = (inst, v) => setMpick((p) => ({ ...p, [inst.id]: v }))
  // True when voice, footprint, posture AND mode all match what's deployed — the Apply
  // button on an active row stays disabled until one of them actually changes.
  const unchanged = (inst) =>
    voiceFor(inst) === inst.theme &&
    footprintFor(inst) === (inst.footprint || 'full') &&
    postureFor(inst) === (inst.posture || 'peer') &&
    modeFor(inst) === (inst.mode || 'direct')

  // Install a not-installed location, or rebuild an active one with the picked voice +
  // footprint — both go through the 'install' action (a non-destructive in-place
  // re-emit), streamed to the console.
  const applyVoice = (inst) => {
    const theme = voiceFor(inst)
    const footprint = footprintFor(inst)
    const posture = postureFor(inst)
    const mode = modeFor(inst)
    const msg =
      inst.state === 'absent'
        ? `Install Geneseed into ${inst.path} with the “${theme}” voice (${footprint} footprint, ${posture} posture, ${mode} mode)? ` +
          `Files are added non-destructively (your own config is left untouched); deactivate or uninstall later.`
        : `Rebuild this install (voice “${theme}”, ${footprint} footprint, ${posture} posture, ${mode} mode)? It rebuilds in place, non-destructive.`
    if (window.confirm(msg))
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
      !window.confirm(
        'Deactivate this install? Files are moved aside, not deleted; reactivate any time.',
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

  // A preset lands with its token and API URL deliberately blank, and until now the screen showed
  // you the file but had no way to take you to it. This opens the containing FOLDER (a `.json`
  // handed to the OS opens in whatever claims the extension — often a browser, i.e. a read-only
  // view of the file you are trying to edit) on the machine running the daemon.
  const revealMcp = async (target) => {
    setNote('')
    try {
      const r = await api.mcpReveal(target.path)
      // `ok` means the path was allowed and the request went out, NOT that a window appeared —
      // a headless host has no opener and the server swallows that. So the note names the folder
      // rather than claiming success: if nothing opened, the user still has the path to paste.
      setNote(`Opening ${r.dir} — if no window appeared, open that folder by hand.`)
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
    setDeploy({
      path: '',
      host: defaultHost(),
      theme: currentTheme || 'neutral',
      footprint: 'full',
      posture: 'peer',
      mode: 'direct',
    })

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
    const jobId = await onAction?.('deploy', {
      host: deploy.host,
      path,
      theme: deploy.theme,
      footprint: deploy.footprint,
      posture: deploy.posture,
      mode: deploy.mode,
    })
    if (jobId) setDeploy(null)
  }

  return (
    <>
      <div className="head-row mb-18">
        <div>
          <div className="eyebrow">Setup</div>
          <h1 className="h">Harness</h1>
          <p className="sub">
            This machine’s install: where it lives, how it’s built, and the voice it speaks with.
            Other hosts (Claude Code, Bob, Copilot) install from here too.
          </p>
        </div>
        <div className="row wrap gap-10">
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

      <ThisInstall overview={overview} />
      <VoiceGallery themes={themes} overview={overview} />

      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Every install</h3>
          <div className="right">
            <span className="tick">
              {activeCount} active · {installs.length} total
            </span>
          </div>
        </div>

        {deploy ? (
          <div className="deploy-pop">
            <div className="dp-row">
              <input
                className="inp dp-path"
                type="text"
                placeholder="/path/to/project, or click Browse…"
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
                  <option value="copilot">GitHub Copilot</option>
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
              <label className="dp-field">
                <span>Footprint</span>
                <FootprintSelect
                  label="footprint for the new harness"
                  value={deploy.footprint}
                  onChange={(v) => setDeploy((d) => ({ ...d, footprint: v }))}
                />
              </label>
              <label className="dp-field">
                <span>Posture</span>
                <PostureSelect
                  label="posture for the new harness"
                  value={deploy.posture}
                  postures={postures}
                  onChange={(v) => setDeploy((d) => ({ ...d, posture: v }))}
                />
              </label>
              <label className="dp-field">
                <span>Mode</span>
                <ModeSelect
                  label="mode for the new harness"
                  value={deploy.mode}
                  modes={modes}
                  onChange={(v) => setDeploy((d) => ({ ...d, mode: v }))}
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
                    : deploy.host === 'copilot'
                      ? '.github/ + AGENTS.md'
                      : '.opencode/ + AGENT.md'}
              </code>
              ) into the folder, non-destructively. It’s then tracked here even after you leave its
              directory.
            </p>
          </div>
        ) : null}
        <p className="sub mb-16">
          Every Geneseed install on this machine: OpenCode, Claude Code, Bob, and Copilot — global
          and per-repo. Toggle one off without deleting it (files move aside, reactivate any time).
          Active rows expand to wire their MCP servers. <strong>Rebuild all</strong> re-emits every
          active install in its own voice and mode, as one background job.
        </p>
        <p className="sub mb-16">
          <strong>Per-folder now overrides global.</strong> Inside a folder that has its own
          harness, the <em>same host’s</em> global harness steps aside; only the folder’s harness
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
      <ExclusionsCard />
    </>
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
            {/* Seven fixed lanes so controls align into columns regardless of which
                          ones a row shows: voice · footprint · posture · mode · install/apply · switch · trash.
                          Every lane is always rendered (empty when N/A) so nothing shifts.
                          An ABSENT row leaves the first four empty — its choices live in the
                          disclosed wizard below it, not inline. */}
            <div className="h-acts">
              <div className="ha-cell ha-voice">
                {on && onAction ? (
                  <VoiceSelect
                    label={label}
                    value={voiceFor(inst)}
                    themes={themes}
                    onChange={(v) => setVoice(inst, v)}
                  />
                ) : null}
              </div>
              <div className="ha-cell ha-fp">
                {on && onAction ? (
                  <FootprintSelect
                    label={`footprint for ${inst.host} · ${inst.scope}`}
                    value={footprintFor(inst)}
                    onChange={(v) => setFootprint(inst, v)}
                  />
                ) : null}
              </div>
              <div className="ha-cell ha-posture">
                {on && onAction ? (
                  <PostureSelect
                    label={`posture for ${inst.host} · ${inst.scope}`}
                    value={postureFor(inst)}
                    postures={postures}
                    onChange={(v) => setPosture(inst, v)}
                  />
                ) : null}
              </div>
              <div className="ha-cell ha-mode">
                {on && onAction ? (
                  <ModeSelect
                    label={`mode for ${inst.host} · ${inst.scope}`}
                    value={modeFor(inst)}
                    modes={modes}
                    onChange={(v) => setMode(inst, v)}
                  />
                ) : null}
              </div>
              <div className="ha-cell ha-btn">
                {inst.state === 'absent' && onAction ? (
                  <button
                    className="btn ghost sm"
                    aria-expanded={wizard === inst.id}
                    onClick={() => setWizard((w) => (w === inst.id ? '' : inst.id))}
                  >
                    Install…
                  </button>
                ) : on && onAction ? (
                  <button
                    className="btn ghost sm"
                    disabled={unchanged(inst)}
                    onClick={() => applyVoice(inst)}
                  >
                    Apply
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
        {inst.state === 'absent' && wizard === inst.id ? (
          <tr className="h-detail-row h-setup-row">
            <td />
            <td colSpan={5} className="h-detail">
              {/* The stepped disclosure. The host is already decided — it is the row you
                  opened — so the steps are the four choices that remain, in the order the
                  install actually consumes them. Same `install` action, same payload as the
                  inline lane it replaces; only the moment you are asked has moved. */}
              <div className="h-setup">
                <p className="sub hs-msg">
                  Install Geneseed into <code>{inst.path}</code> as <strong>{inst.host}</strong>.
                  Files are added non-destructively; deactivate or uninstall later.
                </p>
                <div className="hs-steps">
                  <label className="hs-step">
                    <span>1 · Voice</span>
                    <VoiceSelect
                      label={label}
                      value={voiceFor(inst)}
                      themes={themes}
                      onChange={(v) => setVoice(inst, v)}
                    />
                  </label>
                  <label className="hs-step">
                    <span>2 · Footprint</span>
                    <FootprintSelect
                      label={`footprint for ${inst.host} · ${inst.scope}`}
                      value={footprintFor(inst)}
                      onChange={(v) => setFootprint(inst, v)}
                    />
                  </label>
                  <label className="hs-step">
                    <span>3 · Posture</span>
                    <PostureSelect
                      label={`posture for ${inst.host} · ${inst.scope}`}
                      value={postureFor(inst)}
                      postures={postures}
                      onChange={(v) => setPosture(inst, v)}
                    />
                  </label>
                  <label className="hs-step">
                    <span>4 · Mode</span>
                    <ModeSelect
                      label={`mode for ${inst.host} · ${inst.scope}`}
                      value={modeFor(inst)}
                      modes={modes}
                      onChange={(v) => setMode(inst, v)}
                    />
                  </label>
                </div>
                <div className="hr-acts">
                  <button className="btn sm" onClick={() => applyVoice(inst)}>
                    Install
                  </button>
                  <button className="btn ghost sm" onClick={() => setWizard('')}>
                    Cancel
                  </button>
                </div>
              </div>
            </td>
          </tr>
        ) : null}
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
                    <button
                      className="btn ghost sm"
                      onClick={() => revealMcp(t)}
                      title={`Open the folder holding ${t.path} — tokens and URLs go in this file`}
                    >
                      Open folder
                    </button>
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
                            <span className={`badge ${s.state === 'enabled' ? 'ok' : ''}`}>
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
