import React from 'react'
import { promptPath } from '../lib/format.js'
import { Icon } from './Icon.jsx'
import Search from './Search.jsx'

// Route view -> the --tab flag the fake prompt displays.
const TAB_FLAG = {
  dashboard: 'overview',
  section: 'library',
  item: 'library',
  diff: 'diff',
  doctor: 'doctor',
  themes: 'themes',
  graph: 'graph',
  settings: 'settings',
}

// The top bar: a faux `geneseed --tab=…` prompt, the global search, the
// light/dark toggle, and the stop-server button (same /api/shutdown as
// `geneseed web stop` and the Settings → Server card).
export default function Topbar({
  route,
  target,
  query,
  onQuery,
  mode,
  onToggleMode,
  onShutdown,
}) {
  return (
    <div className="topbar">
      <div className="prompt">
        <span className="path">{promptPath(target)}</span>
        <span className="sep">$</span>
        <span className="cmd">geneseed</span>{' '}
        <span className="flag">--tab={TAB_FLAG[route.view] || route.view}</span>
        <span className="cur" />
      </div>
      <div className="topbar-spacer" />
      <Search value={query} onChange={onQuery} />
      <button
        className="iconbtn"
        title={mode === 'light' ? 'Switch to dark' : 'Switch to light'}
        onClick={onToggleMode}
      >
        <Icon name={mode === 'light' ? 'moon' : 'sun'} />
      </button>
      <button className="iconbtn" title="Stop server" onClick={onShutdown}>
        <Icon name="power" />
      </button>
    </div>
  )
}
