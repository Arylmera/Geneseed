// The four tiers as one strip: each with its count, a bar for how much of it is in force,
// and a line on what the count means. The tier the table is showing is lit; the fourth
// (your own rules) lives on the Personal page and links there.
export default function TierStrip({ tiers, current }) {
  return (
    <div className="tier-strip">
      {tiers.map((t, i) => {
        const body = (
          <>
            <span className="tier-k mono">TIER {i + 1}</span>
            <span className="tier-top">
              <span className="tier-name">{t.name}</span>
              <span className="tier-n mono">{t.n}</span>
            </span>
            <span className="tier-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(t.fill * 100)}%` }} />
            </span>
            <span className="tier-sub">{t.sub}</span>
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
