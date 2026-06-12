import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import Markdown from '../components/Markdown.jsx'

const TYPE = { agents: 'agent', skills: 'skill', laws: 'law',
  memory: 'memory', notebook: 'notebook', wiki: 'wiki', config: 'config' }

export default function Section({ section, selected, query }) {
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
    <div className="container split">
      <div className="list">
        {shown.map((it) => (
          <div
            key={it.name}
            className={`row ${selected === it.name ? 'active' : ''}`}
            onClick={() => go(`#/item/${TYPE[section]}/${encodeURIComponent(it.name)}`)}
          >
            <div>{it.title}</div>
            {it.desc ? <div className="muted" style={{ fontSize: 12 }}>{it.desc}</div> : null}
          </div>
        ))}
      </div>
      <div className="detail">
        {err ? <p className="badge warn">{err}</p> : null}
        {item ? <><h2>{item.title}</h2><Markdown body={item.body} links={item.links} /></>
          : <p className="muted">Select an item.</p>}
      </div>
    </div>
  )
}
