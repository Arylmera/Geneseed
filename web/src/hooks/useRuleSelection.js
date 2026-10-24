import { useEffect } from 'react'
import { useConfirm } from './useConfirm.jsx'
import { sortedKey, useStaging } from './useStaging.jsx'

// The Constitution's doctrine selection: which rules the switches have STAGED, against what the
// deployed install carries, and the one Apply that rebuilds with the whole set. `items` is the
// catalog's `laws` payload (empty while loading), `packs` the page's doctrine rows grouped by
// pack. Called before the page's early returns — it holds state, so the number of hooks must
// not differ between the loading render and the loaded one.
//
// The staged rules live in the App-level store (hooks/useStaging.jsx), keyed by the install, so
// they survive leaving the page and coming back.
export function useRuleSelection({ items, packs, install, canApply, onAction, gateArmed }) {
  const confirm = useConfirm()
  // ⚠ THE UNIT IS THE RULE, not the pack. The selection below is a list of rule ADDRESSES
  // (`process.7`), and the pack axis is DERIVED from it when Apply builds the request: a
  // pack with every rule off drops out of `--doctrines` entirely, so the rendered AGENT.md
  // never carries a pack header with nothing under it.
  const deployedRules = items
    .filter((i) => i.tier === 'doctrine' && i.active !== false)
    .map((i) => i.name)
  const deployedKey = deployedRules.join(',')
  const store = useStaging()
  const key = install ? `${install.host}:${install.scope}:${install.path}` : ''
  const base = sortedKey(deployedRules)
  // ⚠ DERIVED ON READ, NEVER RESET DURING RENDER. The staged list counts only while it was
  // staged against the rules deployed now (compared on the VALUE: `items` is a fresh array on
  // every refetch). A remount's loading render has no items and simply reads the deployed set;
  // a reset there would wipe the stored selection before the data came back.
  // Pruned only once the catalog is in: the loading render's empty base is no evidence.
  const { prune } = store
  const loaded = items.length > 0
  useEffect(() => {
    if (loaded) prune('rules', (k, e) => k === key && e.base !== base)
  }, [loaded, key, base, prune])
  const entry = store.get('rules', key)
  const picked = entry && entry.base === base ? entry.value : deployedRules
  const setPicked = (next) => store.put('rules', key, next(picked), base)
  const isOn = (addr) => picked.includes(addr)

  // ---- the pack selection: STAGED here, applied once -------------------------------------
  //
  // ⚠ ONE REBUILD, NOT ONE PER TOGGLE. A selection is a SET: acting on each click would
  // re-emit the install once per switch, each rebuild describing a state nobody asked for.
  // So the switches edit local state and `Apply` sends the whole selection.
  const toggleRule = (addr) =>
    setPicked((cur) => (cur.includes(addr) ? cur.filter((a) => a !== addr) : [...cur, addr]))
  // A pack is on when any of its rules is. Its switch is tri-state: with every rule on it turns
  // them all off; with some or none on it turns them all on (a partial pack goes ON first).
  const packOn = (p) => p.rules.some((r) => isOn(r.addr))
  const togglePack = (p) => {
    const addrs = p.rules.map((r) => r.addr)
    const allOn = p.rules.every((r) => isOn(r.addr))
    setPicked((cur) =>
      allOn ? cur.filter((a) => !addrs.includes(a)) : [...new Set([...cur, ...addrs])],
    )
  }
  // ⚠ A STAGED PACK MUST NOT READ AS A DEPLOYED ONE. `p.active` is what the install built;
  // `packOn(p)` is what the switches currently say. Where they differ the line says so.
  const packState = (p) => {
    const on = p.rules.filter((r) => isOn(r.addr)).length
    if (!on) return p.active ? 'staged off' : 'not built in'
    if (!p.active) return `staged on · ${on} of ${p.rules.length}`
    return `${on} of ${p.rules.length} active`
  }
  const allRules = packs.flatMap((p) => p.rules.map((r) => r.addr))
  const pickedRules = allRules.filter(isOn)
  const dirty = pickedRules.join(',') !== deployedKey
  const CONSENT = 'process.5'
  const losingConsent = deployedRules.includes(CONSENT) && !picked.includes(CONSENT)

  // ⚠ TWO AXES OUT OF ONE SELECTION. The user only ever touches rules; the request carries
  // both `doctrines` (the packs with at least one rule left) and `excludeRules` (the rules
  // dropped from the packs that survive).
  const applyPacks = async () => {
    if (!canApply || !dirty) return
    const keptPacks = packs.filter((p) => p.rules.some((r) => isOn(r.addr))).map((p) => p.pack)
    const excludeRules = packs
      .filter((p) => keptPacks.includes(p.pack))
      .flatMap((p) => p.rules.filter((r) => !isOn(r.addr)).map((r) => r.addr))
    const warn = losingConsent
      ? '\n\nprocess 5 carries commit/push consent. Dropping it also removes the git-gate ' +
        'hook, so commits and pushes stop being confirmed at the tool boundary. ' +
        (gateArmed
          ? '(Real data loss stays gated: that is Rule IV’s, not the pack’s.)'
          : '(Rule IV’s deletion gate is off on this install, so real data loss is not asked about either.)')
      : ''
    const what = pickedRules.length
      ? `${pickedRules.length} of ${allRules.length} doctrine rules`
      : 'no doctrine rules'
    const ok = await confirm(
      `Rebuild ${install.host} · ${install.scope} with ${what}? ` +
        `It rebuilds in place, non-destructive.${warn}`,
      { title: 'Rebuild with these rules?', confirmLabel: 'Rebuild' },
    )
    if (!ok) return
    // runAction resolves to the job id, or undefined when the server refused it.
    const job = await onAction('install', { ...install, doctrines: keptPacks, excludeRules })
    if (job) store.startApply('rules', key)
  }
  const revert = () => store.drop('rules', key)

  return {
    deployedRules,
    isOn,
    toggleRule,
    packOn,
    togglePack,
    packState,
    allRules,
    pickedRules,
    dirty,
    losingConsent,
    applyPacks,
    revert,
  }
}
