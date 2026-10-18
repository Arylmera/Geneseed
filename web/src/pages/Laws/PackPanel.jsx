// The aside's pack panel: each pack's share of its rules switched on, its switch, and the one
// Apply that rebuilds the install with the staged selection (hooks/useRuleSelection.js).
export default function PackPanel({ packs, sel, canApply, install, gateArmed }) {
  const {
    isOn,
    packOn,
    togglePack,
    allRules,
    pickedRules,
    dirty,
    losingConsent,
    applyPacks,
    revert,
  } = sel
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
                <span className="hbar" aria-hidden="true">
                  <span style={{ width: `${(on / maxPack) * 100}%` }} />
                </span>
                <span className="mono pl-n">{on}</span>
                {canApply ? (
                  <button
                    type="button"
                    className={`sw-toggle${packOn(p) ? ' on' : ''}`}
                    role="switch"
                    aria-checked={packOn(p)}
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
            <button type="button" className="btn" onClick={applyPacks} disabled={!dirty}>
              Apply{dirty ? ` (${pickedRules.length}/${allRules.length} rules)` : ''}
            </button>
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
