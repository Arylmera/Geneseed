import React from 'react'
import { hostInfo, installName } from '../../lib/hosts.js'
import { PickSelects, Switch } from './controls.jsx'
import ExclusionsCard from './ExclusionsCard.jsx'

// The MCP servers an active install's config already holds, read-only. Which servers to wire
// depends on the user and on the host, so this shows what is there and where the file lives;
// adding or switching one is an edit to that file, by hand. A file not written yet has
// nothing to edit, so it is named, with no folder to open.
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
            {t.exists ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => onReveal(t)}
                aria-label={`Open the folder holding ${t.label}`}
                title={`Open the folder holding ${t.path} to edit it`}
              >
                Open folder
              </button>
            ) : null}
          </div>
          {!t.exists ? (
            <p className="sub">
              No MCP file yet (it would be <code>{t.path}</code>).
            </p>
          ) : t.servers.length ? (
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
// picks, the memory disposition and what is in flight, so switching rows never strands a
// half-made choice on the wrong install. The disposition sits beside Uninstall… because it
// is part of what that act does; the danger confirm then names what it deletes.
export default function InstallPanel({
  inst,
  targets,
  choice,
  unchanged,
  options,
  onPick,
  canAct,
  busy,
  memory,
  onMemory,
  onApply,
  onToggleInstall,
  onRemove,
  onRevealMcp,
}) {
  const who = `${hostInfo(inst.host).label} · ${inst.scope}`
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
          Install Geneseed here as <strong>{hostInfo(inst.host).label}</strong>. Files are added
          non-destructively; deactivate or uninstall later.
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
            <>
              <label className="field">
                <span>On uninstall, memory and notebook</span>
                <select className="sel" value={memory} onChange={(e) => onMemory(e.target.value)}>
                  <option value="keep">keep in place</option>
                  <option value="archive">archive aside</option>
                  <option value="delete">delete too</option>
                </select>
              </label>
              <button
                type="button"
                className="btn ghost danger-line"
                aria-label={`remove ${who} from ${inst.path}`}
                disabled={busy}
                onClick={onRemove}
              >
                Uninstall…
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
