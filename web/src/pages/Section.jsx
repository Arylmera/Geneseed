import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import Markdown from '../components/Markdown.jsx'

const TYPE = { agents: 'agent', skills: 'skill', laws: 'law',
  memory: 'memory', notebook: 'notebook', wiki: 'wiki', config: 'config' }
const SEC_KEYS = ['agents', 'skills', 'laws', 'memory', 'notebook', 'wiki', 'config']
const SEC_LABEL = { agents: 'Agents', skills: 'Skills', laws: 'Laws', memory: 'Memory',
  notebook: 'Notebook', wiki: 'Wiki', config: 'Config' }

function DocView({ section, item }) {
  const type = TYPE[section]
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
  const [items, setItems] = useState([])
  const [item, setItem] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setErr('')
    api.catalog(section).then((c) => setItems(c.items)).catch((e) => setErr(e.message))
  }, [section])

  useEffect(() => {
    if (!selected) { setItem(null); return }
    api.item(TYPE[section], selected).then(setItem).catch((e) => setErr(e.message))
  }, [section, selected])

  const q = (query || '').toLowerCase()
  const shown = items.filter((it) =>
    !q || it.title.toLowerCase().includes(q) || (it.desc || '').toLowerCase().includes(q))

  return (
    <>
      <div className="head-row" style={{ marginBottom: 18 }}>
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
            {SEC_KEYS.map((k) => (
              <span key={k} className={`lib-tab ${section === k ? 'on' : ''}`}
                onClick={() => go(`#/section/${k}`)}>
                {SEC_LABEL[k]}{counts?.[k] != null
                  ? <span style={{ opacity: .6 }}> {counts[k]}</span> : null}
              </span>
            ))}
          </div>
          <div className="lib-rows">
            {shown.map((it) => (
              <div key={it.name} className={`lib-row ${selected === it.name ? 'on' : ''}`}
                onClick={() => go(`#/item/${TYPE[section]}/${encodeURIComponent(it.name)}`)}>
                <div className="lr-name">{it.title}</div>
                {it.desc ? <div className="lr-desc">{it.desc}</div> : null}
              </div>
            ))}
            {shown.length === 0 &&
              <div className="empty"><div className="big">No matches</div>Try another search.</div>}
          </div>
        </div>
        <div className="card">
          {err ? <p className="badge bad" style={{ margin: 18 }}>{err}</p> : null}
          {item ? <DocView section={section} item={item} />
            : <div className="empty"><div className="big">Select an item</div>Pick something from the list to read it.</div>}
        </div>
      </div>
    </>
  )
}
