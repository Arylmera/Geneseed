import React from 'react'
import { Icon } from '../../components/Icon.jsx'

// About: live install snapshot + the static external links. Keeps version
// info close to the docs so a reader knows which version their docs reflect.
export default function About({ page }) {
  const v = page.version || {}
  const rows = [
    ['Theme', page.theme],
    ['Install mode', page.emit],
    ['Deployed', page.deployed ? 'yes' : 'no'],
    ['Target', <code key="t">{page.target}</code>],
    ['Source root', <code key="r">{page.root}</code>],
    ['Python', page.python],
    ['Installed build', <code key="i">{v.installed_fp || '(none)'}</code>],
    ['Source build', <code key="s">{v.source_fp || '—'}</code>],
    ['Match?', v.verdict || '—'],
    ['License', page.license],
  ]
  return (
    <div className="detail-doc">
      <h1 style={{ marginTop: 0 }}>{page.title}</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        Live snapshot of the install behind this UI, plus where to go next.
      </p>
      <div className="card pad-md" style={{ marginTop: 18 }}>
        {rows.map(([k, val]) => (
          <div className="kv" key={k}>
            <span className="k">{k}</span>
            <span className="v">{val ?? '—'}</span>
          </div>
        ))}
      </div>
      <div className="row wrap gap-10" style={{ marginTop: 18 }}>
        <a className="btn ghost" href={page.repo} target="_blank" rel="noreferrer">
          <Icon name="external" />
          GitHub repo
        </a>
        <a className="btn ghost" href={`${page.repo}/issues`} target="_blank" rel="noreferrer">
          <Icon name="external" />
          File an issue
        </a>
        <a
          className="btn ghost"
          href={`${page.repo}/blob/main/LICENSE`}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="external" />
          License
        </a>
      </div>
    </div>
  )
}
