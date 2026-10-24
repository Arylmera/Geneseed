import React, { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon.jsx'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { useConfirm } from '../../hooks/useConfirm.jsx'
import { FOOTPRINT_OPTIONS } from './controls.jsx'
import DeployForm from './DeployForm.jsx'
import InstallPanel from './InstallPanel.jsx'
import { hostInfo, installName, removeLayer } from '../../lib/hosts.js'

// Join key for the MCP-target -> install pairing: an install owns the targets the API tags
// with its (host, root). Keying on the install identity (not the config's dirname) is what
// lets a Claude global target, whose ~/.claude.json sits OUTSIDE its ~/.claude root, still
// attach to the right install.
const installKey = (host, root) => `${host} ${root}`

// The hosts whose project install keeps its data under a marker folder (js/hosts/hosts.mjs
// CLAUDE_STYLE): the claude-family rows of HOSTS.
const CLAUDE_STYLE = ['claude', 'bob', 'openclaude']

const STATE = { active: ['Active', 'ok'], disabled: ['Disabled', 'warn'] }

// One of the two install tables. Global installs are one per host tool and named by it;
// per-project installs are named by their folder, with the host beside it, because the
// question each table answers is different ("which tools carry the harness everywhere"
// vs "which repos carry their own").
function InstallTable({ rows, project, currentId, onPick, label }) {
  return (
    <div className="tbl-scroll">
      <table className="tbl hosts-tbl" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{project ? 'Project' : 'Host'}</th>
            <th scope="col">{project ? 'Host' : 'Path'}</th>
            <th scope="col">Voice</th>
            <th scope="col">Footprint</th>
            <th scope="col">State</th>
            <th scope="col">
              <span className="sr-only">Selected</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((inst) => {
            const [stateLabel, tone] = STATE[inst.state] || ['Not installed', '']
            const on = currentId === inst.id
            const quiet = inst.state === 'absent'
            return (
              // The whole row picks it, not only the name: the button stays for the keyboard.
              <tr
                key={inst.id}
                className={`pickable${on ? ' on' : ''}${quiet ? ' quiet' : ''}`}
                onClick={() => onPick(inst.id)}
              >
                <td>
                  <button
                    type="button"
                    className="row-pick"
                    aria-pressed={on}
                    title={inst.path}
                    onClick={() => onPick(inst.id)}
                  >
                    {installName(inst)}
                  </button>
                </td>
                {project ? (
                  <td>{hostInfo(inst.host).label}</td>
                ) : (
                  <td className="mono path-cell" title={inst.path}>
                    {inst.path}
                  </td>
                )}
                <td>{quiet ? '' : inst.theme || ''}</td>
                <td>{quiet ? '' : inst.footprint || ''}</td>
                <td>
                  <span className={`tag ${tone}`}>{stateLabel}</span>
                </td>
                <td className="pick-mark">{on ? 'Editing ›' : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

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
  const {
    data: instData,
    error: instErr,
    reload: reloadInst,
  } = useAsync(() => api.installs(), [dataRev])
  const { data: mcpData, error: mcpErr, reload: reloadMcp } = useAsync(() => api.mcp(), [dataRev])
  // null | { text, tone }: 'bad' is a failure (an alert), 'ok' a done act, '' a progress
  // note, so "Opening…" is never painted as an error.
  const [note, setNote] = useState(null)
  const [busyKey, setBusyKey] = useState('') // install toggle in flight
  // Each install's build choices, keyed by id: { theme, footprint, posture, mode, trust }, each
  // key present only once the user has picked it (choiceFor fills the rest).
  const [picks, setPicks] = useState({})
  const [deploying, setDeploying] = useState(false)
  // What Uninstall does to memory + notebook, bound to the install it was chosen on: the
  // panel's fallback install can change under a toggle or refresh without a pick, and a
  // "delete" must never follow it there.
  const [memPick, setMemPick] = useState({ id: '', value: 'keep' })
  const memoryFor = (inst) => (memPick.id === inst?.id ? memPick.value : 'keep')
  const [picked, setPicked] = useState('') // the install shown in the panel

  const mcpByInstall = useMemo(() => {
    const m = {}
    for (const t of mcpData?.targets || []) {
      const k = installKey(t.host || 'opencode', t.root)
      ;(m[k] || (m[k] = [])).push(t)
    }
    return m
  }, [mcpData])

  if (instErr || mcpErr)
    return (
      <ErrorState
        error={instErr || mcpErr}
        onRetry={() => {
          reloadInst()
          reloadMcp()
        }}
      />
    )
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
  // An absent row's `footprint` is only `footprintOfDir`'s no-marker answer (`full`), not a
  // choice, so a new install takes the CLI's default, lean.
  const choiceFor = (inst) => {
    const p = picks[inst.id] || {}
    return {
      theme: p.theme || inst.theme || currentTheme || 'neutral',
      footprint: p.footprint || (inst.state !== 'absent' && inst.footprint) || 'lean',
      posture: p.posture || inst.posture || 'peer',
      mode: p.mode || inst.mode || 'direct',
      trust: p.trust || inst.trust || 'balanced',
    }
  }
  const setPick = (inst, key, v) =>
    setPicks((p) => ({ ...p, [inst.id]: { ...p[inst.id], [key]: v } }))
  const unchanged = (inst) => {
    const c = choiceFor(inst)
    return (
      c.theme === inst.theme &&
      c.footprint === (inst.footprint || 'lean') &&
      c.posture === (inst.posture || 'peer') &&
      c.mode === (inst.mode || 'direct') &&
      c.trust === (inst.trust || 'balanced')
    )
  }
  const options = {
    theme: themes.map((t) => t.name),
    footprint: FOOTPRINT_OPTIONS,
    posture: instData.postures || [],
    mode: instData.modes || [],
    trust: instData.trusts || [],
  }

  // Install a not-installed location, or rebuild an active one with its picks. Both go
  // through the 'install' action (a non-destructive in-place emit), streamed to the console.
  const applyVoice = async (inst) => {
    const { theme, footprint, posture, mode, trust } = choiceFor(inst)
    const tool = hostInfo(inst.host).label
    const axes = `${footprint} footprint, ${posture} posture, ${mode} mode, ${trust} loop trust`
    const msg =
      inst.state === 'absent'
        ? `Install Geneseed for ${tool} into ${inst.path} with the “${theme}” voice (${axes})? ` +
          `Files are added non-destructively (your own config is left untouched); deactivate or uninstall later.`
        : `Rebuild this ${tool} install (voice “${theme}”, ${axes})? It rebuilds in place, non-destructive.`
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
        trust,
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
    setNote(null)
    try {
      const res = await api.installToggle(
        inst.host,
        inst.path,
        inst.state === 'active' ? 'deactivate' : 'activate',
      )
      if (!res.ok) {
        const failed = Array.isArray(res.failed) ? res.failed.join(', ') : ''
        setNote({
          text: res.error || (failed && `unrestored: ${failed}`) || 'action failed',
          tone: 'bad',
        })
        return
      }
      onMutated?.()
    } catch (e) {
      setNote({ text: e.message, tone: 'bad' })
    } finally {
      setBusyKey('')
    }
  }

  // Where an install's memory/ and notebook/ live, so the confirm names what "delete"
  // removes: a Claude-style project keeps them under its marker folder, any other install
  // in its root.
  // shortcut: mirrors installDataDir; upgrade when /api/installs carries data_dir
  // Joined with the separator the path already uses, so a Windows path reads as one.
  const memPath = (inst, store) => {
    const sep = inst.path.includes('\\') && !inst.path.includes('/') ? '\\' : '/'
    const root = inst.path.replace(/[\\/]+$/, '')
    const data =
      inst.scope === 'project' && CLAUDE_STYLE.includes(inst.host)
        ? `${root}${sep}.${inst.host}`
        : root
    return `${data}${sep}${store}`
  }

  // Permanently delete an install. Destructive and irreversible, so a danger confirm that
  // names the layer it deletes and what the panel's memory choice does; with "delete" it
  // names the two folders and says so on its button.
  const confirmRemove = async (inst) => {
    const memory = memoryFor(inst)
    const where =
      inst.scope === 'project' ? ' and de-lists it' : '; the row stays, marked “not installed”'
    const mem =
      memory === 'delete'
        ? `, and permanently deletes ${memPath(inst, 'memory')} and ${memPath(inst, 'notebook')}`
        : memory === 'archive'
          ? '; memory and notebook are archived aside'
          : '; memory and notebook stay in place'
    const ok = await confirm(
      `Uninstall ${hostInfo(inst.host).label} · ${inst.scope}? It deletes ` +
        `${removeLayer(inst.host, inst.scope)}${where}${mem}. This can’t be undone.`,
      {
        title: inst.scope === 'project' ? 'Remove this harness?' : 'Remove the global install?',
        confirmLabel: memory === 'delete' ? 'Remove and delete memory' : 'Remove',
        tone: 'danger',
      },
    )
    if (!ok) return
    setBusyKey(inst.id)
    setNote(null)
    try {
      const res = await api.installRemove(inst.host, inst.path, memory)
      if (!res.ok) {
        setNote({ text: res.error || 'remove failed', tone: 'bad' })
        return
      }
      // A removed global stays as a "not installed" row: a later reinstall starts at keep.
      setMemPick({ id: '', value: 'keep' })
      // An owned file the user edited is left on disk as theirs; say so, or the cleared row
      // reads as "everything is gone".
      if (res.kept?.length) {
        setNote({
          text:
            `Removed. Kept ${res.kept.length} file(s) you edited: ${res.kept.join(', ')} — they ` +
            'are yours now (the CLI geneseed uninstall --force deletes edited files too).',
          tone: 'ok',
        })
      }
      onMutated?.()
    } catch (e) {
      setNote({ text: e.message, tone: 'bad' })
    } finally {
      setBusyKey('')
    }
  }

  // MCP is read-only here, so editing a server means editing its file: this opens the FOLDER
  // holding the config on the machine running the daemon. `ok` means the request went out,
  // not that a window appeared, so the note names the folder.
  const revealMcp = async (target) => {
    setNote(null)
    try {
      const r = await api.mcpReveal(target.path)
      setNote({
        text: `Opening ${r.dir}. If no window appeared, open that folder by hand.`,
        tone: '',
      })
    } catch (e) {
      setNote({ text: e.message, tone: 'bad' })
    }
  }

  // The deploy form's default host: the one you already use.
  const defaultHost =
    installs.find((i) => i.selected)?.host ||
    installs.find((i) => i.state === 'active')?.host ||
    installs[0]?.host ||
    'opencode'
  const globals = installs.filter((i) => i.scope === 'global')
  const projects = installs.filter((i) => i.scope !== 'global')
  const pick = (id) => {
    setPicked(id)
  }

  return (
    <div className="hosts">
      <div className="hosts-main">
        <div className="toolbar">
          <span className="dim">
            {installs.filter((i) => i.state === 'active').length} active of {installs.length}{' '}
            detected.
          </span>
          {onAction ? (
            <div className="row gap-8">
              <button type="button" className="btn ghost" onClick={() => onAction('build-all')}>
                <Icon name="refresh" /> Rebuild all
              </button>
            </div>
          ) : null}
        </div>
        {note?.tone === 'bad' ? (
          <p className="tag bad note" role="alert">
            {note.text}
          </p>
        ) : note ? (
          <p className={`tag ${note.tone === 'ok' ? 'ok ' : ''}note`} role="status">
            {note.text}
          </p>
        ) : null}
        <section className="panel flush" aria-labelledby="inst-global">
          <div className="inst-head">
            <div>
              <h2 id="inst-global">Global installs</h2>
              <p className="dim">One per tool. Loaded in every folder, except excluded ones.</p>
            </div>
          </div>
          <InstallTable
            rows={globals}
            currentId={current?.id}
            onPick={pick}
            label="Global installs"
          />
        </section>
        <section className="panel flush" aria-labelledby="inst-project">
          <div className="inst-head">
            <div>
              <h2 id="inst-project">Per-project installs</h2>
              <p className="dim">
                A repo with its own harness. Inside it, only that harness loads.
              </p>
            </div>
            {onAction ? (
              <button type="button" className="btn ghost" onClick={() => setDeploying((d) => !d)}>
                <Icon name="folder" /> Deploy to a repo…
              </button>
            ) : null}
          </div>
          {deploying ? (
            <div className="inst-deploy">
              <DeployForm
                host={defaultHost}
                theme={currentTheme || 'neutral'}
                options={options}
                onAction={onAction}
                onClose={() => setDeploying(false)}
                onNote={(t) => setNote(t ? { text: t, tone: 'bad' } : null)}
              />
            </div>
          ) : null}
          {projects.length ? (
            <InstallTable
              rows={projects}
              project
              currentId={current?.id}
              onPick={pick}
              label="Per-project installs"
            />
          ) : (
            <EmptyState>
              No repo has its own harness yet. Deploy one to give a project its own rules and voice.
            </EmptyState>
          )}
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
          memory={memoryFor(current)}
          onMemory={(value) => setMemPick({ id: current.id, value })}
          onApply={() => applyVoice(current)}
          onToggleInstall={() => toggleInstall(current)}
          onRemove={() => confirmRemove(current)}
          onRevealMcp={revealMcp}
        />
      ) : null}
    </div>
  )
}
