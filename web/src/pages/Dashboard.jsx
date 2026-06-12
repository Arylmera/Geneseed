import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { Icon } from '../components/Icon.jsx'

const SECTION_META = {
  agents:   { label: 'Agents',   desc: 'capability specialists', icon: 'layers' },
  skills:   { label: 'Skills',   desc: 'repeatable workflows',   icon: 'build' },
  laws:     { label: 'Laws',     desc: 'governance rules',       icon: 'doctor' },
  memory:   { label: 'Memory',   desc: 'durable facts',          icon: 'library' },
  notebook: { label: 'Notebook', desc: 'sovereign space',        icon: 'changes' },
  wiki:     { label: 'Wiki',     desc: 'machine knowledge base', icon: 'graph' },
  config:   { label: 'Config',   desc: 'install metadata',       icon: 'settings' },
}
const SECTION_ORDER = ['agents', 'skills', 'laws', 'memory', 'notebook', 'wiki', 'config']

// Voice-flavoured hero headline per theme — UI copy, not server data.
const HEADLINES = {
  neutral: 'Loaded & ready', imperial: 'The Codex in force', military: 'The unit stands ready',
  cyberpunk: 'Jacked in', wizard: 'Wards in place', pirate: 'The crew stands ready',
  gamer: 'Game loaded', sports: 'The squad takes the field', biker: 'The crew rolls out',
  commentator: 'Lights out, away we go', verstappen: "Setup's in", joker: 'Mic check',
  mean: 'Rules are up', marvin: 'Online. Reluctantly.',
}

// Health of the deployment as one number: deployed 40%, doctor up to 25%,
// version in sync 20%, nothing missing on disk 15%.
function readiness(ov, setup) {
  if (!ov) return 0
  const doctorScore = ov.doctor?.ok ? 0.25
    : (ov.doctor?.problems?.length ?? 99) <= 2 ? 0.15 : 0.05
  return (ov.deployed ? 0.40 : 0)
    + doctorScore
    + (setup && setup.installed_fp && setup.installed_fp === setup.source_fp ? 0.20 : 0)
    + (ov.diff && ov.diff.missing === 0 ? 0.15 : 0)
}

function relTime(epochSecs) {
  const s = Math.max(0, Date.now() / 1000 - epochSecs)
  if (s < 90) return `${Math.round(s)}s`
  if (s < 5400) return `${Math.round(s / 60)}m`
  if (s < 129600) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

function Ring({ value, size = 232 }) {
  const r = size / 2 - 14
  const c = 2 * Math.PI * r
  const off = c * (1 - value)
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth="10"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1)' }} />
        {Array.from({ length: 48 }).map((_, i) => {
          const a = (i / 48) * 2 * Math.PI
          const inner = r - 18, outer = r - 24
          const x1 = size / 2 + Math.cos(a) * inner, y1 = size / 2 + Math.sin(a) * inner
          const x2 = size / 2 + Math.cos(a) * outer, y2 = size / 2 + Math.sin(a) * outer
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--line-2)" strokeWidth="1"
            opacity={i / 48 < value ? 0.9 : 0.25} />
        })}
      </svg>
      <div className="ring-center">
        <div className="pct">{Math.round(value * 100)}<span style={{ fontSize: 20, color: 'var(--text-3)' }}>%</span></div>
        <div className="lbl">germination</div>
      </div>
    </div>
  )
}

function KpiStrip({ overview }) {
  const edits = (overview.diff?.edited ?? 0) + (overview.diff?.added ?? 0)
  const kpis = [
    { key: 'agents', label: 'Agents', foot: 'capability roster' },
    { key: 'skills', label: 'Skills', foot: 'repeatable rites' },
    { key: 'laws',   label: 'Laws',   foot: 'all enforced' },
  ]
  return (
    <div className="grid g-4" style={{ marginBottom: 16 }}>
      {kpis.map((k, i) => (
        <div className="card kpi rise" key={k.key} style={{ animationDelay: `${i * 60}ms` }}>
          <div className="klabel">{k.label}</div>
          <div className="kval">{overview.counts?.[k.key] ?? '—'}</div>
          <div className="kfoot"><span>{k.foot}</span></div>
        </div>
      ))}
      <div className="card kpi rise" key="edits" style={{ animationDelay: '180ms', cursor: 'pointer' }}
        onClick={() => go('#/diff')}>
        <div className="klabel">Local edits</div>
        <div className="kval">{edits}</div>
        <div className="kfoot">
          {edits > 0 && <span className="delta up">&#9650; +{edits}</span>}
          <span>awaiting export</span>
        </div>
      </div>
    </div>
  )
}

function Genome({ overview }) {
  return (
    <div className="genome">
      {SECTION_ORDER.map((key, i) => {
        const m = SECTION_META[key]
        return (
          <div className="card gcell rise" key={key} style={{ animationDelay: `${i * 50}ms` }}
            onClick={() => go('#/section/' + key)}>
            <div className="gtop">
              <span className="gname">{m.label}</span>
              <Icon name={m.icon} className="gicon" />
            </div>
            <div className="gcount">{overview.counts?.[key] ?? '—'}</div>
            <div className="gdesc">{m.desc}</div>
          </div>
        )
      })}
    </div>
  )
}

function ActivityFeed({ jobs }) {
  if (!jobs || jobs.length === 0) {
    return (
      <div className="feed">
        <div className="empty">
          <div className="big">No activity yet</div>
          Actions you run appear here.
        </div>
      </div>
    )
  }
  const kindMap = { done: 'ok', running: 'acc', failed: 'bad' }
  const shown = [...jobs].sort((a, b) => b.started - a.started).slice(0, 8)
  return (
    <div className="feed">
      {shown.map((j) => (
        <div className="feed-row" key={j.id}>
          <span className={`feed-dot ${kindMap[j.status] || 'ok'}`} />
          <span className="feed-txt"><b>{j.action}</b></span>
          <span className="feed-when">{relTime(j.started)} ago</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Direction A · Status ---------- */
function DirStatus({ overview, sigil, setup, jobs, onAction }) {
  const headline = overview.deployed
    ? (HEADLINES[overview.theme] || 'Loaded & ready')
    : 'Not deployed'
  const rv = readiness(overview, setup)

  return (
    <>
      <div className="card pad-lg rise" style={{ marginBottom: 16 }}>
        <div className="hero">
          <Ring value={rv} />
          <div className="hero-facts">
            <span className="eyebrow">harness · {overview.deployed ? 'deployed' : 'not deployed'}</span>
            <div className="ttl">{headline}</div>
            {sigil && (
              <div className="voice-readout" key={overview.theme}>
                <span className="vr-cur">&#9621;</span>
                <span className="vr-txt">{sigil}</span>
              </div>
            )}
            <p className="sub">
              One source rendered into <code>{overview.target}</code>. Every repo on this machine inherits it.
            </p>
            <div className="hero-chips">
              <span className="chip"><span className="ck">voice</span><span className="cv" style={{ textTransform: 'capitalize' }}>{overview.theme}</span></span>
              <span className="chip"><span className="ck">mode</span><span className="cv">{overview.emit}</span></span>
              <span className="chip"><span className="ck">built</span><span className="cv">{overview.build_time || 'unknown'}</span></span>
              <span className="chip"><span className="ck">fp</span><span className="cv">{setup?.installed_fp || '—'}</span></span>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <button className="btn" onClick={() => onAction('update')}><Icon name="refresh" />Update</button>
              <button className="btn ghost" onClick={() => onAction('build', { theme: overview.theme, emit: overview.emit })}><Icon name="build" />Rebuild</button>
              <button className="btn ghost" onClick={() => onAction('doctor')}><Icon name="doctor" />Run doctor</button>
            </div>
          </div>
        </div>
      </div>

      <KpiStrip overview={overview} />

      <div className="grid" style={{ gridTemplateColumns: '1.55fr 1fr', alignItems: 'start' }}>
        <div className="card pad-lg">
          <div className="card-head"><h3>Capability genome</h3>
            <div className="right"><span className="tick">{SECTION_ORDER.length} sections</span></div></div>
          <Genome overview={overview} />
        </div>
        <div className="card pad-lg">
          <div className="card-head"><h3>Recent activity</h3>
            <div className="right"><span className="badge acc"><span className="dot" />live</span></div></div>
          <ActivityFeed jobs={jobs} />
        </div>
      </div>
    </>
  )
}

/* ---------- Direction B · Lineage ---------- */
function StrandRow({ k, overview, max }) {
  const m = SECTION_META[k]
  const v = overview.counts?.[k] ?? 0
  return (
    <div className="row between" style={{ padding: '13px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
      onClick={() => go('#/section/' + k)}>
      <div className="row" style={{ gap: 12, minWidth: 150 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ fontWeight: 600 }}>{m.label}</span>
      </div>
      <div className="hbar" style={{ flex: 1, margin: '0 16px' }}><i style={{ width: `${(v / max) * 100}%` }} /></div>
      <span className="mono" style={{ width: 34, textAlign: 'right', fontSize: 14 }}>{v}</span>
    </div>
  )
}

function MiniGraph({ graph }) {
  const W = 440, H = 230
  const nodes = graph ? graph.nodes.slice(0, 24) : []
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = graph ? graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)) : []

  const pos = useMemo(() => {
    const p = new Map()
    nodes.forEach((n, i) => {
      const a = (i / (nodes.length || 1)) * Math.PI * 2
      const rad = n.type === 'agent' ? 64 : 100
      p.set(n.id, { x: W / 2 + Math.cos(a) * rad * 1.5, y: H / 2 + Math.sin(a) * rad })
    })
    return p
  // geometry is memoised once per graph identity on purpose — node list changes mean a new graph object
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {edges.map((e, i) => {
        const a = pos.get(e.source), b = pos.get(e.target)
        if (!a || !b) return null
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-2)" strokeWidth="1" />
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)
        if (!p) return null
        return <circle key={n.id} cx={p.x} cy={p.y} r={n.type === 'agent' ? 5 : 3.4}
          fill={n.type === 'agent' ? 'var(--accent)' : 'var(--good)'} stroke="var(--bg)" strokeWidth="1.5" />
      })}
    </svg>
  )
}

function DirLineage({ overview, sigil, setup, jobs, graph }) {
  const max = Math.max(...SECTION_ORDER.map((k) => overview.counts?.[k] ?? 0), 1)
  const verdict = setup?.version_verdict || ''
  const verdictOk = verdict.includes('up to date')
  const edits = (overview.diff?.edited ?? 0) + (overview.diff?.added ?? 0)

  const steps = [
    ['Source', 'src/ — the canonical genetic material', setup?.source_fp || '—', true],
    ['Render', `build.py → ${overview.emit}`, overview.theme + ' voice', true],
    ['Deployed', overview.target, 'inherited by every repo', false],
  ]

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1.1fr', alignItems: 'stretch', marginBottom: 16 }}>
        <div className="card pad-lg rise" style={{ position: 'relative', overflow: 'hidden' }}>
          <span className="eyebrow">heritage</span>
          <h2 className="h" style={{ fontSize: 22, margin: '12px 0 18px' }}>Gene-seed lineage</h2>
          <div style={{ position: 'relative', paddingLeft: 26 }}>
            <div style={{ position: 'absolute', left: 7, top: 6, bottom: 18, width: 2,
              background: 'linear-gradient(var(--accent), var(--line-2))' }} />
            {steps.map(([t, d, tag, on], i) => (
              <div key={i} style={{ position: 'relative', marginBottom: i < 2 ? 22 : 0 }}>
                <span style={{ position: 'absolute', left: -26, top: 3, width: 14, height: 14,
                  borderRadius: '50%', background: on ? 'var(--accent)' : 'var(--surface-3)',
                  border: '2px solid var(--bg)', boxShadow: on ? '0 0 10px var(--accent)' : 'none' }} />
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>{t}</div>
                <div className="muted" style={{ fontSize: 13 }}>{d}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{tag}</div>
              </div>
            ))}
          </div>
          <hr className="hr" />
          {sigil && (
            <div className="voice-readout" key={overview.theme} style={{ marginBottom: 14 }}>
              <span className="vr-cur">&#9621;</span>
              <span className="vr-txt">{sigil}</span>
            </div>
          )}
          <div className="row wrap" style={{ gap: 10 }}>
            <span className={`badge ${verdictOk ? 'ok' : 'warn'}`}><span className="dot" />in sync · {verdict}</span>
            <span className="badge"><span className="dot" />{edits} local edits</span>
          </div>
        </div>
        <div className="card pad-lg rise" style={{ animationDelay: '80ms' }}>
          <div className="card-head"><h3>Cross-link constellation</h3>
            <div className="right">
              <button className="btn soft sm" onClick={() => go('#/graph')}>Open graph<Icon name="arrow" /></button>
            </div>
          </div>
          <MiniGraph graph={graph} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card pad-lg">
          <div className="card-head"><h3>Genome strand</h3><div className="right"><span className="tick">by volume</span></div></div>
          {SECTION_ORDER.map((k) => <StrandRow key={k} k={k} overview={overview} max={max} />)}
        </div>
        <div className="card pad-lg">
          <div className="card-head"><h3>Recent activity</h3></div>
          <ActivityFeed jobs={jobs} />
        </div>
      </div>
    </>
  )
}

/* ---------- Direction C · Operator ---------- */
function DirOperator({ overview, setup, jobs }) {
  const total = SECTION_ORDER.reduce((s, k) => s + (overview.counts?.[k] ?? 0), 0)
  const max = Math.max(...SECTION_ORDER.map((k) => overview.counts?.[k] ?? 0), 1)
  const doctorOk = overview.doctor?.ok
  const issueCount = overview.doctor?.problems?.length ?? 0
  const edits = (overview.diff?.edited ?? 0) + (overview.diff?.added ?? 0)

  return (
    <>
      <div className="card pad-md rise" style={{ marginBottom: 16 }}>
        <div className="row wrap between" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div className="tick">status</div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <span className={`badge ${overview.deployed ? 'ok' : 'warn'}`}>
                  <span className="dot" />{overview.deployed ? 'deployed' : 'not deployed'}
                </span>
              </div>
            </div>
            <div>
              <div className="tick">voice</div>
              <div className="metric" style={{ fontSize: 18, marginTop: 6, textTransform: 'capitalize' }}>{overview.theme}</div>
            </div>
            <div>
              <div className="tick">mode</div>
              <div className="mono" style={{ fontSize: 14, marginTop: 6 }}>{overview.emit}</div>
            </div>
            <div>
              <div className="tick">fingerprint</div>
              <div className="mono" style={{ fontSize: 14, marginTop: 6, color: 'var(--accent)' }}>{setup?.installed_fp || '—'}</div>
            </div>
            <div>
              <div className="tick">doctor</div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                {doctorOk
                  ? <span className="badge ok"><span className="dot" />clean</span>
                  : <span className="badge warn"><span className="dot" />{issueCount} issue{issueCount !== 1 ? 's' : ''}</span>}
              </div>
            </div>
            <div>
              <div className="tick">edits</div>
              <div className="metric" style={{ fontSize: 18, marginTop: 6 }}>{edits}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
        <div className="card rise" style={{ animationDelay: '60ms' }}>
          <div className="card-head pad-lg" style={{ padding: '18px 20px 0', marginBottom: 14 }}>
            <h3>Sections</h3>
            <div className="right"><span className="tick">{total} entries total</span></div>
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Section</th><th>Detail</th><th style={{ width: 130 }}>Share</th><th className="num">Count</th></tr>
            </thead>
            <tbody>
              {SECTION_ORDER.map((k) => {
                const m = SECTION_META[k], v = overview.counts?.[k] ?? 0
                return (
                  <tr key={k} className="clickable" onClick={() => go('#/section/' + k)}>
                    <td className="name">{m.label}</td>
                    <td className="muted">{m.desc}</td>
                    <td><div className="hbar"><i style={{ width: `${(v / max) * 100}%` }} /></div></td>
                    <td className="num">{v}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="card pad-lg rise" style={{ animationDelay: '120ms' }}>
          <div className="card-head"><h3>Run log</h3></div>
          <ActivityFeed jobs={jobs} />
        </div>
      </div>
    </>
  )
}

/* ---------- Top-level ---------- */
export default function Dashboard({ overview, themes, onAction }) {
  const [dir, setDir] = useState('status')
  const [setup, setSetup] = useState(null)
  const [jobs, setJobs] = useState([])
  const [graph, setGraph] = useState(null)
  const sigil = overview ? (themes.find((t) => t.name === overview.theme)?.sigil || '') : ''

  useEffect(() => {
    let alive = true
    api.setup().then((v) => alive && setSetup(v)).catch(() => {})
    api.jobs().then((r) => alive && setJobs(r.jobs || [])).catch(() => {})
    api.graph().then((v) => alive && setGraph(v)).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!overview) return <div className="loading">Loading&#8230;</div>

  return (
    <>
      <div className="head-row">
        <div>
          <span className="eyebrow">overview</span>
          <h1 className="h">Harness console</h1>
          <p className="sub">A live readout of the harness deployed on this machine — its voice, its capabilities, and its drift from source.</p>
        </div>
        <div className="seg">
          {[['status', 'Status'], ['lineage', 'Lineage'], ['operator', 'Operator']].map(([k, l]) => (
            <button key={k} className={dir === k ? 'on' : ''} onClick={() => setDir(k)}>{l}</button>
          ))}
        </div>
      </div>
      {dir === 'status'   && <DirStatus   overview={overview} sigil={sigil} setup={setup} jobs={jobs} onAction={onAction} />}
      {dir === 'lineage'  && <DirLineage  overview={overview} sigil={sigil} setup={setup} jobs={jobs} graph={graph} />}
      {dir === 'operator' && <DirOperator overview={overview} setup={setup} jobs={jobs} />}
    </>
  )
}
