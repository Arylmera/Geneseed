import React, { useCallback, useMemo, useState } from 'react'
import { baseName, needsYou, STATUS } from '../../lib/activity.jsx'
import {
  cardKey,
  collapseShelves,
  detailHref,
  contextFill,
  gardenTree,
  groupShelves,
  shelfPairs,
  sharedFiles,
  treeKey,
  W,
  H,
} from '../../lib/garden.js'
import { PadCard, readSakura, SAKURA_KEY, TreeSvg } from './Bonsai.jsx'

// The Garden view of Activity: every live session as a pixel bonsai, one shelf per repo
// (D11), the trees of a repo side by side as a grove (D13). The drawing is lib/garden.js;
// this file lays the shelves out, labels the trees and answers hovers.

// One tree pixel is 4 CSS pixels (an integer, so every pixel renders the same size). Cells have a fixed width so a shelf's collision threads
// can be placed by index, without measuring the DOM.
const PX = 4
const CELL = W * PX
const GAP = 24
const MOSS_Y = 41 * PX + 1
const POT_Y = 47 * PX

const pct = (s) => {
  const f = contextFill(s)
  return f == null ? null : Math.round(f * 100)
}

// What the tree says, for a screen reader: the hovers cannot be reached by keyboard.
function treeLabel(s, t, mine) {
  const st = STATUS[s.status] || STATUS.idle
  const running = t.pads.filter((p) => p.key != null)
  const files =
    t.pads.reduce((n, p) => n + p.files.length, 0) +
    t.fallen.reduce((n, f) => n + f.files.length, 0)
  const c = pct(s)
  return [
    `${s.title || baseName(s.cwd) || s.session_id}, ${s.chip || s.host || 'unknown host'}, ${st.label}${s.phase ? `, ${s.phase}` : ''}`,
    `${s.turns || 0} turns${c == null ? '' : `, context ${c} %`}${s.compactions ? `, ${s.compactions} compactions` : ''}`,
    running.length
      ? `${running.length} sub-agent${running.length === 1 ? '' : 's'} running: ${running.map((p) => `${p.type || 'agent'} (${p.files.length} file${p.files.length === 1 ? '' : 's'})`).join(', ')}`
      : '',
    t.fallen.length ? `${t.fallen.length} finished` : '',
    `${files} file${files === 1 ? '' : 's'} changed`,
    mine.length
      ? `shares ${mine.length} file${mine.length === 1 ? '' : 's'} with another session`
      : '',
    s.error ? `error: ${s.error}` : '',
  ]
    .filter(Boolean)
    .join('. ')
}

function TreeCard({ s, t, mine }) {
  const c = pct(s)
  return (
    <div className="card gd-card">
      <dl className="gd-facts">
        {s.model && (
          <>
            <dt>model</dt>
            <dd className="mono">{s.model}</dd>
          </>
        )}
        <dt>turns</dt>
        <dd>{s.turns || 0}</dd>
        <dt>context</dt>
        <dd>{c == null ? 'unknown' : `${c} %`}</dd>
        <dt>compactions</dt>
        <dd>{s.compactions || 0}</dd>
      </dl>
      {t.fallen.length > 0 && (
        <div className="dim act-xs">
          finished: {t.fallen.map((f) => `${f.type || 'agent'} (${f.files.length})`).join(', ')}
        </div>
      )}
      {mine.map((m) => (
        <div
          key={`${m.kind}:${m.path}`}
          className={`act-xs ${m.kind === 'same-worktree' ? 't-bad' : 't-warn'}`}
        >
          same file{m.kind === 'same-worktree' ? '' : ', other worktree'}: {m.path}
        </div>
      ))}
    </div>
  )
}

// `pad` is the hovered pad's index on this tree, or null; `onHover(sid, pad)` reports a hover
// to the shelf, which shows the card (a card inside the scrolling row would be clipped).
function Tree({ s, worktree, sakura, mine, pad, onHover }) {
  const key = treeKey(s, sakura)
  // Keyed on what the drawing reads, so the 2 s poll leaves an unchanged tree alone.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => gardenTree(s, { sakura }), [key])
  const st = STATUS[s.status] || STATUS.idle
  const loop = Array.isArray(s.loops) ? s.loops[0] : null
  const swaying = s.status !== 'idle'
  const sid = cardKey(s)
  // Stable, so the tree's ~400 rects are rebuilt only when its drawing or its hover changes.
  const onPad = useCallback((p) => onHover(sid, p), [onHover, sid])
  return (
    <a
      className={`gd-tree${needsYou(s) ? ' gd-needs' : ''}`}
      href={s.href || detailHref(s.session_id)}
      aria-label={treeLabel(s, t, mine)}
      data-sid={s.session_id}
      onMouseEnter={(e) => onHover(sid, null, xOf(e.currentTarget))}
      onMouseLeave={() => onHover(null, null)}
      onFocus={(e) => onHover(sid, null, xOf(e.currentTarget))}
      onBlur={() => onHover(null, null)}
    >
      <div className="gd-label">
        <div className="act-ell">
          <span className="badge mono" title="The install this session runs in">
            {s.chip || s.host || '?'}
          </span>{' '}
          {s.title || baseName(s.cwd) || s.session_id}
        </div>
        <div className="row gap-8 gd-sub">
          <span className={`badge ${st.cls}`}>{st.label}</span>
          {worktree && <span className="badge mono">⎇ {worktree}</span>}
          {loop && (
            <span className="badge">
              ↻ {loop.title}
              {loop.iteration != null ? ` ${loop.iteration}` : ''}
            </span>
          )}
          {s.attribution === false && (
            <span className="badge" title={`attribution unavailable on ${s.host}`}>
              no attrib.
            </span>
          )}
          {s.phase && <span className="dim act-ell">{s.phase}</span>}
        </div>
      </div>
      <TreeSvg t={t} pad={pad} swaying={swaying} onPad={onPad} px={PX} />
    </a>
  )
}

// A collision between two trees on one shelf: neighbours get tangled roots in the moss, trees
// further apart a thread under the pots. Red is the same file in the same worktree, amber
// (dashed, and lighter) the same file in two worktrees of one repo.
function Threads({ pairs, count }) {
  if (!pairs.length) return null
  const width = count * CELL + (count - 1) * GAP
  const cx = (i) => i * (CELL + GAP) + CELL / 2
  return (
    <svg className="gd-threads" width={width} height={H * PX + 20} aria-hidden="true">
      {pairs.map(({ a, b, kind }) => {
        const [i, j] = a < b ? [a, b] : [b, a]
        const cls = `gd-thread ${kind === 'same-worktree' ? 'red' : 'amber'}`
        if (j - i === 1) {
          const x0 = cx(i) + 30
          const x1 = cx(j) - 30
          const m = (x0 + x1) / 2
          return (
            <g key={`${i}-${j}`} className={cls}>
              <path
                d={`M${x0} ${MOSS_Y} C${m} ${MOSS_Y + 14} ${m} ${MOSS_Y - 6} ${x1} ${MOSS_Y + 4}`}
              />
              <path
                d={`M${x0} ${MOSS_Y + 4} C${m} ${MOSS_Y - 6} ${m} ${MOSS_Y + 14} ${x1} ${MOSS_Y}`}
              />
            </g>
          )
        }
        return (
          <g key={`${i}-${j}`} className={cls}>
            <path
              d={`M${cx(i)} ${POT_Y} Q${(cx(i) + cx(j)) / 2} ${POT_Y + 34} ${cx(j)} ${POT_Y}`}
            />
          </g>
        )
      })}
    </svg>
  )
}

// Where the hovered tree stands in its shelf, after the row's sideways scroll.
const xOf = (el) => el.offsetLeft - (el.parentElement?.scrollLeft || 0)

export default function Garden({ sessions, collisions }) {
  const [sakura, setSakura] = useState(readSakura)
  const [opened, setOpened] = useState(() => new Set())
  const toggleSakura = () => {
    const next = !sakura
    setSakura(next)
    try {
      window.localStorage.setItem(SAKURA_KEY, next ? '1' : '0')
    } catch {}
  }
  const cols = Array.isArray(collisions) ? collisions : []
  const shelves = collapseShelves(groupShelves(sessions)).map((sh) =>
    opened.has(sh.key) ? { ...sh, collapsed: false } : sh,
  )
  const folded = shelves.filter((sh) => sh.collapsed)
  const mineOf = (sid) => sharedFiles(sid, cols)
  return (
    <section className="gd" aria-label="Garden">
      <div className="row between wrap gap-8 gd-head">
        <span className="dim act-sm">
          {sessions.length} tree{sessions.length === 1 ? '' : 's'} · {shelves.length}{' '}
          {shelves.length === 1 ? 'shelf' : 'shelves'} · hover a tree, or one of its pads, for its
          details
        </span>
        <button
          type="button"
          className={sakura ? 'chip-f on' : 'chip-f'}
          aria-pressed={sakura}
          onClick={toggleSakura}
        >
          Sakura
        </button>
      </div>
      {folded.length > 0 && (
        <div className="row wrap gap-8 gd-chips" role="group" aria-label="Folded shelves">
          {folded.map((sh) => (
            <button
              key={sh.key}
              type="button"
              className="chip-f"
              aria-expanded={false}
              onClick={() => setOpened((o) => new Set(o).add(sh.key))}
            >
              {sh.name} · {sh.trees.length}
            </button>
          ))}
        </div>
      )}
      {shelves
        .filter((sh) => !sh.collapsed)
        .map((sh) => (
          <Shelf key={sh.key} sh={sh} sakura={sakura} cols={cols} mineOf={mineOf} />
        ))}
    </section>
  )
}

function Shelf({ sh, sakura, cols, mineOf }) {
  const [hover, setHover] = useState({ sid: null, pad: null, x: 0 })
  // A pad hover keeps the x its tree reported on entry.
  const onHover = useCallback(
    (sid, pad, x) => setHover((h) => ({ sid, pad, x: x ?? (h.sid === sid ? h.x : 0) })),
    [],
  )
  const cur = sh.trees.find((x) => cardKey(x.s) === hover.sid)?.s
  // The hovered tree only: one more draw per hover, never per poll.
  const t = cur ? gardenTree(cur, { sakura }) : null
  const hot = t && hover.pad != null ? t.pads[hover.pad] : null
  return (
    <section className="gd-shelf" aria-label={`${sh.name} shelf`}>
      <h3 className="act-lbl gd-shelf-h">
        {sh.name} <span className="dim">· {sh.trees.length}</span>
      </h3>
      <div className="gd-row">
        {sh.trees.map(({ s, worktree }) => (
          <Tree
            key={cardKey(s)}
            s={s}
            worktree={worktree}
            sakura={sakura}
            mine={mineOf(cardKey(s))}
            pad={cardKey(s) === hover.sid ? hover.pad : null}
            onHover={onHover}
          />
        ))}
        <Threads pairs={shelfPairs(sh.trees, cols)} count={sh.trees.length} />
      </div>
      {/* An overlay under the hovered tree, drawn only while something is hovered: it takes
          no room in the layout, so a hover never moves the page. */}
      {cur && (
        <div className="gd-info" aria-hidden="true" style={{ left: Math.max(0, hover.x) }}>
          {hot ? <PadCard pad={hot} /> : <TreeCard s={cur} t={t} mine={mineOf(cardKey(cur))} />}
        </div>
      )}
    </section>
  )
}
