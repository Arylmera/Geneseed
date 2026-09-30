import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { removeLayer } from '../../lib/hosts.js'
import { PickSelects, Switch } from './controls.jsx'

// The stepped disclosure under an absent row. The host is already decided — it is the row
// you opened — so the steps are the four choices that remain, in the order the install
// actually consumes them. Same `install` action, same payload as the inline lane it
// replaced; only the moment you are asked has moved.
function InstallWizard({ inst, choice, options, onPick, onInstall, onCancel }) {
  return (
    <tr className="h-detail-row h-setup-row">
      <td />
      <td colSpan={5} className="h-detail">
        <div className="h-setup">
          <p className="sub hs-msg">
            Install Geneseed into <code>{inst.path}</code> as <strong>{inst.host}</strong>. Files
            are added non-destructively; deactivate or uninstall later.
          </p>
          <div className="hs-steps">
            <PickSelects
              layout="steps"
              value={choice}
              options={options}
              onChange={onPick}
              who={`${inst.host} · ${inst.scope}`}
            />
          </div>
          <div className="hr-acts">
            <button className="btn sm" onClick={onInstall}>
              Install
            </button>
            <button className="btn ghost sm" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// The trash icon's confirm sub-row. Permanent, so it is a sub-row with a memory
// disposition rather than a yes/no dialog — the choice of what happens to memory is part
// of the question.
function RemoveConfirm({ inst, memory, busy, onMemory, onRemove, onCancel }) {
  return (
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
              value={memory}
              onChange={(e) => onMemory(e.target.value)}
            >
              <option value="keep">keep in place</option>
              <option value="archive">archive aside</option>
              <option value="delete">delete too</option>
            </select>
          </label>
          <div className="hr-acts">
            <button className="btn sm hr-go" disabled={busy} onClick={onRemove}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
            <button className="btn ghost sm" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// The MCP servers wired into an active install, as a detail row under it.
function McpPanel({ targets, mcpBusy, onReveal, onToggle }) {
  return (
    <tr className="h-detail-row">
      <td />
      <td colSpan={5} className="h-detail">
        {targets.map((t) => (
          <div className="mcp-target" key={t.path}>
            <div className="mt-head">
              {t.label} · <code>{t.path}</code>
              <button
                className="btn ghost sm"
                onClick={() => onReveal(t)}
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
                      onToggle={() => onToggle(t, s)}
                    />
                  ) : s.preset ? (
                    <button
                      className="btn ghost sm"
                      disabled={isDisabled}
                      onClick={() => onToggle(t, s)}
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
  )
}

// One install row + its (conditional) install-wizard, remove-confirm and MCP-detail
// sub-rows. Stateless: the page owns every piece of per-row state (the picks, which
// wizard or remove-confirm is open, what is in flight), because only one wizard and one
// remove-confirm may be open across the whole table at a time.
//
// `choice` is the row's resolved { theme, footprint, posture, mode }; `unchanged` whether
// it still matches what is deployed (an active row's Apply stays disabled until not).
export default function InstallRow({
  inst,
  targets,
  expanded,
  onToggleExpanded,
  choice,
  unchanged,
  options,
  onPick,
  canAct,
  busy,
  mcpBusy,
  wizardOpen,
  onWizard,
  removing,
  onRemoving,
  onApply,
  onToggleInstall,
  onRemove,
  onRevealMcp,
  onToggleMcp,
}) {
  const on = inst.state === 'active'
  const hasMcp = targets.length > 0
  const open = hasMcp && expanded
  const enabled = targets.reduce(
    (n, t) => n + t.servers.filter((s) => s.state === 'enabled').length,
    0,
  )
  const who = `${inst.host} · ${inst.scope}`
  const badge = on ? 'active' : inst.state === 'disabled' ? 'disabled' : 'not installed'
  return (
    <>
      <tr>
        <td className="h-exp-cell">
          {hasMcp ? (
            <button
              className="h-exp"
              aria-expanded={open}
              aria-label={`${open ? 'collapse' : 'expand'} MCP for ${who}`}
              onClick={onToggleExpanded}
            >
              <Icon name="chevron" className={`glyph${open ? ' open' : ''}`} />
            </button>
          ) : null}
        </td>
        <td>
          <span className="name">{who}</span>
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
            <PickSelects
              layout="lanes"
              hidden={!(on && canAct)}
              value={choice}
              options={options}
              onChange={onPick}
              who={who}
            />
            <div className="ha-cell ha-btn">
              {inst.state === 'absent' && canAct ? (
                <button className="btn ghost sm" aria-expanded={wizardOpen} onClick={onWizard}>
                  Install…
                </button>
              ) : on && canAct ? (
                <button className="btn ghost sm" disabled={unchanged} onClick={onApply}>
                  Apply
                </button>
              ) : null}
            </div>
            <div className="ha-cell ha-sw">
              {inst.state !== 'absent' ? (
                <Switch
                  on={on}
                  disabled={busy}
                  label={`activate ${who}`}
                  onToggle={onToggleInstall}
                />
              ) : null}
            </div>
            <div className="ha-cell ha-trash">
              {inst.state !== 'absent' && canAct ? (
                <button
                  className="btn ghost sm h-trash"
                  aria-label={`remove ${who} from ${inst.path}`}
                  title="Remove this harness"
                  disabled={busy}
                  onClick={() => onRemoving(removing ? null : { memory: 'keep' })}
                >
                  <Icon name="clear" />
                </button>
              ) : null}
            </div>
          </div>
        </td>
      </tr>
      {inst.state === 'absent' && wizardOpen ? (
        <InstallWizard
          inst={inst}
          choice={choice}
          options={options}
          onPick={onPick}
          onInstall={onApply}
          onCancel={onWizard}
        />
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
      {open ? (
        <McpPanel
          targets={targets}
          mcpBusy={mcpBusy}
          onReveal={onRevealMcp}
          onToggle={onToggleMcp}
        />
      ) : null}
    </>
  )
}
