import React from 'react'
import { go } from '../../lib/router.js'
import { editCount } from '../../lib/format.js'

// One readout band instead of four identical metric cards. The three roster
// counts are links into their ledgers; local edits — the only number that asks
// for action — sits apart on the right with its delta and a route to the diff.
export default function KpiStrip({ overview }) {
  const edits = editCount(overview.diff)
  const counts = overview.counts || {}
  const segs = [
    { key: 'agents', label: 'Agents', hash: '#/agents' },
    { key: 'skills', label: 'Skills', hash: '#/skills' },
    { key: 'laws', label: 'Laws', hash: '#/laws' },
  ]
  return (
    <div className="card kpiband rise mb-16">
      {segs.map((s) => {
        const val = counts[s.key]
        return (
          <a className="kseg" key={s.key} href={s.hash} title={`Open ${s.label}`}>
            <span className={'kseg-n' + (val === 0 ? ' zero' : '')}>{val ?? '—'}</span>
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
        <span className={'kseg-n' + (edits === 0 ? ' zero' : '')}>{edits}</span>
        <span className="kseg-l">Local edits</span>
        {edits > 0 && <span className="delta up">&#9650;</span>}
      </button>
    </div>
  )
}
