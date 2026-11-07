import { gateAddress, gateFallback } from '../../lib/constitution.js'
import { dotColour, installTag } from '../../lib/hosts.js'
import { Bar } from '../../components/StackBar.jsx'

// How often each hook gate stopped to ask, from the gate ledger (`setup.gates`). The ledger
// keys by gate id (`process-5`); lib/constitution.js turns that into the rule's address,
// and the catalog names it.
//
// `disarmed(addr)` is true for a gate this install switched off (Laws.jsx, GATE_SWITCH only).
// Its past asks stay in the ledger, but it asks nothing now: it sorts after every armed gate,
// reads "off", and its bar drops the warning colour. The ledger counts every install's asks but the
// switch is ONE install's (`install`, {host, scope}), so a dot (the Library's) marks the row and one
// legend names that install once; the row keeps "off" and a screen-reader name for the install.
// `slot` is the install's place in the install list (lib/hosts.js fleetSlots), so its dot has the
// Library's colour; below zero (the pick is not in the list) there is no colour, so no dot.
export default function GateAsks({
  gates,
  byAddr,
  onJump,
  disarmed = () => false,
  install = null,
  slot = 0,
}) {
  const tag = install ? installTag(install) : ''
  const asks = Object.entries(gates?.asks || {})
    .map(([gate, n]) => [gate, n, disarmed(gateAddress(gate))])
    .sort((a, b) => a[2] - b[2] || b[1] - a[1])
  const max = Math.max(1, ...asks.map(([, n]) => n))
  return (
    <section className="panel" aria-labelledby="gate-asks">
      <div className="panel-head">
        <h2 id="gate-asks">Gate asks</h2>
        <span className="mono dim">{gates?.total ?? 0} in ledger</span>
      </div>
      {install && asks.some((a) => a[2]) && (
        <span className="lib-legend mono">
          <span>
            {slot >= 0 && <i className="lr-dot" style={dotColour(slot)} aria-hidden="true" />}
            {tag}
          </span>
        </span>
      )}
      {asks.length ? (
        <ul className="gate-list">
          {asks.map(([gate, n, off]) => {
            const addr = gateAddress(gate)
            const name = byAddr[addr]?.name || gateFallback(addr)
            return (
              <li key={gate}>
                {/* The entry's text is the control: it takes you to the rule in the table. The
                    bar is its sibling, not inside it: Bar renders a div and a list, which a
                    button may not contain. */}
                <button type="button" className="gate-row" onClick={() => onJump(addr)}>
                  <span className="gate-top">
                    <span className={`gate-name${off ? ' dim' : ''}`}>{name}</span>
                    {off && (
                      <span className="mono off">
                        {install && slot >= 0 && (
                          <i className="lr-dot" style={dotColour(slot)} aria-hidden="true" />
                        )}
                        off{install && <span className="sr-only"> · {tag}</span>}
                      </span>
                    )}
                    <span className="mono gate-n">{n}</span>
                  </span>
                </button>
                <Bar value={n} max={max} label={`${name} asks`} tone={off ? 'accent' : 'warn'} />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="sub">No gate has asked yet.</p>
      )}
      <p className="panel-note">
        {gates?.standing_down?.length
          ? `Standing down: ${gates.standing_down.join(', ')}.`
          : 'None standing down.'}
      </p>
    </section>
  )
}
