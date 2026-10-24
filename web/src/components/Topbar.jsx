import React, { useRef, useState } from 'react'
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
  const apRef = useRef(null)
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
      {/* An ordered list, like PageHeader's crumbs: every level above the current one links
          back to it. The separators are CSS (`li + li::before`), not text. */}
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li className="crumb-root mono">
            <a href="#/installs" title={overview?.target || undefined}>
              {where}
            </a>
          </li>
          <li>
            {tab ? (
              <a href={route.page === 'overview' ? '#/' : `#/${route.page}`}>{PAGES[route.page]}</a>
            ) : (
              <span className="crumb-here" aria-current="page">
                {PAGES[route.page]}
              </span>
            )}
          </li>
          {tab ? (
            <li>
              <span className="crumb-here" aria-current="page">
                {tab}
              </span>
            </li>
          ) : null}
        </ol>
      </nav>
      <div className="topbar-spacer" />
      <HarnessSelector installs={installs} onSwitch={onSwitch} />
      <Search value={query} onChange={onQuery} dataRev={dataRev} />
      <button
        type="button"
        className="iconbtn"
        ref={apRef}
        aria-label="Appearance"
        title="Appearance"
        aria-expanded={appearanceOpen}
        onClick={() => setAppearanceOpen((v) => !v)}
      >
        <Icon name="themes" />
      </button>
      {appearanceOpen ? (
        <AppearancePopover
          {...appearance}
          anchorRef={apRef}
          onClose={() => setAppearanceOpen(false)}
        />
      ) : null}
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
