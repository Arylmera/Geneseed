import React from 'react'
import { useViewLevel } from '../hooks/useViewLevel.jsx'
import { LEVELS, requiredLevel } from '../lib/tiers.js'
import { useActiveLoops } from '../hooks/useActiveLoops.js'
import { useActiveFactories } from '../hooks/useActiveFactories.js'

// A loop or factory run keeps working when its page leaves the rail, so the rail foot says so
// instead of letting a lowered level hide live work. Both kinds count `running` and `awaiting`
// (the latter needs the reader); `stopped`, `done` and `finished` are ended runs.
const isLive = (r) => r.status === 'running' || r.status === 'awaiting'
const count = (list) => (list ? list.filter(isLive).length : 0)
const labelOf = (page) => LEVELS.find((l) => l.id === requiredLevel({ page })).label

// Each poller mounts only while its page is hidden, so a level that shows both costs no request.
function Line({ n, noun, href, page }) {
  if (!n) return null
  return (
    <a className="sb-live" href={href}>
      {`${n} ${noun}${n === 1 ? '' : 's'} running · ${labelOf(page)}`}
    </a>
  )
}
function LoopsLine() {
  const { loops } = useActiveLoops()
  return <Line n={count(loops)} noun="loop" href="#/loops/active" page="loops" />
}
function FactoriesLine() {
  const { runs } = useActiveFactories()
  return <Line n={count(runs)} noun="factory run" href="#/factories/active" page="factories" />
}

export default function HiddenLive() {
  const { canSee } = useViewLevel()
  const loops = !canSee('page:loops')
  const factories = !canSee('page:factories')
  if (!loops && !factories) return null
  return (
    <div className="sb-live-foot" role="status">
      {loops ? <LoopsLine /> : null}
      {factories ? <FactoriesLine /> : null}
    </div>
  )
}
