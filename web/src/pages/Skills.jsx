import React, { useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Six-class taxonomy mirroring the Laws view. The class itself comes from the
// server (SKILL_CLASS in _harness_tui.py, shipped as `klass`); this map only
// holds the chip label and dot colour. Same OKLCH hues as LAW_CATS so the two
// ledgers read as one family. Order is the chip-bar order.
const SKILL_CATS = {
  design: { label: 'Design', c: 'oklch(0.74 0.08 280)' },
  build: { label: 'Build', c: 'oklch(0.78 0.085 95)' },
  review: { label: 'Review', c: 'oklch(0.74 0.085 45)' },
  ship: { label: 'Ship', c: 'oklch(0.76 0.075 150)' },
  understand: { label: 'Understand', c: 'oklch(0.78 0.075 200)' },
  learn: { label: 'Learn', c: 'oklch(0.76 0.085 345)' },
}
const SKILL_CAT_ORDER = ['design', 'build', 'review', 'ship', 'understand', 'learn']

// One expandable row: lazy-loads its full body via /api/item/skill/<name> the
// first time it opens, cached on subsequent toggles. Mirrors LawRow, minus the
// numeral column — skills are name + one-line desc + class.
function SkillRow({ skill, isOpen, onToggle }) {
  const cat = SKILL_CATS[skill.cat] || SKILL_CATS.build
  const { data: detail } = useAsync(
    () => (isOpen ? api.item('skill', skill.name) : Promise.resolve(null)),
    [isOpen, skill.name],
  )
  return (
    <>
      <button
        className={`skill-row ${isOpen ? 'on' : ''}`}
        style={{ '--cc': cat.c }}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="skill-name">
          <span className="x">›</span>
          {skill.name}
        </span>
        <span className="skill-desc">{skill.desc}</span>
        <span className="law-class">
          <span className="cdot" />
          {cat.label}
        </span>
      </button>
      {isOpen && (
        <div className="law-expand">
          {detail ? (
            <pre className="skill-body">{detail.body}</pre>
          ) : (
            <p className="dim">Loading…</p>
          )}
          <div className="law-srcline">$ geneseed skill {skill.name} · skills/{skill.name}.md</div>
        </div>
      )}
    </>
  )
}

// `selected` is the name from a #/item/skill/<name> deep-link (Spotlight, wiki
// cross-links). The open row is driven straight off the URL so those links
// pre-open the skill and any opened skill is itself shareable.
export default function Skills({ selected }) {
  const { data, error } = useAsync(() => api.catalog('skills'), [])
  const [sel, setSel] = useState('all')
  const open = selected || null
  const toggle = (name) => go(open === name ? '#/skills' : `#/item/skill/${name}`)

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const skills = (data.items || []).map((it) => ({
    name: it.name,
    desc: it.desc,
    cat: it.klass && SKILL_CATS[it.klass] ? it.klass : 'build',
  }))
  const counts = {}
  skills.forEach((s) => {
    counts[s.cat] = (counts[s.cat] || 0) + 1
  })
  const shown = sel === 'all' ? skills : skills.filter((s) => s.cat === sel)

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">capabilities</div>
          <h1 className="h">Skills</h1>
          <p className="sub">
            The repeatable workflows the agent runs on demand. Pick a class to filter, or open any
            skill to read its full procedure.
          </p>
        </div>
      </div>
      <div className="law-toolbar">
        <div className="law-cats">
          <button className={`law-cat ${sel === 'all' ? 'on' : ''}`} onClick={() => setSel('all')}>
            <span>All</span>
            <span className="cn">{skills.length}</span>
          </button>
          {SKILL_CAT_ORDER.map((k) => (
            <button
              key={k}
              className={`law-cat ${sel === k ? 'on' : ''}`}
              style={{ '--cc': SKILL_CATS[k].c }}
              onClick={() => setSel(k)}
            >
              <span className="cdot" />
              <span>{SKILL_CATS[k].label}</span>
              <span className="cn">{counts[k] || 0}</span>
            </button>
          ))}
        </div>
        <span className="law-readout">
          <b>{shown.length}</b> skills · <b>6</b> classes · source <b>src/skills/</b>
        </span>
      </div>
      <div className="card law-wrap">
        <div className="skill-rowhead">
          <span>Skill</span>
          <span>Purpose</span>
          <span>Class</span>
        </div>
        {shown.map((s) => (
          <SkillRow
            key={s.name}
            skill={s}
            isOpen={open === s.name}
            onToggle={() => toggle(s.name)}
          />
        ))}
        {shown.length === 0 && (
          <div className="empty" style={{ padding: 32 }}>
            <div className="big">No skills in this class</div>
            Try another class — or pick All.
          </div>
        )}
      </div>
    </>
  )
}
