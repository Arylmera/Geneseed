import { gateAddress } from '../../lib/constitution.js'
import { Bar } from '../../components/StackBar.jsx'

// How often each hook gate stopped to ask, from the gate ledger (`setup.gates`). The ledger
// keys by gate id (`process-5`); lib/constitution.js turns that into the rule's address,
// and the catalog names it.
//
// `disarmed(addr)` is true for a gate this install switched off (Laws.jsx, GATE_SWITCH only).
// Its past asks stay in the ledger, but it asks nothing now: it sorts after every armed gate,
// reads "off", and its bar drops the warning colour.
export default function GateAsks({ gates, byAddr, onJump, disarmed = () => false }) {
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
      {asks.length ? (
        <ul className="gate-list">
          {asks.map(([gate, n, off]) => {
            const addr = gateAddress(gate)
            const name = byAddr[addr]?.name || addr
            return (
              <li key={gate}>
                {/* The entry's text is the control: it takes you to the rule in the table. The
                    bar is its sibling, not inside it: Bar renders a div and a list, which a
                    button may not contain. */}
                <button type="button" className="gate-row" onClick={() => onJump(addr)}>
                  <span className="gate-top">
                    <span className={`gate-name${off ? ' dim' : ''}`}>{name}</span>
                    <span className="mono dim">{addr}</span>
                    {off && <span className="mono off">off</span>}
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
