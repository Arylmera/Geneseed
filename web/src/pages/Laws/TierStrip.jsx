// The four tiers as one strip, in RANK order (lib/constitution.js PRECEDENCE, the Precedence
// table of AGENT.md): each with its count, a bar for how much of it is in force, a line on what
// the count means, and the one-line rule on how it stands against the rank above. The tier the
// table is showing is lit; your own rules live on the Personal page and link there.
//
// The two tiers the table can narrow to (invariants, doctrines) are buttons: the strip reads as
// the page's map, so a click on a cell shows that tier (`onPick`, the tab setter), and a click on
// the lit cell returns to All. They press like the tabs below them, so the two never disagree.
// Ethos is not a tab (it sits above them), so its cell stays plain.
const PICKABLE = ['invariants', 'doctrines']

export default function TierStrip({ tiers, current, onPick }) {
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
        const cls = `tier${current === t.key ? ' on' : ''}`
        if (t.href)
          return (
            <a key={t.key} className="tier" href={t.href}>
              {body}
            </a>
          )
        if (onPick && PICKABLE.includes(t.key))
          return (
            <button
              type="button"
              key={t.key}
              className={cls}
              aria-pressed={current === t.key}
              onClick={() => onPick(current === t.key ? 'all' : t.key)}
            >
              {body}
            </button>
          )
        return (
          <div key={t.key} className={cls}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
