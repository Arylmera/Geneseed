import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { Icon } from '../components/Icon.jsx'
import { SECTIONS, LIBRARY_ORDER } from '../lib/sections.js'
import { SKILL_CATS, SKILL_CAT_ORDER } from '../lib/lawCats.js'
import { useAsync } from '../hooks/useAsync.js'
import Markdown from '../components/Markdown.jsx'
import ManifestDoc from '../components/ManifestDoc.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import ErrorState from '../components/ErrorState.jsx'
import FilterInput from '../components/FilterInput.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'

// The on-disk source path for a given (section, name), for the reader's source line when
// the item payload carries none. Informational only; it drives no fetch.
function libSource(sec, name) {
  if (sec === 'agents' || sec === 'skills') return `${sec}/${name}.md`
  if (sec === 'memory') return `memory/${name}`
  if (sec === 'notebook') return `notebook/${name}`
  if (sec === 'wiki') return `wiki.jsonc`
  if (sec === 'config') return name
  return `${sec}/${name}.md`
}

// One row in the list pane: a real link, so it opens in a new tab, reads as navigation to
// assistive tech, and arrow keys can walk the list (onRowsKey below).
function LibRow({ item, isOpen, href }) {
  return (
    <a
      className={`lib-row${isOpen ? ' on' : ''}`}
      href={href}
      aria-current={isOpen ? 'true' : undefined}
    >
      <span className="lr-name">
        {item.title || item.name}
        <StatusBadge status={item.status} />
      </span>
      {item.desc ? <span className="lr-desc">{item.desc}</span> : null}
    </a>
  )
}

// A wiki or config entry that is a convention rather than a document of its own. The
// source path stays visible so the reader still learns where the content lives.
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

const resolveSec = (s, lock) => lock || (s && LIBRARY_ORDER.includes(s) ? s : LIBRARY_ORDER[0])
const enc = encodeURIComponent

// The Library: what the agent knows, in three panes. The kinds column picks a section
// (skills, agents, memory, notebook, wiki, setup files), the list pane lists it, the
// reader renders the selected entry straight from its source file. Routing:
//   #/library, #/skills, #/agents, #/section/<kind>  -> kind selected
//   #/item/<type>/<name>                              -> kind + entry selected
//
// Personal's Memory and Notebook tabs render this same component with `lock` (one kind,
// no kinds column) and `base` (the tab's own address, `#/personal/memory`), so an entry
// opened there stays on the Personal page.
// Skills in class order, each row tagged with its class and the header it sits under, plus
// the classes present with their counts (the chips). Exported for the test that pins it.
export function splitSkills(items) {
  const catOf = (it) => (SKILL_CATS[it.klass] ? it.klass : 'personal')
  const rows = SKILL_CAT_ORDER.flatMap((k) =>
    items
      .filter((it) => catOf(it) === k)
      .map((it) => ({ ...it, cat: k, group: SKILL_CATS[k].label, groupC: SKILL_CATS[k].c })),
  )
  const cats = SKILL_CAT_ORDER.map((k) => ({
    key: k,
    label: SKILL_CATS[k].label,
    c: SKILL_CATS[k].c,
    n: rows.filter((r) => r.cat === k).length,
  })).filter((x) => x.n > 0)
  return { rows, cats }
}

export default function Library({ overview, section, selected, dataRev, lock, base }) {
  const confirm = useConfirm()
  const [sec, setSec] = useState(() => resolveSec(section, lock))
  const [q, setQ] = useState('')
  // The skill class chip ('all' or a SKILL_CATS key). Skills only; reset with the kind.
  const [cat, setCat] = useState('all')
  // A failed memory action (promote, forget), shown in the page's error slot until the
  // next one.
  const [actionErr, setActionErr] = useState('')
  const rowsRef = useRef(null)

  // Follow the route's section, and drop any filter text so it doesn't carry across kinds.
  // Adjusted during render against the last-seen prop, not in an effect.
  const [seenSection, setSeenSection] = useState(section)
  if (section !== seenSection) {
    setSeenSection(section)
    const next = resolveSec(section, lock)
    if (next !== sec) {
      setSec(next)
      setQ('')
      setCat('all')
    }
  }

  const {
    data: catalog,
    error: catErr,
    reload: reloadCatalog,
  } = useAsync(() => api.catalog(sec), [sec, dataRev], 'catalog')

  // useAsync keeps the prior section's catalog in `data` while the new one is in flight
  // (so the list doesn't flash empty). Only treat it as current when its `section`
  // matches, or the first row would be the PREVIOUS kind's first item, fetched under the
  // new kind's type: a guaranteed NotFound flash on every switch.
  const items = catalog?.section === sec ? catalog?.items || [] : []
  // The entry on display: the URL-selected one, or the first row when the kind was opened
  // without a selection, so the highlighted row and the reader always agree.
  // Skills are listed class by class (splitSkills), so their first row is not items[0].
  const isSkills = sec === 'skills'
  const skillSplit = isSkills ? splitSkills(items) : null
  const activeName = selected || (isSkills ? skillSplit.rows[0] : items[0])?.name || null
  const fromCatalog = activeName ? items.find((it) => it.name === activeName) : null
  const activeType = fromCatalog?.type || SECTIONS[sec].type
  const { data: item, error: itemErr } = useAsync(
    () => (activeName ? api.item(activeType, activeName) : Promise.resolve(null)),
    [sec, activeName, activeType, dataRev],
  )

  const err = actionErr || catErr || itemErr
  // Prefer the catalog row; fall back to a synthetic one when the URL names an item that
  // isn't in the listing (a fresh deep link before the catalog lands).
  const synthetic = activeName
    ? { name: activeName, title: item?.title || activeName, desc: item?.desc || '' }
    : null
  const activeItem = fromCatalog || synthetic
  const counts = overview?.counts || {}

  // Skills are divided by class, as the old Skills page did: listed class by class under a
  // header, with a chip per class to narrow to one. A skill the registry does not know is
  // yours (`personal`), outside the taxonomy, so it gets its own chip only when one exists.
  const pool = isSkills ? skillSplit.rows.filter((it) => cat === 'all' || it.cat === cat) : items

  // Render-cap the list so a big kind (a wiki vault is the case that bites) doesn't paint
  // hundreds of rows. Typing searches the full list; the active item is always kept in view.
  // Skills are never capped: a class header must not promise rows the cap then hides.
  const CAP = isSkills ? Infinity : 50
  const ql = q.trim().toLowerCase()
  const matches = ql
    ? pool.filter((it) =>
        `${it.title || ''} ${it.name || ''} ${it.desc || ''}`.toLowerCase().includes(ql),
      )
    : pool.slice(0, CAP)
  // A class chip narrows on purpose, so it does not pull the active entry back in.
  const shown =
    !ql && cat === 'all' && activeName && !matches.some((it) => it.name === activeName)
      ? [...matches, ...items.filter((it) => it.name === activeName)]
      : matches

  // Keep the active row in view inside the list scroller, without scrollIntoView (which
  // would also scroll the page), and only when it is genuinely off-screen: re-centering a
  // row that was just clicked moves the list under the cursor.
  useEffect(() => {
    const box = rowsRef.current
    const el = box?.querySelector('.lib-row.on')
    if (!el || !box) return
    const top = el.offsetTop
    if (top >= box.scrollTop && top + el.clientHeight <= box.scrollTop + box.clientHeight) return
    box.scrollTop = Math.max(0, top - box.clientHeight / 2 + el.clientHeight / 2)
  }, [sec, selected])

  const itemHref = (it) =>
    base ? `${base}/${enc(it.name)}` : `#/item/${it.type || SECTIONS[sec].type}/${enc(it.name)}`

  // Arrow keys walk the list; Enter follows the focused link.
  const onRowsKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...(rowsRef.current?.querySelectorAll('.lib-row') || [])]
    const idx = rows.indexOf(document.activeElement)
    if (idx === -1) return
    e.preventDefault()
    rows[e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0)]?.focus()
  }

  const onForget = async () => {
    const name = activeItem?.name
    if (!name) return
    const ok = await confirm(
      `Forget the memory fact "${name}"? It is deleted from the store and the index.`,
      { title: 'Forget this fact?', confirmLabel: 'Forget' },
    )
    if (!ok) return
    setActionErr('')
    try {
      await api.memoryDelete(name)
    } catch (e) {
      // Stay on the fact that failed to go, and say why.
      setActionErr(`Could not forget "${name}": ${e.message}`)
      return
    }
    go(base || '#/section/memory')
    reloadCatalog()
  }

  // Promote a memory fact into a standing trial rule in user-rules.md, the web twin of the
  // rule skill's memory->rule flow. The fact is deleted after the promotion (keeping both
  // would load the lesson twice), which is why the confirm spells that out. Lands on the
  // Rules tab so the new trial rule is immediately visible and editable.
  const onPromote = async () => {
    const name = activeItem?.name
    if (!name) return
    const ok = await confirm(
      `Promote "${name}" into a standing rule? It is appended to user-rules.md as a trial rule (a month of probation), and the memory fact is deleted so the lesson isn't loaded twice.`,
      { title: 'Promote to a rule?', confirmLabel: 'Promote' },
    )
    if (!ok) return
    setActionErr('')
    try {
      const cur = await api.rules()
      await api.rulesPromote({ name, fingerprint: cur.fingerprint, delete_memory: true })
      go('#/personal/rules')
    } catch (e) {
      setActionErr(`Could not promote: ${e.message}`)
      reloadCatalog()
    }
  }

  // The composition bar over the kinds column: skills, agents, and everything else the
  // agent keeps, as shares of the whole library.
  const total = LIBRARY_ORDER.reduce((n, k) => n + (counts[k] ?? 0), 0)
  const rest = total - (counts.skills ?? 0) - (counts.agents ?? 0)
  const share = (n) => `${total ? (n / total) * 100 : 0}%`
  const status = item?.status || activeItem?.status
  const skillCat = sec === 'skills' ? SKILL_CATS[fromCatalog?.klass] : null
  const label = SECTIONS[sec].label

  return (
    <>
      {err ? <ErrorState error={err} style={{ margin: '0 0 12px' }} /> : null}
      <div className={`library${lock ? ' locked' : ''}`}>
        {lock ? null : (
          <aside className="lib-kinds" aria-label="Library kinds">
            <div className="lib-title">
              <h1 className="h">Library</h1>
              <span className="dim">What the agent knows</span>
            </div>
            <div className="stackbar thin" aria-hidden="true">
              <span className="sb-invariants" style={{ width: share(counts.skills ?? 0) }} />
              <span className="sb-doctrines" style={{ width: share(counts.agents ?? 0) }} />
              <span className="sb-rest" style={{ width: share(rest) }} />
            </div>
            <nav className="kind-list" aria-label="Kinds">
              {LIBRARY_ORDER.map((k) => (
                <a
                  key={k}
                  href={`#/section/${k}`}
                  className={sec === k ? 'on' : ''}
                  aria-current={sec === k ? 'page' : undefined}
                >
                  {SECTIONS[k].label}
                  <span className="mono dim">{counts[k] ?? ''}</span>
                </a>
              ))}
            </nav>
          </aside>
        )}

        <section className="lib-list" aria-label={label}>
          <div className="lib-list-head">
            <b>
              {label}{' '}
              <span className="mono dim">
                {ql ? `${matches.length} of ${pool.length}` : pool.length}
              </span>
            </b>
          </div>
          <FilterInput
            value={q}
            onChange={setQ}
            placeholder={`Filter ${label.toLowerCase()}`}
            label={`Filter ${label}`}
          />
          {isSkills && skillSplit.cats.length > 1 && (
            <div className="skill-cats" role="group" aria-label="Skill classes">
              <button
                type="button"
                className={`skill-cat${cat === 'all' ? ' on' : ''}`}
                aria-pressed={cat === 'all'}
                onClick={() => setCat('all')}
              >
                All <span className="cn">{items.length}</span>
              </button>
              {skillSplit.cats.map(({ key, label: cl, n, c }) => (
                <button
                  type="button"
                  key={key}
                  className={`skill-cat${cat === key ? ' on' : ''}`}
                  aria-pressed={cat === key}
                  style={{ '--cc': c }}
                  onClick={() => setCat(key)}
                >
                  <span className="cdot" aria-hidden="true" />
                  {cl} <span className="cn">{n}</span>
                </button>
              ))}
            </div>
          )}
          <div className="lib-rows" ref={rowsRef} onKeyDown={onRowsKey}>
            {(() => {
              // A small header each time the row's group changes: a wiki page's vault, or a
              // skill's class. Kinds without groups render no headers.
              let lastGroup = null
              const out = []
              for (const it of shown) {
                if (it.group && it.group !== lastGroup) {
                  lastGroup = it.group
                  out.push(
                    <div className="lib-group" key={`g-${it.group}`}>
                      {it.groupC ? (
                        <span className="cdot" style={{ '--cc': it.groupC }} aria-hidden="true" />
                      ) : null}
                      {it.group}
                    </div>,
                  )
                }
                out.push(
                  <LibRow
                    key={it.name}
                    item={it}
                    isOpen={activeItem?.name === it.name}
                    href={itemHref(it)}
                  />,
                )
              }
              return out
            })()}
            {!ql && items.length > CAP && (
              <div className="lib-more">
                Showing {CAP} of {items.length}; type to search the rest.
              </div>
            )}
            {ql && matches.length === 0 && (
              <div className="empty" style={{ padding: 32 }}>
                <div className="big">No matches</div>
                Nothing in {label.toLowerCase()} matches “{q.trim()}”.
              </div>
            )}
            {catalog?.section === sec && items.length === 0 && (
              <div className="empty" style={{ padding: 32 }}>
                <div className="big">Nothing here yet</div>
                Once the harness produces entries they appear here.
              </div>
            )}
          </div>
        </section>

        <article className="lib-reader" aria-label="Entry">
          {activeItem ? (
            <>
              <div className="reader-tags">
                <span className="tag acc">{label.replace(/s$/, '')}</span>
                {skillCat ? <span className="tag">{skillCat.label}</span> : null}
                <StatusBadge status={status} />
              </div>
              <h2 className="reader-title">{item?.title || activeItem.title || activeItem.name}</h2>
              {(item?.desc || activeItem.desc) && (
                <p className="reader-lede">{item?.desc || activeItem.desc}</p>
              )}
              <p className="mono dim reader-src">
                {item?.source || activeItem.source || libSource(sec, activeItem.name)}
              </p>
              {sec === 'memory' && activeItem.name !== 'MEMORY' && activeItem.name !== 'README' && (
                <div className="row gap-8">
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={onPromote}
                    title="Turn this lesson into a standing trial rule in user-rules.md"
                  >
                    Promote to rule
                  </button>
                  <button type="button" className="btn ghost sm" onClick={onForget}>
                    Forget this fact
                  </button>
                </div>
              )}
              <hr className="hr" />
              {activeItem?.kind === 'manifest' || item?.manifest !== undefined ? (
                item ? (
                  <ManifestDoc manifest={item.manifest} body={item.body} name={activeItem.name} />
                ) : (
                  <p className="sub">Loading…</p>
                )
              ) : item?.body ? (
                <div className="lib-doc detail-doc">
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
              <div className="big">Select an entry</div>
              Pick something from the list to read it.
            </div>
          )}
        </article>
      </div>
    </>
  )
}
