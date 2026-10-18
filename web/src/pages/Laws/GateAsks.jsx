import { gateAddress } from '../../lib/constitution.js'

// How often each hook gate stopped to ask, from the gate ledger (`setup.gates`). The ledger
// keys by gate id (`process-5`); lib/constitution.js turns that into the rule's address,
// and the catalog names it.
export default function GateAsks({ gates, byAddr, onJump }) {
  const asks = Object.entries(gates?.asks || {}).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...asks.map(([, n]) => n))
  return (
    <section className="panel" aria-labelledby="gate-asks">
      <div className="panel-head">
        <h2 id="gate-asks">Gate asks</h2>
        <span className="mono dim">{gates?.total ?? 0} in ledger</span>
      </div>
      {asks.length ? (
        <ul className="gate-list">
          {asks.map(([gate, n]) => {
            const addr = gateAddress(gate)
            return (
              <li key={gate}>
                {/* The whole entry is the control: it takes you to the rule in the table. */}
                <button type="button" className="gate-row" onClick={() => onJump(addr)}>
                  <span className="gate-top">
                    <span className="gate-name">{byAddr[addr]?.name || addr}</span>
                    <span className="mono dim">{addr}</span>
                    <span className="mono gate-n">{n}</span>
                  </span>
                  <span className="hbar warn" aria-hidden="true">
                    <span style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                </button>
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
