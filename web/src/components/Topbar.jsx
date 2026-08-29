import React from 'react'
import { promptPath } from '../lib/format.js'
import { Icon } from './Icon.jsx'
import Search from './Search.jsx'
import HarnessSelector from './HarnessSelector.jsx'

// Route view -> the --tab flag the fake prompt displays.
const TAB_FLAG = {
  dashboard: 'overview',
  diff: 'diff',
  doctor: 'doctor',
  harness: 'harness',
  settings: 'settings',
}

// Laws and Skills own their section/item routes, so the breadcrumb names them
// instead of 'library' — matching which rail tab actually lights up.
function tabFlag(route) {
  if (route.view === 'section')
    return ['laws', 'skills'].includes(route.section) ? route.section : 'library'
  if (route.view === 'item')
    return route.type === 'law' ? 'laws' : route.type === 'skill' ? 'skills' : 'library'
  return TAB_FLAG[route.view] || route.view
}

// The top bar: a faux `geneseed --tab=…` prompt, the global search, the
// light/dark toggle, and the stop-server button (same /api/shutdown as
// `geneseed web stop` and the Settings → Server card).
export default function Topbar({
  route,
  navOpen,
  onToggleNav,
  target,
  version,
  query,
  onQuery,
  mode,
  onToggleMode,
  onShutdown,
  dataRev,
  onSwitch,
}) {
  return (
    <header className="topbar">
      {/* Phone-width drawer toggle. CSS hides it above 720px, where the rail is
          permanently on screen and there is nothing to toggle. */}
      <button
        className="tb-menu"
        onClick={onToggleNav}
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={!!navOpen}
        aria-controls="rail-nav"
      >
        <Icon name={navOpen ? 'x' : 'menu'} />
      </button>
      <div className="prompt">
        <span className="path">{promptPath(target)}</span>
        <span className="sep">$</span>
        <span className="cmd">geneseed</span> <span className="flag">--tab={tabFlag(route)}</span>
        {/* Dimmed, and dropped entirely when the server could not read a label — a prompt that
            says --version= with nothing after it reads as a bug in the tool. */}
        {version && <span className="flag ver"> --version={version}</span>}
        <span className="cur" />
      </div>
      <div className="topbar-spacer" />
      <HarnessSelector dataRev={dataRev} onSwitch={onSwitch} />
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
    </header>
  )
}
