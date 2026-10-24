import React from 'react'
import { go } from '../../lib/router.js'
import { editCount } from '../../lib/format.js'
import { CountUp } from '../../lib/motion.js'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'

// One readout band instead of four identical metric cards. The three roster
// counts are links into their ledgers; local edits — the only number that asks
// for action — sits apart on the right with its delta and a route to the diff.
export default function KpiStrip({ overview, dataRev }) {
  // Same key and deps as ConstitutionMap's fetch, so the two share one request. The
  // `Promise.resolve().then` lets a missing api function (a test mock) fail this fetch alone.
  // No `.catch` to null: useAsync caches what resolves, so a null would be served to the
  // map and the Laws page under the shared key; a rejection lands as `error`, never cached.
  const { data } = useAsync(
    () => Promise.resolve().then(() => api.catalog('laws')),
    [dataRev],
    'catalog:laws',
  )
  const edits = editCount(overview.diff)
  const counts = overview.counts || {}
  const segs = [
    { key: 'agents', label: 'Agents', hash: '#/agents' },
    { key: 'skills', label: 'Skills', hash: '#/skills' },
    // The value is `counts.laws`, which is the INVARIANT count — so the label says so. Calling
    // the tile "Constitution" over a 9 would under-report the ontology and the packs by 27.
    // The noun is the theme's own (the catalogue's `nouns.laws`), as on the Laws page.
    { key: 'laws', label: data?.nouns?.laws || 'Dictates', hash: '#/laws' },
  ]
  return (
    <div className="card kpiband rise mb-16">
      {segs.map((s) => {
        const val = counts[s.key]
        return (
          <a className="kseg" key={s.key} href={s.hash} title={`Open ${s.label}`}>
            <span className={'kseg-n' + (val === 0 ? ' zero' : '')}>
              {val == null ? '—' : <CountUp value={val} />}
            </span>
            <span className="kseg-l">{s.label}</span>
          </a>
        )
      })}
      <div className="kseg-spacer" />
      <button
        className={'kseg' + (edits > 0 ? ' hot' : '')}
        onClick={() => go('#/diff')}
        title="Open changes"
      >
        <span className={'kseg-n' + (edits === 0 ? ' zero' : '')}>
          <CountUp value={edits} />
        </span>
        <span className="kseg-l">Local edits</span>
        {edits > 0 && <span className="delta up">&#9650;</span>}
      </button>
    </div>
  )
}
