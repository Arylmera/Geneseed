import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { Icon } from '../components/Icon.jsx'
import { SECTIONS, SECTION_ORDER } from '../lib/sections.js'
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
        This entry is part of the {SECTIONS[section].label.toLowerCase()} convention — see{' '}
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
export default function Library({ overview, section, selected }) {
  const initialSec = section && SECTIONS[section] ? section : SECTION_ORDER[0]
  const [sec, setSec] = useState(initialSec)
  const rowsRef = useRef(null)

  // Sync sec from prop whenever the route hands us a different section.
  useEffect(() => {
    if (section && SECTIONS[section] && section !== sec) setSec(section)
  }, [section]) // eslint-disable-line react-hooks/exhaustive-deps

  const {
    data: catalog,
    error: catErr,
    reload: reloadCatalog,
  } = useAsync(() => api.catalog(sec), [sec])
  const { data: item, error: itemErr } = useAsync(
    () => (selected ? api.item(SECTIONS[sec].type, selected) : Promise.resolve(null)),
    [sec, selected],
  )

  const items = catalog?.items || []
  const err = catErr || itemErr
  // Prefer the catalog row; fall back to a synthetic row when the URL names
  // an item that isn't in the listing (e.g. a fresh deep-link before the
  // catalog finishes). When nothing is selected, auto-pick the first row.
  const fromCatalog = selected ? items.find((it) => it.name === selected) : null
  const synthetic = selected ? { name: selected, title: item?.title || selected, desc: item?.desc || '' } : null
  const activeItem = fromCatalog || (selected ? synthetic : items[0])
  const counts = overview?.counts || {}

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
    box.scrollTop = Math.max(
      0,
      elTop - box.clientHeight / 2 + el.clientHeight / 2,
    )
  }, [sec, selected])

  const openItem = (name) => go(`#/item/${SECTIONS[sec].type}/${encodeURIComponent(name)}`)
  const switchSection = (k) => go(`#/section/${k}`)

  const onForget = async () => {
    if (
      !window.confirm(
        `Forget the memory fact "${selected}"? It is deleted from the store and the index.`,
      )
    )
      return
    try {
      await api.memoryDelete(selected)
    } catch {
      // surface via reload, if any
    }
    go('#/section/memory')
    reloadCatalog()
  }

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">harness content</div>
          <h1 className="h">Library</h1>
          <p className="sub">
            Browse every layer of the deployed harness from one place. Pick a section, then read
            an entry — the markdown comes straight from the source file.
          </p>
        </div>
      </div>
      <div className="lib-secbar">
        {SECTION_ORDER.map((k) => {
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

      {err ? (
        <ErrorState error={err} style={{ margin: '12px 0' }} />
      ) : null}

      <div className="lib lib-2">
        <div className="card lib-main">
          <div className="lib-head">
            <span className="lib-head-label">{SECTIONS[sec].label}</span>
            <span className="lib-head-count">{items.length} items</span>
          </div>
          <div className="lib-rows" ref={rowsRef}>
            {items.map((it) => (
              <LibRow
                key={it.name}
                item={it}
                isOpen={activeItem?.name === it.name}
                onOpen={() => openItem(it.name)}
              />
            ))}
            {items.length === 0 && (
              <div className="empty" style={{ padding: 32 }}>
                <div className="big">Nothing here yet</div>
                This section is empty — once the harness produces entries they will appear.
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
                  <div className="lib-meta-v mono">{libSource(sec, activeItem.name)}</div>
                </div>
              </div>
              {sec === 'memory' &&
                activeItem.name !== 'MEMORY' &&
                activeItem.name !== 'README' && (
                  <div style={{ marginTop: 12 }}>
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
              ) : item === null && selected ? (
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
