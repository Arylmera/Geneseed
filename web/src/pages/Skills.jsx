import React, { useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import Markdown from '../components/Markdown.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import CatalogRow from '../components/CatalogRow.jsx'
import FilterInput from '../components/FilterInput.jsx'
import { CAT_HUES } from '../lib/lawCats.js'

// Six-class taxonomy mirroring the Laws view. The class itself comes from the server
// (SKILL_CLASS, shipped as `klass`); this map only holds the chip label and reuses
// LAW_CATS' own hues (CAT_HUES) so the two ledgers read as one family — Design ==
// Context's hue, Build == Craft's, Review == Security's, Ship == Process's, Understand
// == Verification's, Learn == Communication's. Order is the chip-bar order.
//
// `personal` is the exception: a skill the lifecycle registry has never heard of —
// your own, living in this install only. Deliberately near-grey rather than a
// seventh hue in the family, because it is OUTSIDE the taxonomy, not another
// member of it. Its chip appears only where such skills exist.
const SKILL_CATS = {
  design: { label: 'Design', c: CAT_HUES.context },
  build: { label: 'Build', c: CAT_HUES.craft },
  review: { label: 'Review', c: CAT_HUES.security },
  ship: { label: 'Ship', c: CAT_HUES.process },
  understand: { label: 'Understand', c: CAT_HUES.verify },
  learn: { label: 'Learn', c: CAT_HUES.comms },
  personal: { label: 'Personal', c: 'oklch(0.72 0.025 250)' },
}
const SKILL_CAT_ORDER = ['design', 'build', 'review', 'ship', 'understand', 'learn', 'personal']

// One expandable row, via CatalogRow (shared with LawRow) — see that component for the
// lazy-load/expand-panel machinery. Mirrors LawRow, minus the numeral column — skills
// are name + one-line desc + class, and the body is full Markdown rather than LawText.
function SkillRow({ skill, isOpen, onToggle }) {
  const cat = SKILL_CATS[skill.cat] || SKILL_CATS.build
  const head = (
    <>
      <span className="skill-name">
        <span className="x">›</span>
        {skill.name}
        <StatusBadge status={skill.status} />
      </span>
      <span className="skill-desc">{skill.desc}</span>
      <span className="law-class">
        <span className="cdot" />
        {cat.label}
      </span>
    </>
  )
  return (
    <CatalogRow
      kind="skill"
      addr={skill.name}
      isOpen={isOpen}
      onToggle={onToggle}
      className={`skill-row ${isOpen ? 'on' : ''}`}
      style={{ '--cc': cat.c }}
      head={head}
      expandClassName="law-expand skill-expand"
      renderBody={(detail) => (
        <div className="skill-doc">
          <Markdown body={detail.body} links={detail.links || []} />
        </div>
      )}
      srcLine={`$ geneseed skill ${skill.name} · skills/${skill.name}.md`}
    />
  )
}

// `selected` is the name from a #/item/skill/<name> deep-link (Spotlight, wiki
// cross-links). The open row is driven straight off the URL so those links
// pre-open the skill and any opened skill is itself shareable.
export default function Skills({ selected, dataRev }) {
  const { data, error } = useAsync(() => api.catalog('skills'), [dataRev], 'catalog:skills')
  const [sel, setSel] = useState('all')
  const [q, setQ] = useState('')
  const open = selected || null
  const toggle = (name) => go(open === name ? '#/skills' : `#/item/skill/${name}`)

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const skills = (data.items || []).map((it) => ({
    name: it.name,
    desc: it.desc,
    status: it.status,
    cat: it.klass && SKILL_CATS[it.klass] ? it.klass : 'build',
  }))
  const counts = {}
  skills.forEach((s) => {
    counts[s.cat] = (counts[s.cat] || 0) + 1
  })
  // Only the non-approved states are called out (StatusBadge renders nothing for
  // `approved`), so the readout carries the count that the badges alone would hide.
  const experimental = skills.filter((s) => s.status === 'experimental').length
  // The Personal chip is earned, not permanent: an install with no skills of your own
  // would otherwise carry a dead "Personal 0" chip on every visit.
  const cats = SKILL_CAT_ORDER.filter((k) => k !== 'personal' || counts.personal > 0)
  const ql = q.trim().toLowerCase()
  const shown = (sel === 'all' ? skills : skills.filter((s) => s.cat === sel)).filter(
    (s) => !ql || `${s.name} ${s.desc}`.toLowerCase().includes(ql),
  )

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
          {cats.map((k) => (
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
        <FilterInput
          className="lib-filter law-filter"
          value={q}
          onChange={setQ}
          placeholder="Filter skills…"
          label="Filter skills"
        />
        <span className="law-readout">
          <b>{shown.length}</b> skills · <b>{cats.length}</b> classes ·{' '}
          {experimental > 0 ? (
            <>
              <b>{experimental}</b> experimental ·{' '}
            </>
          ) : null}
          source <b>src/skills/</b>
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
            {/* Three distinct nothings: an empty install, a filter miss, an empty class. */}
            {skills.length === 0 ? (
              <>
                <div className="big">Nothing here yet</div>
                No skills are deployed; build and install a theme to seed them.
              </>
            ) : ql ? (
              <>
                <div className="big">No matching skills</div>
                Nothing matches “{q.trim()}”.
              </>
            ) : (
              <>
                <div className="big">No skills in this class</div>
                Try another class, or pick All.
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
