import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { Icon } from '../components/Icon.jsx'
import { SECTIONS, LIBRARY_ORDER } from '../lib/sections.js'
import { useAsync } from '../hooks/useAsync.js'
import Markdown from '../components/Markdown.jsx'
import ErrorState from '../components/ErrorState.jsx'

// The on-disk source path for a given (section, name). Surface text for the
// "source" meta line in the detail pane — purely informational, doesn't drive
// any fetching.
function libSource(sec, name) {
  if (sec === 'agents' || sec === 'skills') return `${sec}/${name}.md`
  if (sec === 'memory') return `memory/${name}`
  if (sec === 'notebook') return `notebook/${name}`
  if (sec === 'wiki') return `wiki.jsonc`
  if (sec === 'config') return name
  return `${sec}/${name}.md`
}

// One row in the master list. Plain button so keyboard focus works without
// extra plumbing; the active state is purely className-driven.
function LibRow({ item, isOpen, onOpen }) {
  return (
    <button className={`lib-row ${isOpen ? 'on' : ''}`} onClick={onOpen}>
      <div className="lr-name">{item.title || item.name}</div>
      {item.desc ? <div className="lr-desc">{item.desc}</div> : null}
    </button>
  )
}

// Empty state for sections whose entries are conventions without per-entry
// docs (wiki, config). Keeps the source path visible so users still learn
// where the content lives.
function EmptyDoc({ section, source }) {
  return (
    <div className="lib-doc-empty">
      <Icon name={SECTIONS[section].icon} className="glyph" />
      <span>
        This entry is part of the {SECTIONS[section].label.toLowerCase()} convention; see{' '}
        <code className="mono">{source}</code>. It has no standalone per-entry document.
      </span>
    </div>
  )
}

// Library — single page with a section chip-bar, master list, and detail
// pane that inlines the item's Markdown. Replaces the prior card-grid landing
// + separate Section drilldown so the design's "browse everything from one
// place" pattern works. Routing is preserved:
//   #/library         → chip bar opens on the first section
//   #/section/<sec>   → chip pre-selected
//   #/item/<t>/<name> → chip + row pre-selected
//
// Selecting a row pushes the matching #/item/.../<name> URL so deep-linking
// keeps working from the search spotlight and the Graph.
export default function Library({ overview, section, selected, dataRev }) {
  const initialSec = section && SECTIONS[section] ? section : LIBRARY_ORDER[0]
  const [sec, setSec] = useState(initialSec)
  const [q, setQ] = useState('')
  const rowsRef = useRef(null)

  // Sync sec from prop whenever the route hands us a different section, and drop
  // any filter text so it doesn't carry across sections.
  useEffect(() => {
    if (section && SECTIONS[section] && section !== sec) {
      setSec(section)
      setQ('')
    }
  }, [section]) // eslint-disable-line react-hooks/exhaustive-deps

  const {
    data: catalog,
    error: catErr,
    reload: reloadCatalog,
  } = useAsync(() => api.catalog(sec), [sec, dataRev])

  // useAsync keeps the prior section's catalog in `data` while the new one is
  // in flight (so the list doesn't flash empty). Guard against that staleness:
  // only treat the loaded catalog as current when its `section` matches `sec`.
  // Otherwise the first row below would be the *previous* section's first item
  // (e.g. agent `advocate`, skill `brainstorm`), and the detail fetch would ask
  // for it under the new section's type — a guaranteed NotFound flash on every
  // tab switch.
  const items = catalog?.section === sec ? catalog?.items || [] : []
  // The entry whose document we display: the URL-selected item, or the first
  // row when the section was opened without an explicit selection (e.g. after
  // switching tabs). Auto-picking the first row keeps the highlighted row and
  // the detail pane in sync instead of showing a generic fallback.
  const activeName = selected || items[0]?.name || null
  const { data: item, error: itemErr } = useAsync(
    () => (activeName ? api.item(SECTIONS[sec].type, activeName) : Promise.resolve(null)),
    [sec, activeName, dataRev],
  )

  const err = catErr || itemErr
  // Prefer the catalog row; fall back to a synthetic row when the URL names
  // an item that isn't in the listing (e.g. a fresh deep-link before the
  // catalog finishes).
  const fromCatalog = activeName ? items.find((it) => it.name === activeName) : null
  const synthetic = activeName
    ? { name: activeName, title: item?.title || activeName, desc: item?.desc || '' }
    : null
  const activeItem = fromCatalog || synthetic
  const counts = overview?.counts || {}

  // Render-cap the list so a big section (a wiki vault is the case that bites)
  // doesn't paint hundreds of rows. With no filter we show the first 50; typing
  // searches the full client-side list by title/name/path. The active item is
  // always kept in view so a deep-link past row 50 still highlights.
  const CAP = 50
  const ql = q.trim().toLowerCase()
  const matches = ql
    ? items.filter((it) =>
        `${it.title || ''} ${it.name || ''} ${it.desc || ''}`.toLowerCase().includes(ql),
      )
    : items.slice(0, CAP)
  const shown =
    !ql && activeName && !matches.some((it) => it.name === activeName)
      ? [...matches, ...items.filter((it) => it.name === activeName)]
      : matches

  // Keep the active row in view inside the master scroller without using
  // scrollIntoView (which would also scroll the page). Only re-center when
  // the row is GENUINELY off-screen — clicking a row that's already visible
  // shouldn't move the list under the user's cursor; that auto-re-centering
  // was making the just-clicked agent vanish below the fold.
  useEffect(() => {
    const el = rowsRef.current?.querySelector('.lib-row.on')
    const box = rowsRef.current
    if (!el || !box) return
    const elTop = el.offsetTop
    const elBottom = elTop + el.clientHeight
    const viewTop = box.scrollTop
    const viewBottom = viewTop + box.clientHeight
    // Fully visible already → leave the scroll position alone.
    if (elTop >= viewTop && elBottom <= viewBottom) return
    // Otherwise (deep-link from Graph/Spotlight, or section switch) center it.
    box.scrollTop = Math.max(0, elTop - box.clientHeight / 2 + el.clientHeight / 2)
  }, [sec, selected])

  const openItem = (name) => go(`#/item/${SECTIONS[sec].type}/${encodeURIComponent(name)}`)
  const switchSection = (k) => go(`#/section/${k}`)
  // Agents has its own top-level tab (#/agents), like Laws and Skills: the page
  // reuses this master-detail view locked to the agents section, chip-bar hidden.
  const standalone = sec === 'agents'

  const onForget = async () => {
    const name = activeItem?.name
    if (!name) return
    if (
      !window.confirm(
        `Forget the memory fact "${name}"? It is deleted from the store and the index.`,
      )
    )
      return
    try {
      await api.memoryDelete(name)
    } catch {
      // surface via reload, if any
    }
    go('#/section/memory')
    reloadCatalog()
  }

  // Promote a memory fact into a standing trial rule in user-rules.md — the web
  // twin of the rule skill's memory→rule flow. The fact is deleted after the
  // promotion (the rule supersedes it; keeping both would load the lesson twice),
  // which is why the confirm spells that out. Lands on the Rules page so the new
  // trial rule is immediately visible and editable.
  const onPromote = async () => {
    const name = activeItem?.name
    if (!name) return
    if (
      !window.confirm(
        `Promote "${name}" into a standing rule? It is appended to user-rules.md as a trial rule (a month of probation), and the memory fact is deleted so the lesson isn't loaded twice.`,
      )
    )
      return
    try {
      const cur = await api.rules()
      await api.rulesPromote({ name, fingerprint: cur.fingerprint, delete_memory: true })
      go('#/rules')
    } catch (e) {
      window.alert(`Could not promote: ${e.message}`)
      reloadCatalog()
    }
  }

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">harness content</div>
          <h1 className="h">{standalone ? 'Agents' : 'Library'}</h1>
          <p className="sub">
            {standalone
              ? 'The capability specialists deployed in the harness. Pick one to read its charter, straight from the source file.'
              : 'Browse every layer of the deployed harness from one place. Pick a section, then read an entry; the markdown comes straight from the source file.'}
          </p>
        </div>
      </div>
      {standalone ? null : (
        <div className="lib-secbar">
          {LIBRARY_ORDER.map((k) => {
            const meta = SECTIONS[k]
            const n = counts[k] ?? null
            return (
              <button
                key={k}
                className={`lib-secchip ${sec === k ? 'on' : ''}`}
                onClick={() => switchSection(k)}
              >
                <Icon name={meta.icon} className="glyph" />
                <span>{meta.label}</span>
                {n != null && <span className="lib-secchip-n">{n}</span>}
              </button>
            )
          })}
        </div>
      )}

      {err ? <ErrorState error={err} style={{ margin: '12px 0' }} /> : null}

      <div className="lib lib-2">
        <div className="card lib-main">
          <div className="lib-head">
            <span className="lib-head-label">{SECTIONS[sec].label}</span>
            <span className="lib-head-count">
              {ql ? `${matches.length} of ${items.length}` : `${items.length} items`}
            </span>
          </div>
          <input
            className="lib-filter"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${SECTIONS[sec].label.toLowerCase()}…`}
            aria-label={`Filter ${SECTIONS[sec].label}`}
          />
          <div className="lib-rows" ref={rowsRef}>
            {shown.map((it) => (
              <LibRow
                key={it.name}
                item={it}
                isOpen={activeItem?.name === it.name}
                onOpen={() => openItem(it.name)}
              />
            ))}
            {!ql && items.length > CAP && (
              <div className="lib-more">
                Showing {CAP} of {items.length}; type to search the rest.
              </div>
            )}
            {ql && matches.length === 0 && (
              <div className="empty" style={{ padding: 32 }}>
                <div className="big">No matches</div>
                Nothing in {SECTIONS[sec].label.toLowerCase()} matches “{q.trim()}”.
              </div>
            )}
            {items.length === 0 && (
              <div className="empty" style={{ padding: 32 }}>
                <div className="big">Nothing here yet</div>
                This section is empty; once the harness produces entries they will appear.
              </div>
            )}
          </div>
        </div>
        <div className="card lib-detail pad-lg">
          {activeItem ? (
            <>
              <div className="eyebrow">{SECTIONS[sec].label.replace(/s$/, '')}</div>
              <h2 className="h" style={{ margin: '8px 0 10px' }}>
                {item?.title || activeItem.title || activeItem.name}
              </h2>
              {(item?.desc || activeItem.desc) && (
                <p className="sub">{item?.desc || activeItem.desc}</p>
              )}
              <div className="lib-meta-grid" style={{ marginTop: 14 }}>
                <div>
                  <div className="tick">section</div>
                  <div className="lib-meta-v">{SECTIONS[sec].label}</div>
                </div>
                <div>
                  <div className="tick">source</div>
                  <div className="lib-meta-v mono">
                    {item?.source || activeItem.source || libSource(sec, activeItem.name)}
                  </div>
                </div>
              </div>
              {sec === 'memory' && activeItem.name !== 'MEMORY' && activeItem.name !== 'README' && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button
                    className="btn ghost sm"
                    onClick={onPromote}
                    title="Turn this lesson into a standing trial rule in user-rules.md"
                  >
                    Promote to rule
                  </button>
                  <button className="btn ghost sm" onClick={onForget}>
                    Forget this fact
                  </button>
                </div>
              )}
              <hr className="hr" />
              {item?.body ? (
                <div className="lib-doc">
                  <Markdown body={item.body} links={item.links || []} />
                </div>
              ) : item === null && activeName ? (
                <p className="sub">Loading…</p>
              ) : (
                <EmptyDoc section={sec} source={libSource(sec, activeItem.name)} />
              )}
            </>
          ) : (
            <div className="empty">
              <div className="big">Select an item</div>
              Pick something from the list to read it.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
