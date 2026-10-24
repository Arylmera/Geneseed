import { Bar } from '../../components/StackBar.jsx'

// The aside's pack panel: each pack's share of its rules switched on, its switch, and the
// Revert for the staged selection (hooks/useRuleSelection.js). The Apply that rebuilds the
// install is the page's one primary action, so it lives in the page header (Laws.jsx), not here.
export default function PackPanel({ packs, sel, canApply, install, gateArmed }) {
  const { isOn, packOn, togglePack, dirty, losingConsent, revert } = sel
  const maxPack = Math.max(1, ...packs.map((p) => p.rules.length))
  return (
    <section className="panel" aria-labelledby="doc-packs">
      <div className="panel-head">
        <h2 id="doc-packs">Doctrine packs</h2>
        <span className="mono dim">
          {packs.filter(packOn).length}/{packs.length} on
        </span>
      </div>
      {packs.length ? (
        <ul className="pack-list">
          {packs.map((p) => {
            const on = p.rules.filter((r) => isOn(r.addr)).length
            return (
              <li key={p.pack} className={packOn(p) ? '' : 'off'}>
                <span className="pl-name" title={p.desc}>
                  {p.title}
                </span>
                <Bar value={on} max={maxPack} label={`${p.title} rules on`} />
                <span className="mono pl-n">{on}</span>
                {/* A tri-state checkbox, not a switch: ARIA's `switch` has no "mixed", and a
                    pack with some of its rules on is neither on nor off. */}
                {canApply ? (
                  <button
                    type="button"
                    className={`sw-toggle${packOn(p) ? ' on' : ''}${on && on < p.rules.length ? ' mixed' : ''}`}
                    role="checkbox"
                    aria-checked={
                      p.rules.length && on === p.rules.length ? 'true' : on ? 'mixed' : 'false'
                    }
                    aria-label={`${p.title} pack`}
                    onClick={() => togglePack(p)}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="sub">This install predates the three-tier constitution.</p>
      )}
      {canApply && packs.length > 0 && (
        <>
          {losingConsent && (
            <p className="pack-warn" role="status" aria-live="polite">
              Dropping <b>process 5</b> also removes the commit/push consent gate:{' '}
              <code>git commit</code> and <code>git push</code> stop being confirmed at the tool
              boundary.{' '}
              {gateArmed
                ? 'Real data loss stays gated by Rule IV.'
                : 'Rule IV’s deletion gate is off on this install too.'}
            </p>
          )}
          <div className="pack-apply">
            <button type="button" className="btn ghost" onClick={revert} disabled={!dirty}>
              Revert
            </button>
          </div>
          <p className="panel-note" role="status" aria-live="polite">
            {dirty
              ? `Not applied yet. Apply rebuilds ${install.host} · ${install.scope} once, ` +
                'with every change together.'
              : 'Matches the deployed install. Changing a pack rebuilds it.'}
          </p>
        </>
      )}
    </section>
  )
}
