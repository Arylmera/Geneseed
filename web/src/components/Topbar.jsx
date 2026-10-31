import React, { useRef, useState } from 'react'
import { Icon } from './Icon.jsx'
import Search from './Search.jsx'
import AppearancePopover from './AppearancePopover.jsx'
import { PAGES, TAB_LABELS } from '../lib/router.js'

// The top bar: where you are (the page and its tab — no install: there is no console-wide one,
// each page that acts on one install picks it beside what it applies to),
// the command palette's trigger (search, jump anywhere by name, run an action), and the two display
// controls: the appearance popover (skin and accent source) and light/dark.
export default function Topbar({
  route,
  navOpen,
  onToggleNav,
  actions,
  mode,
  onToggleMode,
  appearance,
  dataRev,
}) {
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const apRef = useRef(null)
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
      <Search actions={actions} dataRev={dataRev} />
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
