import { resolveRoute } from './router.js'

// The console's view levels. A level shows every surface at or below its rank, so the
// order here is the order of the Settings picker too.
export const LEVELS = [
  { id: 'essentials', label: 'Essentials', rank: 1 },
  { id: 'standard', label: 'Standard', rank: 2 },
  { id: 'power', label: 'Power', rank: 3 },
]

const RANK = Object.fromEntries(LEVELS.map((l) => [l.id, l.rank]))

// An unknown level reads as the lowest, so a bad stored value hides surfaces rather than
// opening them all.
export const rankOf = (level) => (Object.hasOwn(RANK, level) ? RANK[level] : 1)

const group = (level, keys) => keys.map((k) => [k, level])

// Surface key -> the lowest level that shows it. Every surface has a row, Essentials
// included, so a test can demand one for each page, tab and section the console grows.
// Keys: page:<id>, tab:<page>/<tab>, section:library/<kind>, section:settings/<id>,
// field:install/<pick> (a build choice on the install panel and the deploy form).
export const TIER = Object.fromEntries([
  ...group('essentials', [
    'page:overview',
    'page:laws',
    'page:library',
    'page:installs',
    'page:personal',
    'page:docs',
    'page:settings',
    'tab:personal/rules',
    'tab:personal/profile',
    'tab:installs/hosts',
    'tab:installs/doctor',
    'section:library/skills',
    'section:library/agents',
    'section:settings/machine',
    'section:settings/server',
    'section:settings/about',
    'field:install/footprint',
    'field:install/posture',
  ]),
  ...group('standard', [
    'page:kits',
    'page:activity',
    'tab:personal/memory',
    'tab:installs/profiles',
    'field:install/voice',
    'field:install/mode',
    'field:install/trust',
    'field:install/context-window',
  ]),
  ...group('power', [
    'page:models',
    'page:loops',
    'page:factories',
    'tab:loops/templates',
    'tab:loops/bricks',
    'tab:loops/active',
    'tab:factories/templates',
    'tab:factories/active',
    'tab:personal/notebook',
    'tab:installs/edits',
    'section:library/wiki',
    'section:library/config',
    'section:settings/danger',
  ]),
])

// A key the table does not know shows at every level: a new surface stays reachable
// until someone files it.
export function visible(key, level) {
  return !Object.hasOwn(TIER, key) || rankOf(TIER[key]) <= rankOf(level)
}

// The level a route needs: the highest of its page, tab and Library section. Laws and
// Personal reuse `section` for their own sub-address, so only Library's counts.
export function requiredLevel({ page, tab, section } = {}) {
  const keys = [`page:${page}`]
  if (tab) keys.push(`tab:${page}/${tab}`)
  if (page === 'library' && section) keys.push(`section:library/${section}`)
  let top = LEVELS[0]
  for (const k of keys) {
    const l = LEVELS.find((x) => x.id === TIER[k])
    if (l && l.rank > top.rank) top = l
  }
  return top.id
}

export const levelOfHref = (href) => requiredLevel(resolveRoute(href))
