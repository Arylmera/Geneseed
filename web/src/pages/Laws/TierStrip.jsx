// The four tiers as one strip, in RANK order (lib/constitution.js PRECEDENCE, the Precedence
// table of AGENT.md): each with its count, a bar for how much of it is in force, a line on what
// the count means, and the one-line rule on how it stands against the rank above. The tier the
// table is showing is lit; your own rules live on the Personal page and link there.
export default function TierStrip({ tiers, current }) {
  return (
    <div className="tier-strip">
      {tiers.map((t, i) => {
        const body = (
          <>
            <span className="tier-k mono">RANK {i + 1}</span>
            <span className="tier-top">
              <span className="tier-name">{t.name}</span>
              <span className="tier-n mono">{t.n}</span>
            </span>
            <span className="tier-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(t.fill * 100)}%` }} />
            </span>
            <span className="tier-sub">{t.sub}</span>
            <span className="tier-sub tier-rule">{t.rule}</span>
          </>
        )
        return t.href ? (
          <a key={t.key} className="tier" href={t.href}>
            {body}
          </a>
        ) : (
          <div key={t.key} className={`tier${current === t.key ? ' on' : ''}`}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
