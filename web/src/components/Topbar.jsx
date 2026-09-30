import React, { useState } from 'react'
import { promptPath } from '../lib/format.js'
import { Icon } from './Icon.jsx'
import Search from './Search.jsx'
import HarnessSelector from './HarnessSelector.jsx'
import AppearancePopover from './AppearancePopover.jsx'
import { PAGES, TAB_LABELS } from '../lib/router.js'

// The top bar: where you are (the install the console reads, then the page and its tab),
// the search box that doubles as the way to jump anywhere by name, and the two display
// controls: the appearance popover (skin and accent source) and light/dark.
export default function Topbar({
  route,
  navOpen,
  onToggleNav,
  overview,
  installs,
  query,
  onQuery,
  mode,
  onToggleMode,
  appearance,
  dataRev,
  onSwitch,
}) {
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const inst = overview?.install
  const where = inst ? `${inst.host}:${inst.scope}` : promptPath(overview?.target)
  const tab = route.tab && TAB_LABELS[route.tab]
  return (
    <header className="topbar">
      {/* Phone-width drawer toggle. CSS hides it above 720px, where the sidebar is
          permanently on screen and there is nothing to toggle. */}
      <button
        type="button"
        className="tb-menu iconbtn"
        onClick={onToggleNav}
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={!!navOpen}
        aria-controls="rail-nav"
      >
        <Icon name={navOpen ? 'x' : 'menu'} />
      </button>
      <nav className="crumbs" aria-label="Breadcrumb">
        <span className="crumb-root mono" title={overview?.target || undefined}>
          {where}
        </span>
        <span aria-hidden="true">/</span>
        <span className={tab ? '' : 'crumb-here'} aria-current={tab ? undefined : 'page'}>
          {PAGES[route.page]}
        </span>
        {tab ? (
          <>
            <span aria-hidden="true">/</span>
            <span className="crumb-here" aria-current="page">
              {tab}
            </span>
          </>
        ) : null}
      </nav>
      <div className="topbar-spacer" />
      <HarnessSelector installs={installs} onSwitch={onSwitch} />
      <Search value={query} onChange={onQuery} dataRev={dataRev} />
      <div className="tb-pop-anchor">
        <button
          type="button"
          className="iconbtn"
          aria-label="Appearance"
          title="Appearance"
          aria-expanded={appearanceOpen}
          onClick={() => setAppearanceOpen((v) => !v)}
        >
          <Icon name="themes" />
        </button>
        {appearanceOpen ? (
          <AppearancePopover {...appearance} onClose={() => setAppearanceOpen(false)} />
        ) : null}
      </div>
      {/* Icon-only: `title` is a hover hint sighted mouse users get, so it also carries an
          aria-label; the Icon SVGs are aria-hidden and name nothing. */}
      <button
        type="button"
        className="iconbtn"
        title={mode === 'light' ? 'Switch to dark' : 'Switch to light'}
        aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        onClick={onToggleMode}
      >
        <Icon name={mode === 'light' ? 'moon' : 'sun'} />
      </button>
    </header>
  )
}
