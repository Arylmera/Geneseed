import React from 'react'
import { dotColour } from '../lib/hosts.js'
import { Icon } from './Icon.jsx'

// The Library's "Ships to" row for one skill, and the bar that applies what it staged. The row
// replaces the reader's Install select for skills (the copies are one source, so reading another
// install's copy rarely showed anything new): one chip per install says where the skill ships
// and switches it there. The user chose this over a switch per install or a scope picker
// (Option A of the 2026-11-21 Library design canvas).
//
// The server decides what a chip can do (`ships`, `toggle`, `locked` on the catalog row,
// js/web/catalog.mjs `skillShipping`); this file only renders it. Only `on` and `excluded`
// switch: a `kit-off` chip points at the Kits page, an `absent` one says the host does not ship it.
//
// An agent's page shows the same row READ-ONLY (`kind="agent"`, no `stage`): it replaces the
// Install select there too, and no build axis excludes an agent yet (the user, 2026-11-21). A chip
// that cannot switch is a plain label, not a disabled button, so its title (the why) still shows.
const STATE_TEXT = {
  on: '',
  excluded: 'excluded',
  'turning-off': 'turns off',
  'turning-on': 'comes back',
  'kit-off': 'kit off',
  absent: 'not shipped',
}

function chipTitle(state, tag, row, kind) {
  if (state === 'kit-off') return `${row.name} is in the ${row.kit} kit, which is off in ${tag}: turn it on in Kits`
  if (kind === 'agent') {
    if (state === 'absent') return `${tag} does not ship ${row.name}`
    if (row.locked) return `${row.name} is a core agent: it ships with every install`
    return row.kit ? `Ships to ${tag} with the ${row.kit} kit` : `Ships to ${tag}`
  }
  if (row.locked) return `The harness links to ${row.name} by path, so it cannot be excluded`
  if (!row.toggle) return `${row.name} is not a Geneseed skill: there is nothing to switch`
  if (state === 'absent') return `${tag} does not ship ${row.name}`
  if (state === 'on') return `Ships to ${tag}: click to exclude it there`
  if (state === 'excluded') return `Excluded from ${tag}: click to bring it back`
  return `Staged for ${tag}: click to undo`
}

// `keys` are the fleet keys in dot-slot order (`fleetKeys`), so a chip has its list dot's colour.
export function ShipsTo({ row, keys, tagOf, stage = null, busy = false, kind = 'skill' }) {
  const shown = keys.filter((k) => row.ships && k in row.ships)
  if (!shown.length) return null
  return (
    <div className="ships-to">
      <span className="ships-to-h mono">Ships to</span>
      <div className="ships-to-chips">
        {shown.map((k) => {
          const i = keys.indexOf(k)
          const state = stage ? stage.stateOf(row, k) : row.ships[k]
          const tag = tagOf(k)
          const switchable =
            !!stage && row.toggle && ['on', 'excluded', 'turning-off', 'turning-on'].includes(state)
          const lit = state === 'on' || state === 'turning-on'
          // A protected entry that ships reads "always on" behind a padlock: greyed, never a switch.
          const text = row.locked && state === 'on' ? 'always on' : STATE_TEXT[state]
          const cls = `ship-chip ship-${state}${row.locked ? ' locked' : ''}${switchable ? '' : ' fixed'}`
          const title = chipTitle(state, tag, row, kind)
          const body = (
            <>
              {row.locked ? (
                <Icon name="lock" className="glyph ship-lock" style={dotColour(i)} />
              ) : (
                <i className="ship-dot" style={dotColour(i)} aria-hidden="true" />
              )}
              {tag}
              {text ? <span className="ship-state">{text}</span> : null}
            </>
          )
          if (!switchable) {
            return (
              <span key={k} className={cls} title={title}>
                {body}
              </span>
            )
          }
          return (
            <button
              type="button"
              key={k}
              className={cls}
              aria-pressed={lit}
              aria-label={`${row.name} in ${tag}: ${text || 'ships'}`}
              title={title}
              disabled={busy || stage.running(k)}
              onClick={() => stage.toggle(k, row.name)}
            >
              {body}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// One Apply per install with staged changes: the server runs one job at a time, so each waits
// while any job runs. The changes stack across skills, so an install rebuilds once.
export function SkillApplyBar({ tagOf, installOf, stage }) {
  if (!stage.staged.length) return null
  return (
    <div className="skill-apply" role="region" aria-label="Staged skill changes">
      {stage.staged.map((k) => {
        const { on, off } = stage.change(k)
        const what = [...off.map((n) => `−${n}`), ...on.map((n) => `+${n}`)].join(', ')
        const running = stage.running(k)
        return (
          <div className="skill-apply-row" key={k}>
            <span className="skill-apply-n">
              {on.length + off.length} change{on.length + off.length === 1 ? '' : 's'}
            </span>
            <span className="mono skill-apply-what">
              {tagOf(k)}: {what}
            </span>
            <span className="sub skill-apply-hint" role="status">
              {running ? 'Rebuilding…' : stage.failed(k) ? 'Last rebuild failed — see console' : ''}
            </span>
            <button
              type="button"
              className="btn ghost sm"
              disabled={running}
              onClick={() => stage.discard(k)}
            >
              Revert
            </button>
            <button
              type="button"
              className="btn soft sm"
              aria-label={`Apply skill changes and rebuild ${tagOf(k)}`}
              disabled={running || stage.busy}
              title={stage.busy && !running ? 'A job is running' : undefined}
              onClick={() => stage.apply(k, installOf(k))}
            >
              Apply · rebuild {tagOf(k)}
            </button>
          </div>
        )
      })}
    </div>
  )
}
