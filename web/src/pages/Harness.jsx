import React, { useMemo, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { FOOTPRINT_OPTIONS } from './Installs/controls.jsx'
import DeployForm from './Installs/DeployForm.jsx'
import ExclusionsCard from './Installs/ExclusionsCard.jsx'
import InstallRow from './Installs/InstallRow.jsx'

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
//
// The parts live beside it in Installs/ — not Harness/, which the repo's .gitignore claims
// as build output at any depth: the row and its sub-rows (InstallRow), the deploy form,
// the exclusions card, and the shared selects/switch (controls). This file keeps the
// page-wide state and every handler that talks to the server.

// Join key for the MCP-target → install pairing: an install owns the targets the API
// tags with its (host, root). Keying on the install identity (not the config's dirname)
// is what lets a Claude global target — whose ~/.claude.json sits OUTSIDE its ~/.claude
// root — still attach to the right row.
const installKey = (host, root) => `${host} ${root}`

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
  const confirm = useConfirm()
  const { data: instData, error: instErr } = useAsync(() => api.installs(), [dataRev]) // { installs }
  const { data: mcpData, error: mcpErr } = useAsync(() => api.mcp(), [dataRev]) // { targets }
  const [note, setNote] = useState('')
  const [busyKey, setBusyKey] = useState('') // install toggle in flight
  const [mcpBusy, setMcpBusy] = useState('') // mcp server toggle in flight
  // The row's build choices, keyed by row id: { theme, footprint, posture, mode }, each key
  // present only once the user has picked it (choiceFor fills the rest from the install).
  const [picks, setPicks] = useState({})
  const [collapsed, setCollapsed] = useState({}) // explicit collapses; MCP rows open by default
  const [deploying, setDeploying] = useState(false) // the deploy-to-folder form is open
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
  // columns and row component (InstallRow) — only the grouping differs.
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

  // What a row acts on, per choice: the explicit pick, else the install's own (active
  // rows), else the default — and for the voice, the currently deployed one, so a new
  // install matches your existing one.
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
  // True when all four choices match what's deployed — the Apply button on an active row
  // stays disabled until one of them actually changes.
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
    posture: postures,
    mode: modes,
  }

  // Install a not-installed location, or rebuild an active one with the picked voice +
  // footprint — both go through the 'install' action (a non-destructive in-place
  // re-emit), streamed to the console.
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

  // The deploy form's default host: the one you already use (selected view -> any active
  // install -> first row), so a Claude shop isn't silently pushed toward OpenCode.
  const defaultHost = () =>
    installs.find((i) => i.selected)?.host ||
    installs.find((i) => i.state === 'active')?.host ||
    installs[0]?.host ||
    'opencode'

  return (
    <>
      <div className="head-row mb-18">
        <div>
          <div className="eyebrow">Setup</div>
          <h1 className="h">Harness</h1>
          <p className="sub">
            This machine’s install: where it lives, how it’s built, and the voice it speaks with.
            Other hosts (Claude Code, Bob, Copilot, OpenClaude) install from here too.
          </p>
        </div>
        <div className="row wrap gap-10">
          {onAction ? (
            <button className="btn" onClick={() => setDeploying((d) => !d)}>
              <Icon name="folder" /> Deploy to folder…
            </button>
          ) : null}
          {onAction ? (
            <button className="btn" onClick={() => onAction('build-all')}>
              <Icon name="refresh" /> Rebuild all
            </button>
          ) : null}
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

        {deploying ? (
          <DeployForm
            host={defaultHost()}
            theme={currentTheme || 'neutral'}
            options={options}
            onAction={onAction}
            onClose={() => setDeploying(false)}
            onNote={setNote}
          />
        ) : null}
        <p className="sub mb-16">
          Every Geneseed install on this machine: OpenCode, Claude Code, Bob, Copilot, and
          OpenClaude — global and per-repo. Toggle one off without deleting it (files move aside,
          reactivate any time). Active rows expand to wire their MCP servers.{' '}
          <strong>Rebuild all</strong> re-emits every active install in its own voice and mode, as
          one background job.
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
                  sec.rows.map((inst) => (
                    <InstallRow
                      key={inst.id}
                      inst={inst}
                      targets={mcpByInstall[installKey(inst.host, inst.path)] || []}
                      expanded={!collapsed[inst.id]}
                      onToggleExpanded={() => toggleOpen(inst.id)}
                      choice={choiceFor(inst)}
                      unchanged={unchanged(inst)}
                      options={options}
                      onPick={(key, v) => setPick(inst, key, v)}
                      canAct={!!onAction}
                      busy={busyKey === inst.id}
                      mcpBusy={mcpBusy}
                      wizardOpen={wizard === inst.id}
                      onWizard={() => setWizard((w) => (w === inst.id ? '' : inst.id))}
                      removing={removing?.id === inst.id ? removing : null}
                      onRemoving={(r) =>
                        setRemoving(
                          r && { id: inst.id, host: inst.host, path: inst.path, memory: r.memory },
                        )
                      }
                      onApply={() => applyVoice(inst)}
                      onToggleInstall={() => toggleInstall(inst)}
                      onRemove={confirmRemove}
                      onRevealMcp={revealMcp}
                      onToggleMcp={toggleMcp}
                    />
                  ))
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
}
