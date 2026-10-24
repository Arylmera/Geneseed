import React from 'react'
import PageHeader from '../../components/PageHeader.jsx'

// Side-by-side glossary: each invented term shown as the neutral word and the
// word your deployed theme actually substitutes, so the agent's vocabulary
// stays decodable to a newcomer.
export default function Glossary({ page }) {
  const rows = page.rows || []
  const theme = page.theme || 'neutral'
  return (
    <div className="detail-doc">
      <PageHeader
        title={page.title}
        sub={
          <>
            Geneseed&apos;s invented vocabulary, decoded. Left: the neutral, plain-English term.
            Right: the word your <code className="cap">{theme}</code> theme actually uses in the
            agent&apos;s voice. Last: the developer idea it maps to.
          </>
        }
      />
      <div className="card pad-md">
        <table className="glossary-table">
          <thead>
            <tr>
              <th>Concept</th>
              <th>Neutral term</th>
              <th>In {theme}</th>
              <th>Meaning</th>
              <th>In dev terms</th>
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
                <td className="dim">{r.analogy || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
