import React, { useState } from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import { hostInfo } from '../../lib/hosts.js'
import Seg from '../../components/Seg.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Loading from '../../components/Loading.jsx'

// Installs › Profiles (spec D38): every install profile from both sources, Shipped (`profiles/`
// in this checkout) and Personal (the machine-wide folder beside memory and rules), with an Apply
// panel (global, or one project folder) and a Save panel (an install written down as a profile).
// The server owns every fact shown here (js/web/profiles-api.mjs): which installs follow a
// profile, what an apply would change back per host, which global gates keep running in a
// project. Both writes are jobs that run the CLI's own `geneseed profile apply|save`.

const GATE_NAMES = {
  secretsGate: 'secrets',
  doneGate: 'done',
  deletionGate: 'deletion',
  ownershipGate: 'ownership',
  externalGate: 'external',
  testNote: 'test note',
  ownBranchPass: 'own-branch pass',
}
const gateName = (key) => GATE_NAMES[key] || key
const hostLabel = (h) => hostInfo(h).label
const installLabel = (i) => `${hostLabel(i.host)} · ${i.scope === 'global' ? 'global' : i.path}`
// A preserve-guard row (`deletion-gate off -> on`) or a diff row (`gates.deletionGate`) about a
// gate: those are the changes a reader must not miss, so they read as warnings.
const isGateChange = (name) => name.startsWith('gates.') || /-gate$|consent|test-note/.test(name)

// The "Save as profile…" link of the Selected install panel opens this tab with the install
// picked: `#/installs/profiles/<{"save":{host,path}}>`. Anything else is no request.
export function saveRequestOf(item) {
  if (!item) return null
  try {
    const r = JSON.parse(item)
    const s = r?.save
    return s && typeof s.host === 'string' && typeof s.path === 'string' ? s : null
  } catch {
    return null
  }
}
export const saveHash = (inst) =>
  `#/installs/profiles/${encodeURIComponent(JSON.stringify({ save: { host: inst.host, path: inst.path } }))}`

function gatesText(p) {
  const off = (p.gatesOff || []).map(gateName)
  if (!off.length) return { text: 'All on', warn: false }
  if (off.length === 1 && off[0] === 'ownership')
    return { text: 'All on, except ownership', warn: false }
  return { text: `Off: ${off.join(', ')}`, warn: true }
}

function ProfileCard({ p, canAct, onApply }) {
  const head = (
    <div className="panel-head prof-head">
      <div>
        <h3>{p.name}</h3>
        {p.description ? <p className="sub">{p.description}</p> : null}
      </div>
      <span className={`tag ${p.source === 'personal' ? 'acc' : ''}`}>
        {p.source === 'personal' ? 'Personal' : 'Shipped'}
      </span>
    </div>
  )
  if (p.error) {
    return (
      <article className="panel prof-card" aria-label={`profile ${p.name}`}>
        {head}
        <p className="tag bad note">{p.error}</p>
        <div className="kv">
          <span className="k">File</span>
          <code className="v">{p.file}</code>
        </div>
      </article>
    )
  }
  const pr = p.profile
  const gates = gatesText(p)
  return (
    <article className="panel prof-card" aria-label={`profile ${p.name}`}>
      {head}
      <div className="prof-kv">
        <div className="kv">
          <span className="k">Hosts</span>
          <span className="v row gap-8 wrap">
            {pr.hosts.map((h) => (
              <span className="tag human" key={h}>
                {hostLabel(h)}
              </span>
            ))}
          </span>
        </div>
        <div className="kv">
          <span className="k">Settings</span>
          <span className="v">
            {[pr.theme, pr.footprint, pr.posture, pr.mode, pr.trust].join(' · ')}
          </span>
        </div>
        <div className="kv">
          <span className="k">Gates</span>
          <span className="v">
            {gates.warn ? <span className="tag warn note">! {gates.text}</span> : gates.text}
          </span>
        </div>
        <div className="kv">
          <span className="k">Followed by</span>
          <span className="v">
            {p.matches?.length ? p.matches.map(installLabel).join(', ') : 'No install'}
          </span>
        </div>
        <div className="kv">
          <span className="k">File</span>
          <code className="v">{p.file}</code>
        </div>
      </div>
      {canAct ? (
        <div className="row gap-8">
          <button type="button" className="btn ghost" onClick={() => onApply(p.name)}>
            Apply…
          </button>
        </div>
      ) : null}
    </article>
  )
}

// What one host row of the Apply panel says under its name.
function rowState(r, scope) {
  if (!r.present) return 'not on this machine'
  const where = scope === 'global' ? 'global install' : 'project install'
  if (r.state === 'active') return `${where} · active`
  if (r.state === 'disabled') return `${where} · disabled`
  return scope === 'global' ? 'no global install yet' : 'no install in this folder'
}
function rowChanges(r) {
  if (!r.present) return [{ text: `Install ${hostLabel(r.host)}, then apply again`, tone: 'dim' }]
  if (r.state !== 'active') return [{ text: 'New install', tone: 'dim' }]
  if (!r.changes.length) return [{ text: 'Already matches — rebuild only', tone: 'dim' }]
  return r.changes.map((c) => ({
    text: `${c.name} ${c.from} → ${c.to}`,
    tone: isGateChange(c.name) ? 'warn' : '',
  }))
}

function ApplyPanel({ name, onAction, onClose }) {
  const [scope, setScope] = useState('global')
  const [typed, setTyped] = useState('')
  const [project, setProject] = useState('') // the folder the preview was asked for
  const [off, setOff] = useState({})
  const [browsing, setBrowsing] = useState(false)
  const [note, setNote] = useState('')
  const asked = scope === 'project' ? project : null
  const { data, error, loading } = useAsync(
    () => (scope === 'project' && !project ? Promise.resolve(null) : api.profiles(name, asked)),
    [name, scope, project],
  )
  const preview = data?.preview
  const rows = preview?.rows || []
  const picked = rows.filter((r) => r.present && !off[r.host])
  const ready = preview && !preview.error && (scope === 'global' || preview.project)
  const commit = (v) => {
    setProject(v.trim())
    setOff({})
  }
  const browse = async () => {
    setBrowsing(true)
    setNote('')
    try {
      const r = await api.pickFolder()
      if (r.path) {
        setTyped(r.path)
        commit(r.path)
      } else if (r.error) setNote(r.error)
    } catch (e) {
      setNote(e.message)
    } finally {
      setBrowsing(false)
    }
  }
  const apply = async () => {
    const jobId = await onAction?.('profile-apply', {
      name,
      hosts: picked.map((r) => r.host),
      ...(scope === 'project' ? { project: preview.project } : {}),
    })
    if (jobId) onClose()
  }
  const layered = rows.filter((r) => r.layering && !off[r.host] && r.present)
  return (
    <section className="panel prof-dialog" aria-label="Apply profile">
      <div className="panel-head">
        <h2>
          Apply <span className="mono">{name}</span>
        </h2>
        <button type="button" className="btn ghost sm" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <fieldset className="prof-field">
        <legend className="ip-label">Where</legend>
        <Seg aria-label="Where to apply">
          <button
            type="button"
            className={scope === 'global' ? 'on' : ''}
            aria-pressed={scope === 'global'}
            onClick={() => {
              setScope('global')
              setOff({})
            }}
          >
            Global — every project on this machine
          </button>
          <button
            type="button"
            className={scope === 'project' ? 'on' : ''}
            aria-pressed={scope === 'project'}
            onClick={() => {
              setScope('project')
              setOff({})
            }}
          >
            One project
          </button>
        </Seg>
        {scope === 'project' ? (
          <div className="dp-row">
            <input
              className="inp dp-path"
              type="text"
              placeholder="/path/to/project, or click Browse…"
              aria-label="Project folder"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => commit(typed)}
              onKeyDown={(e) => e.key === 'Enter' && commit(typed)}
            />
            <button type="button" className="btn ghost sm" disabled={browsing} onClick={browse}>
              {browsing ? 'Choosing…' : 'Browse…'}
            </button>
          </div>
        ) : null}
      </fieldset>
      {note ? (
        <p className="tag bad note" role="alert">
          {note}
        </p>
      ) : null}
      <ErrorState error={error} />
      {preview?.error ? (
        <p className="tag bad note" role="alert">
          {preview.error}
        </p>
      ) : null}
      {loading && !data ? <Loading /> : null}
      {ready ? (
        <div className="prof-hosts" role="group" aria-label="Hosts">
          <span className="ip-label">
            Hosts — the profile’s hosts are ticked; a host this machine lacks is shown, not offered
          </span>
          {rows.map((r) => (
            <div className={`prof-host${r.present ? '' : ' missing'}`} key={r.host}>
              <label className="row gap-8">
                <input
                  type="checkbox"
                  checked={r.present && !off[r.host]}
                  disabled={!r.present}
                  onChange={() => setOff((o) => ({ ...o, [r.host]: !o[r.host] }))}
                />
                <span>
                  <strong>{hostLabel(r.host)}</strong>{' '}
                  <span className="dim">{rowState(r, scope)}</span>
                </span>
              </label>
              <div className="prof-changes">
                {rowChanges(r).map((c) => (
                  <span key={c.text} className={c.tone === 'warn' ? 'warn-text' : c.tone}>
                    {c.text}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {ready && scope === 'project' ? (
        <p className="sub">
          Project scope: the build writes into the folder for each ticked host. The profile’s{' '}
          <code>sharedTier</code> applies here only; a global apply ignores it.
        </p>
      ) : null}
      {ready && layered.length
        ? layered.map((r) => (
            <p className="tag warn note" key={r.host} role="note">
              A global {hostLabel(r.host)} install is active ({r.layering.root}): both root files
              load in this project. Global gates that still run there:{' '}
              {r.layering.gates.length ? r.layering.gates.join(', ') : 'none'}.{' '}
              <a href="#/docs/exclusions">Why →</a>
            </p>
          ))
        : null}
      <div className="row gap-8">
        <button type="button" className="btn" disabled={!ready || !picked.length} onClick={apply}>
          Apply to {picked.length} {picked.length === 1 ? 'host' : 'hosts'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <span className="dim">Runs as a background job; its log reports each host.</span>
      </div>
    </section>
  )
}

function SavePanel({ data, initial, onAction, onClose }) {
  const installs = data.installs || []
  const key = (i) => `${i.host}|${i.path}`
  const start = installs.find((i) => initial && key(i) === key(initial)) || installs[0]
  const [from, setFrom] = useState(start ? key(start) : '')
  const [name, setName] = useState('')
  const [dest, setDest] = useState('personal')
  const [force, setForce] = useState(false)
  const inst = installs.find((i) => key(i) === from)
  const diff = (inst?.diff || []).filter((d) => d.key !== 'hosts')
  const save = async () => {
    const jobId = await onAction?.('profile-save', {
      name: name.trim(),
      from: { host: inst.host, path: inst.path },
      ...(dest === 'shipped' ? { shipped: true } : {}),
      ...(force ? { force: true } : {}),
    })
    if (jobId) onClose()
  }
  return (
    <section className="panel prof-dialog" aria-label="Save as profile">
      <div className="panel-head">
        <h2>Save an install as profile</h2>
        <button type="button" className="btn ghost sm" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {!installs.length ? (
        <EmptyState>No active install to save. Install one on the Hosts tab first.</EmptyState>
      ) : (
        <>
          <div className="dp-row">
            <label className="field">
              <span>From install</span>
              <select className="sel" value={from} onChange={(e) => setFrom(e.target.value)}>
                {installs.map((i) => (
                  <option key={key(i)} value={key(i)}>
                    {installLabel(i)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Name</span>
              <input
                className="inp"
                type="text"
                value={name}
                placeholder="my-profile"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
          <fieldset className="prof-field">
            <legend className="ip-label">Save to</legend>
            <label className="row gap-8">
              <input
                type="radio"
                name="prof-dest"
                checked={dest === 'personal'}
                onChange={() => setDest('personal')}
              />
              <span>
                <strong>Personal</strong> — <code>{data.personalDir}</code>, beside your memory and
                rules. Survives updates, never shipped.
              </span>
            </label>
            <label className="row gap-8">
              <input
                type="radio"
                name="prof-dest"
                checked={dest === 'shipped'}
                disabled={!data.shippedWritable}
                onChange={() => setDest('shipped')}
              />
              <span>
                <strong>Shipped</strong> — <code>profiles/</code> in this clone, for everyone.
                Commit and open a pull request to share it.
                {data.shippedWritable ? '' : ' Disabled: this copy is not a git clone.'}
              </span>
            </label>
            <label className="row gap-8">
              <input type="checkbox" checked={force} onChange={() => setForce((f) => !f)} />
              <span>Replace a profile of this name in the same place</span>
            </label>
          </fieldset>
          <div className="prof-changes" aria-label={`Differs from ${data.base}`}>
            <span>
              Differs from <strong>{data.base}</strong>
              {diff.length ? '' : ': nothing'}
            </span>
            {diff.map((d) => (
              <span key={d.key} className={isGateChange(d.key) ? 'warn-text' : ''}>
                {isGateChange(d.key)
                  ? `! gate ${gateName(d.key.slice(6))}: ${d.now} (${data.base}: ${d.base})`
                  : `${d.key} ${d.now} (${data.base}: ${d.base})`}
              </span>
            ))}
          </div>
          <div className="row gap-8">
            <button type="button" className="btn" disabled={!inst || !name.trim()} onClick={save}>
              Save profile
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default function Profiles({ onAction, dataRev, item }) {
  const request = saveRequestOf(item)
  const { data, error, loading, reload } = useAsync(() => api.profiles(), [dataRev])
  // `{ kind: 'apply', name }` or `{ kind: 'save', from }`; a Save link opens the Save panel.
  const [dialog, setDialog] = useState(request ? { kind: 'save', from: request } : null)
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  const profiles = data?.profiles || []
  const canAct = !!onAction
  return (
    <div className="profiles">
      <div className="inst-head">
        <div>
          <h2>Profiles</h2>
          <p className="dim">
            A profile is a named set of build settings and the hosts it targets. Apply it globally
            or to one project.
          </p>
        </div>
        {canAct ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => setDialog({ kind: 'save', from: null })}
          >
            Save an install as profile…
          </button>
        ) : null}
      </div>
      {profiles.length ? (
        <div className="prof-grid">
          {profiles.map((p) => (
            <ProfileCard
              key={`${p.source}:${p.name}`}
              p={p}
              canAct={canAct}
              onApply={(name) => setDialog({ kind: 'apply', name })}
            />
          ))}
        </div>
      ) : (
        <EmptyState>No profile yet. Save an install as one to start.</EmptyState>
      )}
      {dialog?.kind === 'apply' ? (
        <ApplyPanel
          key={dialog.name}
          name={dialog.name}
          onAction={onAction}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'save' && data ? (
        <SavePanel
          data={data}
          initial={dialog.from}
          onAction={onAction}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}
