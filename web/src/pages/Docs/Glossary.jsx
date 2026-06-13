import React from 'react'

// Side-by-side glossary: each invented term shown as the neutral word and the
// word your deployed theme actually substitutes, so the agent's vocabulary
// stays decodable to a newcomer.
export default function Glossary({ page }) {
  const rows = page.rows || []
  const theme = page.theme || 'neutral'
  return (
    <div className="detail-doc">
      <span className="eyebrow">glossary</span>
      <h1 style={{ marginTop: 10 }}>{page.title}</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        Geneseed&apos;s invented vocabulary, decoded. Left: the neutral, plain-English term. Right:
        the word your <code style={{ textTransform: 'capitalize' }}>{theme}</code> theme actually
        uses in the agent&apos;s voice.
      </p>
      <div className="card pad-md" style={{ marginTop: 18 }}>
        <table className="glossary-table">
          <thead>
            <tr>
              <th>Concept</th>
              <th>Neutral term</th>
              <th>In {theme}</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>
                  <strong>{r.label}</strong>
                </td>
                <td>
                  <code>{r.neutral || '—'}</code>
                </td>
                <td>
                  <code>{r.themed || r.neutral || '—'}</code>
                </td>
                <td className="dim">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
