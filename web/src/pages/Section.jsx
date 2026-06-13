import React from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { SECTIONS, SECTION_ORDER } from '../lib/sections.js'
import { useAsync } from '../hooks/useAsync.js'
import ErrorState from '../components/ErrorState.jsx'
import Markdown from '../components/Markdown.jsx'

function DocView({ section, item }) {
  const type = SECTIONS[section].type
  return (
    <div className="detail-doc">
      <span className="eyebrow">{type}</span>
      <h1 style={{ marginTop: 10 }}>{item.title}</h1>
      <div className="doc-meta">
        <span className="badge acc"><span className="dot" />{type}</span>
        {item.links?.length
          ? <span className="badge"><span className="dot" />{item.links.length} cross-link{item.links.length === 1 ? '' : 's'}</span>
          : null}
      </div>
      {item.desc ? <p style={{ fontSize: 15 }}>{item.desc}</p> : null}
      <Markdown body={item.body} links={item.links} />
    </div>
  )
}

export default function Section({ section, selected, query, counts }) {
  const { data: catalog, error: catErr } = useAsync(() => api.catalog(section), [section])
  const { data: item, error: itemErr } = useAsync(
    () => (selected ? api.item(SECTIONS[section].type, selected) : Promise.resolve(null)),
    [section, selected])
  const items = catalog?.items || []
  const err = catErr || itemErr

  const q = (query || '').toLowerCase()
  const shown = items.filter((it) =>
    !q || it.title.toLowerCase().includes(q) || (it.desc || '').toLowerCase().includes(q))

  return (
    <>
      <div className="head-row mb-18">
        <div>
          <span className="eyebrow">browse</span>
          <h1 className="h">Library</h1>
          <p className="sub">Every rule, agent, skill, and note in the deployed harness —
            rendered markdown with clickable cross-links.</p>
        </div>
      </div>
      <div className="lib">
        <div className="card lib-list">
          <div className="lib-tabs">
            {SECTION_ORDER.map((k) => (
              <span key={k} className={`lib-tab ${section === k ? 'on' : ''}`}
                onClick={() => go(`#/section/${k}`)}>
                {SECTIONS[k].label}{counts?.[k] != null
                  ? <span style={{ opacity: .6 }}> {counts[k]}</span> : null}
              </span>
            ))}
          </div>
          <div className="lib-rows">
            {shown.map((it) => (
              <div key={it.name} className={`lib-row ${selected === it.name ? 'on' : ''}`}
                onClick={() => go(`#/item/${SECTIONS[section].type}/${encodeURIComponent(it.name)}`)}>
                <div className="lr-name">{it.title}</div>
                {it.desc ? <div className="lr-desc">{it.desc}</div> : null}
              </div>
            ))}
            {shown.length === 0 &&
              <div className="empty"><div className="big">No matches</div>Try another search.</div>}
          </div>
        </div>
        <div className="card">
          <ErrorState error={err} style={{ margin: 18 }} />
          {item ? <DocView section={section} item={item} />
            : <div className="empty"><div className="big">Select an item</div>Pick something from the list to read it.</div>}
        </div>
      </div>
    </>
  )
}
