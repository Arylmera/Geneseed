import React from 'react'
import { removeLayer, hostInfo, installName } from '../../lib/hosts.js'
import { PickSelects, Switch } from './controls.jsx'
import ExclusionsCard from './ExclusionsCard.jsx'

// What removing an install deletes, and what happens to its memory. Permanent, so it is an
// inline question with a memory disposition rather than a yes/no dialog: the choice of what
// happens to memory is part of the question.
function RemoveConfirm({ inst, memory, busy, onMemory, onRemove, onCancel }) {
  return (
    <div className="h-remove">
      <p className="hr-msg">
        <strong>
          {inst.scope === 'project'
            ? 'Remove this harness from the folder?'
            : `Remove the global ${inst.host} install?`}
        </strong>{' '}
        <span className="sub">
          Deletes <code>{removeLayer(inst.host, inst.scope)}</code>
          {inst.scope === 'project'
            ? ' and de-lists it.'
            : '; the row stays, marked “not installed.”'}{' '}
          This can’t be undone.
        </span>
      </p>
      <label className="field">
        <span>Memory and notebook</span>
        <select
          className="sel"
          aria-label="memory disposition"
          value={memory}
          onChange={(e) => onMemory(e.target.value)}
        >
          <option value="keep">keep in place</option>
          <option value="archive">archive aside</option>
          <option value="delete">delete too</option>
        </select>
      </label>
      <div className="row gap-8">
        <button type="button" className="btn danger" disabled={busy} onClick={onRemove}>
          {busy ? 'Removing…' : 'Remove'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// The MCP servers an active install's config already holds, read-only. Which servers to wire
// depends on the user and on the host, so this shows what is there and where the file lives;
// adding or switching one is an edit to that file, by hand.
function McpList({ targets, onReveal }) {
  const servers = targets.flatMap((t) => t.servers)
  return (
    <div className="ip-block">
      <span className="ip-label">
        MCP servers <span className="mono dim">{servers.length}</span>
      </span>
      {targets.map((t) => (
        <div className="mcp-target" key={t.path}>
          <div className="mt-head">
            <code title={t.path}>{t.label}</code>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => onReveal(t)}
              title={`Open the folder holding ${t.path} to edit it`}
            >
              Open folder
            </button>
          </div>
          {t.servers.length ? (
            t.servers.map((s) => (
              <div className="mcp-row" key={s.name}>
                <span className="mono">{s.name}</span>
                <span className={`tag ${s.state === 'enabled' ? 'ok' : 'warn'}`}>
                  {s.state === 'enabled' ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            ))
          ) : (
            <p className="sub">None configured in this file.</p>
          )}
        </div>
      ))}
    </div>
  )
}

const BADGE = {
  active: ['Active', 'ok'],
  disabled: ['Disabled', 'warn'],
  absent: ['Not installed', ''],
}

// The side panel for the install picked in the table: its build choices, its MCP wiring,
// and, set apart at the bottom, the one destructive act. Stateless: the Hosts tab owns the
// picks, the remove question and what is in flight, so switching rows never strands a
// half-made choice on the wrong install.
export default function InstallPanel({
  inst,
  targets,
  choice,
  unchanged,
  options,
  onPick,
  canAct,
  busy,
  removing,
  onRemoving,
  onApply,
  onToggleInstall,
  onRemove,
  onRevealMcp,
}) {
  const who = `${inst.host} · ${inst.scope}`
  const [label, tone] = BADGE[inst.state] || BADGE.absent
  const active = inst.state === 'active'
  const absent = inst.state === 'absent'
  return (
    <aside className="install-panel" aria-label={`${who} install`}>
      <span className="ip-eyebrow">Selected install</span>
      <div className="ip-head">
        <h2>{installName(inst)}</h2>
        <span className={`tag ${tone}`}>{label}</span>
      </div>
      <span className="ip-kind">
        {inst.scope === 'global'
          ? 'Global install'
          : `Per-project install · ${hostInfo(inst.host).label}`}
      </span>
      <code className="ip-path">{inst.path}</code>

      {absent ? (
        <p className="sub">
          Install Geneseed here as <strong>{inst.host}</strong>. Files are added non-destructively;
          deactivate or uninstall later.
        </p>
      ) : null}
      {(active || absent) && canAct ? (
        <div className="ip-picks">
          <PickSelects value={choice} options={options} onChange={onPick} who={who} />
        </div>
      ) : null}

      {active && targets.length ? <McpList targets={targets} onReveal={onRevealMcp} /> : null}
      {active && inst.scope === 'global' ? <ExclusionsCard /> : null}

      {!absent ? (
        <label className="ip-switch">
          <Switch
            on={active}
            disabled={busy}
            label={`activate ${who}`}
            onToggle={onToggleInstall}
          />
          <span>{active ? 'Active: loads in every session' : 'Disabled: files moved aside'}</span>
        </label>
      ) : null}

      <div className="ip-spacer" />
      {canAct ? (
        <div className="ip-actions">
          {absent ? (
            <button type="button" className="btn" onClick={onApply}>
              Install
            </button>
          ) : active ? (
            <button type="button" className="btn" disabled={unchanged} onClick={onApply}>
              Apply and rebuild
            </button>
          ) : null}
          {!absent ? (
            <button
              type="button"
              className="btn ghost danger-line"
              aria-label={`remove ${who} from ${inst.path}`}
              aria-expanded={!!removing}
              disabled={busy}
              onClick={() => onRemoving(removing ? null : { memory: 'keep' })}
            >
              Uninstall…
            </button>
          ) : null}
        </div>
      ) : null}
      {removing ? (
        <RemoveConfirm
          inst={inst}
          memory={removing.memory}
          busy={busy}
          onMemory={(memory) => onRemoving({ memory })}
          onRemove={onRemove}
          onCancel={() => onRemoving(null)}
        />
      ) : null}
    </aside>
  )
}
