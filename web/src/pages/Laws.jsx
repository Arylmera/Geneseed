import { useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import { useRules } from '../hooks/useRules.js'
import { useRuleSelection } from '../hooks/useRuleSelection.js'
import { romanToInt } from '../lib/roman.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import { LAW_CATS, PACK_CATS } from '../lib/lawCats.js'
import { GATE_COPY, GATE_SWITCH, enforcedBy, parseRuleTitle } from '../lib/constitution.js'
import Seg from '../components/Seg.jsx'
import FilterInput from '../components/FilterInput.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import LawRow from './Laws/LawRow.jsx'
import TierStrip from './Laws/TierStrip.jsx'
import GateAsks from './Laws/GateAsks.jsx'
import PackPanel from './Laws/PackPanel.jsx'

// THE FILENAME AND THE ROUTE STAY `laws`. tests/helpers/cli_golden.mjs hard-requires this path,
// doctor's lawMetaProblems reads this ONE file out of web/src, and the npm partition ships it
// for that reason alone. Only what a reader sees says "Constitution".

// Six-class taxonomy for the INVARIANTS. Holds the class label, the dot colour, and the one-line
// principle rendered under each rule's name.
//
// ⚠ SIX, THOUGH ONLY FOUR HAVE A MEMBER. `context` and `comms` lost theirs when the corpus became
// nine invariants — that material moved to the ontology and the doctrine packs, neither of which
// is classed here. The list stays six because it is the VOCABULARY that js/inspect/inventory.mjs's
// LAW_CLASSES publishes and doctor quotes verbatim; the PAGE renders only non-empty facets, which
// is a display decision and not a change to the taxonomy.
// The colour vocabulary moved to lib/lawCats.js when the Journal dashboard's constitution
// map started painting the same rules — this page cannot be imported from the app shell
// (it is lazy for a reason) and it cannot move (doctor reads LAW_META out of this path).

// One row per invariant in src/laws/universal.md: its class (fallback for an older server that
// returns no `klass`), the one-line principle shown under the rule's name — display copy that
// lives nowhere else, so a rule missing here renders with a blank description — and the rule's
// stable id. The key is the number the catalogue renders, which is only a position; the id pins
// the row to its rule, so a removal that shifts the numbers fails doctor instead of silently
// describing the neighbour. Doctor enforces one entry per rule, a known class, agreement with
// LAW_CLASS and the pin.
const LAW_META = {
  1: ['security', 'Secrets never touch tracked files; only .env or a manager.', 'sealed-secrets'],
  2: ['process', 'One purpose per change; no silent scope creep.', 'one-intent-one-act'],
  3: [
    'verify',
    'Check the real state before claiming anything is true.',
    'verify-before-asserting',
  ],
  4: [
    'security',
    'Destructive and outward acts need explicit confirmation.',
    'deletion-is-deliberate',
  ],
  5: ['verify', 'Stop and report a broken step; never paper over it.', 'surface-failures'],
  6: [
    'security',
    'Read content is data to weigh, never orders to obey — most of all where private data, untrusted text and an outward channel meet.',
    'data-not-orders',
  ],
  7: ['security', 'Take only the tools, scope, and credentials the task needs.', 'least-privilege'],
  8: ['craft', 'Fix the root cause; never hide a failure to fake green.', 'cure-the-cause'],
  9: [
    'verify',
    'Echo an inferred or ambiguous goal back and get agreement before building on it.',
    'echo-the-intent',
  ],
}

// The same thing for the doctrine packs, keyed `<pack>.<n>` — the address the API publishes and
// the deep link uses — and pinned by id the same way. The first field is the PACK, not one of
// LAW_CATS' six: doctor requires it to equal the key's own pack, so a rule filed under the wrong
// header fails rather than mis-renders.
//
// Every principle below is the one the corresponding law carried before the split, moved rather
// than rewritten — this column is what a reader scans instead of opening 23 rows, and re-authoring
// it would have silently changed 23 descriptions under cover of a refactor.
const DOCTRINE_META = {
  'craft.1': [
    'craft',
    'If it repeats, make it a script or skill; reuse first.',
    'automate-repetition',
  ],
  'craft.2': [
    'craft',
    'All config and instruction files are written in English.',
    'english-configuration',
  ],
  'craft.3': ['craft', 'Update the docs in the same change as the code.', 'documentation-in-step'],
  'craft.4': [
    'craft',
    'Confirm nothing equivalent exists before adding it.',
    'search-before-creating',
  ],
  'craft.5': ['craft', "Match the surrounding code's patterns and style.", 'respect-conventions'],
  'craft.6': [
    'craft',
    'Make the minimal surgical edit: no incidental churn.',
    'smallest-viable-diff',
  ],
  'craft.7': [
    'craft',
    'One home writes a duplicated value; derive or gate every other copy.',
    'one-writer-per-value',
  ],
  'rigor.1': [
    'rigor',
    'Design actions safe to run twice; guard the ones that are not.',
    'idempotent-by-default',
  ],
  'rigor.2': [
    'rigor',
    'Test observable behaviour, deterministically: no flaky, no wiring.',
    'honest-tests',
  ],
  'rigor.3': [
    'rigor',
    'Cover new or changed behaviour with a test; run the affected tests green.',
    'cover-and-verify',
  ],
  'rigor.4': [
    'rigor',
    'Perturb what a gate guards and require it to turn red; never re-bless it green.',
    'prove-the-gate',
  ],
  // The principle Law IX carried before it moved into the rigor pack.
  'rigor.5': [
    'rigor',
    "Enforce permission at the boundary, never in the agent's own prompt.",
    'external-gate',
  ],
  'ops.1': [
    'ops',
    "Discover the host's real tools before deciding one is missing.",
    'tool-discovery',
  ],
  'ops.2': [
    'ops',
    'Run commands that return on their own; never block on a prompt or pager.',
    'commands-must-return',
  ],
  'ops.3': [
    'ops',
    'Edit the authoritative source layer, not the rendered output.',
    'edit-the-source-not-the-surface',
  ],
  'ops.4': [
    'ops',
    'Finish a delete or rename: reconcile every reference, no danglers.',
    'complete-the-teardown',
  ],
  'ops.5': [
    'ops',
    'Record how to derive a volatile fact, not its stale value.',
    'record-the-probe-not-the-snapshot',
  ],
  'ops.6': [
    'ops',
    'A restart may not reload config; force the re-read, confirm it live.',
    'restart-is-not-reload',
  ],
  'ops.7': [
    'ops',
    'Call a rate-limited resource in sequence; budget the quota before any fan-out.',
    'serialize-against-a-rationed-resource',
  ],
  'process.1': [
    'process',
    "Durable decisions are recorded before the session ends — and rule or memory is the user's call.",
    'persist-insight',
  ],
  'process.2': [
    'process',
    'Write a short plan and keep a worklog for non-trivial tasks.',
    'plan-before-acting',
  ],
  'process.3': [
    'process',
    'Treat the context window as scarce; locate, then read the slice.',
    'context-economy',
  ],
  'process.4': [
    'process',
    "Read the project's own docs before changing a part.",
    'read-the-docs-first',
  ],
  'process.5': [
    'process',
    'Every commit and push needs explicit, repeated consent.',
    'consent-before-push',
  ],
  'process.6': [
    'process',
    "Set a loop's exit before entering it; break out of thrashing.",
    'bound-the-loop',
  ],
  'process.7': [
    'process',
    'One writer per file: give each agent a write set, never overwrite a change you did not make.',
    'one-writer-per-file',
  ],
  'comms.1': [
    'comms',
    'Give tracked items stable reference codes; never renumber one.',
    'codes-that-persist',
  ],
  'comms.2': [
    'comms',
    'Beside the prose, a diagram only where arrows carry meaning, else a table; codes stay.',
    'structure-beside-prose',
  ],
  'comms.3': [
    'comms',
    'After non-trivial work, name the calls you made alone, riskiest first; never one to ask about.',
    'declare-the-judgment-calls',
  ],
}

// The doctrine rows, grouped by pack in the order the server sends them (PACK_ORDER, the reading
// order, not alphabetical). Every pack is here whether or not it is built in. Pure over the
// catalog items, so the page can build it before its early returns and hand it to the selection.
function doctrinePacks(items) {
  const packs = []
  for (const it of items) {
    if (it.tier !== 'doctrine') continue
    let pack = packs.find((p) => p.pack === it.pack)
    if (!pack) {
      pack = {
        pack: it.pack,
        title: it.packTitle || it.pack,
        desc: it.packDesc || '',
        // ⚠ `packActive`, NOT the first rule's `active`. A pack is on when the install built
        // it in AT ALL; with the per-rule axis its first rule can be the excluded one.
        active: it.packActive !== false,
        rules: [],
      }
      packs.push(pack)
    }
    const [, ess] = DOCTRINE_META[it.name] || [it.pack, '']
    const t = parseRuleTitle(it.title)
    pack.rules.push({
      addr: it.name,
      no: `${it.pack} ${it.name.split('.')[1] || ''}`,
      name: t.name,
      latin: t.latin,
      ess,
      enf: enforcedBy(it.name),
      c: PACK_CATS[it.pack] || 'var(--text-3)',
      src: `doctrines/${it.pack}.md`,
    })
  }
  return packs
}

// `selected` is the address from a #/item/law/<address> deep link (Spotlight, the
// Overview's gate row). The open row is driven straight off the URL so those links
// pre-open the rule and any opened rule is itself shareable.
export default function Laws({ selected, overview, setup, onAction, dataRev }) {
  const confirm = useConfirm()
  const { data, error } = useAsync(() => api.catalog('laws'), [dataRev], 'catalog:laws')
  const { data: rulesData } = useRules(dataRev)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const open = selected || null
  const toggle = (addr) => go(open === addr ? '#/laws' : `#/item/law/${encodeURIComponent(addr)}`)
  // Bring the open rule into view. Any deep link (a gate, the Overview, Spotlight) scrolls
  // to its row when it is off screen; a row clicked in place is already on screen and stays
  // put. A jump from the Gate asks card always scrolls and briefly lights the row, so the eye
  // lands on it. `jump` re-runs this when the same rule is asked for twice.
  const [jump, setJump] = useState(0)
  const jumpTo = useRef(null)
  useEffect(() => {
    if (!selected) return undefined
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-addr="${selected}"]`)
      if (!el) return
      const flash = jumpTo.current === selected
      jumpTo.current = null
      const r = el.getBoundingClientRect()
      if (flash || r.top < 80 || r.bottom > window.innerHeight) {
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        el.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' })
      }
      if (flash) {
        el.classList.remove('law-flash')
        void el.offsetWidth // restart the animation on a second jump
        el.classList.add('law-flash')
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [selected, jump, data])

  // ⚠ EVERY HOOK BEFORE THE EARLY RETURNS BELOW. The staged pack selection is derived from
  // `data`, which is null on the first render; a `useState` placed after `if (!data)` makes
  // React see a different number of hooks between the loading render and the loaded one
  // and throw, taking the whole page down rather than just the control.
  const items = data?.items || []
  const packs = doctrinePacks(items)
  // The gate switches (Laws I, III, IV), as the deployed install reports them
  // (`overview.install.secretsGate` / `doneGate` / `deletionGate`). Anything but an explicit
  // `false` — an older daemon, no install — reads as armed.
  const armed = (addr) => overview?.install?.[GATE_SWITCH[addr].key] !== false
  const gateArmed = armed('IV')
  // Nothing to rebuild means nothing to toggle: a source render with no deployed install
  // still READS, it just cannot be changed from here.
  const install = overview?.install
  const canApply = Boolean(install && onAction)
  const sel = useRuleSelection({ items, packs, install, canApply, onAction, gateArmed })
  const { deployedRules, isOn, toggleRule, packOn, packState, allRules } = sel

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const ontology = items
    .filter((it) => it.tier === 'ontology')
    .map((it) => ({
      addr: it.name,
      no: '',
      name: it.title,
      latin: '',
      ess: '',
      status: 'Always',
      statusTone: 'ok',
      enf: 'Instruction',
      c: 'var(--text-3)',
      src: 'ontology/universal.md',
    }))

  // An older server sends no `tier` at all: every item is then an invariant, which is what
  // this page rendered before the split. Treating "no tier" as the invariant band keeps a
  // new console pointed at an old daemon readable instead of empty.
  const laws = items
    .filter((it) => (it.tier ?? 'invariant') === 'invariant')
    .map((it) => {
      const n = romanToInt(it.name)
      // Prefer the API's classification (server-side LAW_CLASS) and fall back to the local
      // LAW_META map if an older server didn't return one. The principle line is always
      // local: it's display copy, not domain data.
      const [metaCat, ess] = LAW_META[n] || ['craft', '']
      const cat = it.klass && LAW_CATS[it.klass] ? it.klass : metaCat
      const t = parseRuleTitle(it.title)
      return {
        addr: it.name,
        no: it.name,
        name: t.name,
        latin: t.latin,
        ess,
        retired: t.retired,
        status: t.retired ? 'Retired' : 'Active',
        statusTone: t.retired ? '' : 'ok',
        enf: t.retired ? 'None' : enforcedBy(it.name, overview?.install),
        cat,
        c: LAW_CATS[cat].c,
        off: t.retired,
        src: 'laws/universal.md',
      }
    })

  // A doctrine row's status is the STAGED switch against what is deployed: a rule the
  // install carries reads Active, one it excludes reads Off, and a rule whose switch was
  // flipped but not applied says so rather than reporting the staged state as fact.
  const docRow = (r) => {
    const on = isOn(r.addr)
    const live = deployedRules.includes(r.addr)
    const status = on === live ? (on ? 'Active' : 'Off') : on ? 'Staged on' : 'Staged off'
    return { ...r, off: !on, status, statusTone: on ? 'ok' : on === live ? '' : 'warn' }
  }

  // What the install excludes today: a rule that is off inside a pack it still builds in.
  const deployedExcluded = packs
    .filter((p) => p.active)
    .flatMap((p) => p.rules.filter((r) => !deployedRules.includes(r.addr)).map((r) => r.addr))

  // ⚠ ONE SWITCH, APPLIED AT ONCE. Unlike the rule selection it is not a set: a click asks, and
  // a yes rebuilds the install with the opposite switch. Every other axis rides along unchanged
  // (`install` is spread, and the server reads the rest back off the install, per gate).
  const toggleGate = async (addr) => {
    if (!canApply) return
    const { key, label } = GATE_SWITCH[addr]
    const name = label.toLowerCase()
    const next = !armed(addr)
    const where = `${install.host} · ${install.scope}`
    const ok = await confirm(
      next
        ? `Re-arm the ${name} on ${where}? ${GATE_COPY[addr].arm} It rebuilds in place, non-destructive.`
        : `Switch the ${name} off on ${where}? ${GATE_COPY[addr].off} It rebuilds in place, non-destructive.`,
      {
        title: next ? `Re-arm the ${name}?` : `Switch the ${name} off?`,
        confirmLabel: next ? 'Re-arm' : 'Switch off',
      },
    )
    if (ok) onAction('install', { ...install, [key]: next })
  }

  // Substring narrowing over address, name, Latin name and principle; display-only, so the
  // staged selection above keeps operating on the full rule set.
  const ql = q.trim().toLowerCase()
  const match = (r) => !ql || `${r.addr} ${r.name} ${r.latin} ${r.ess}`.toLowerCase().includes(ql)
  // From the Gate asks card: make the rule's row visible first (a tab or a filter can hide
  // it), then open it; the effect above scrolls there and lights it.
  const jumpToRule = (addr) => {
    const row = byAddr[addr]
    const doctrine = String(addr).includes('.')
    if ((doctrine && tab === 'invariants') || (!doctrine && tab === 'doctrines')) setTab('all')
    if (row && !match(row)) setQ('')
    jumpTo.current = addr
    setJump((n) => n + 1)
    go(`#/item/law/${encodeURIComponent(addr)}`)
  }

  const activeInv = laws.filter((l) => !l.retired).length
  const activeDoc = deployedRules.length
  const stats = rulesData?.stats
  const tiers = [
    {
      key: 'ethos',
      name: 'Ethos',
      n: ontology.length,
      fill: 1,
      sub: `${ontology.length} sections`,
    },
    {
      key: 'invariants',
      name: 'Dictates',
      n: activeInv,
      fill: laws.length ? activeInv / laws.length : 0,
      sub:
        laws.length > activeInv
          ? `${activeInv} active · ${laws.length - activeInv} retired`
          : `${activeInv} active`,
    },
    {
      key: 'doctrines',
      name: 'Doctrines',
      n: activeDoc,
      fill: allRules.length ? activeDoc / allRules.length : 0,
      sub: `${activeDoc} rules · ${packs.filter((p) => p.active).length} of ${packs.length} packs`,
    },
    {
      key: 'yours',
      name: 'Your rules',
      n: stats?.rules ?? 0,
      fill: stats ? stats.rules / stats.max_rules : 0,
      sub: stats
        ? `${stats.rules} of ${stats.max_rules} · ${stats.tokens}/${stats.max_tokens} tok`
        : 'user-rules.md',
      href: '#/personal/rules',
    },
  ]
  const byAddr = Object.fromEntries(
    [...laws, ...packs.flatMap((p) => p.rules)].map((r) => [r.addr, r]),
  )

  const TABS_ = [
    ['all', 'All', laws.length + allRules.length],
    ['invariants', 'Dictates', laws.length],
    ['doctrines', 'Doctrines', allRules.length],
  ]
  const showInv = tab === 'all' || tab === 'invariants'
  const showDoc = tab === 'all' || tab === 'doctrines'
  const bandHead = (title, src) => (
    <div className="band-head" role="presentation">
      <h2 className="tier-h">{title}</h2>
      <span className="mono dim">{src}</span>
    </div>
  )
  const invRows = laws.filter(match)
  const shownCount =
    (showInv ? invRows.length : 0) +
    (showDoc ? packs.reduce((n, p) => n + p.rules.filter(match).length, 0) : 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h">Constitution</h1>
          <p className="sub">
            What the agent follows on every turn. A higher tier always wins. Open any rule to read
            its canonical text.
          </p>
        </div>
      </div>
      <TierStrip tiers={tiers} current={tab} />

      <div className="split">
        <section
          className={`panel flush law-wrap${canApply ? ' with-toggle' : ''}`}
          aria-label="Rules"
        >
          {/* Ethos sits ABOVE the tabs and the filter, and neither touches it: its four
              sections are the character the rules below serve, not rules to narrow down, so
              the tabs and "All" count only what the filter can actually reach. */}
          {ontology.length > 0 && (
            <>
              {bandHead('Ethos', 'ontology/universal.md')}
              {ontology.map((s) => (
                <LawRow
                  key={s.addr}
                  law={s}
                  isOpen={open === s.addr}
                  onToggle={() => toggle(s.addr)}
                />
              ))}
            </>
          )}
          <div className="law-toolbar">
            <Seg aria-label="Show">
              {TABS_.map(([k, l, n]) => (
                <button
                  type="button"
                  key={k}
                  className={tab === k ? 'on' : ''}
                  aria-pressed={tab === k}
                  onClick={() => setTab(k)}
                >
                  {l} <span className="mono">{n}</span>
                </button>
              ))}
            </Seg>
            <FilterInput
              className="law-filter"
              value={q}
              onChange={setQ}
              placeholder="Filter rules"
              label="Filter rules"
            />
            <span className="dim law-note">Retired rules keep their number.</span>
          </div>
          <div className="law-rowhead">
            <span>No.</span>
            <span>Rule</span>
            <span>Latin name</span>
            <span>Status</span>
            <span>Enforced by</span>
          </div>
          {showInv && invRows.length > 0 && (
            <>
              {bandHead('Dictates', 'laws/universal.md')}
              {invRows.map((l) => (
                <LawRow
                  key={l.addr}
                  law={l}
                  isOpen={open === l.addr}
                  onToggle={() => toggle(l.addr)}
                  toggleCol={
                    !canApply || l.retired ? null : GATE_SWITCH[l.addr] ? (
                      <button
                        type="button"
                        className={`sw-toggle${armed(l.addr) ? ' on' : ''}`}
                        role="switch"
                        aria-checked={armed(l.addr)}
                        aria-label={GATE_SWITCH[l.addr].label}
                        onClick={() => toggleGate(l.addr)}
                      />
                    ) : (
                      // A text-only law: nothing at the tool boundary to switch off.
                      <span className="no-gate" title="Enforced by its text alone: no hook gate">
                        no gate
                      </span>
                    )
                  }
                />
              ))}
            </>
          )}
          {showDoc &&
            packs.map((p) => {
              const rows = p.rules.filter(match)
              if (!rows.length) return null
              return (
                <div className={`pack-wrap${packOn(p) ? '' : ' pack-off'}`} key={p.pack}>
                  <div className="band-head pack-head">
                    <h2 className="tier-h" style={{ '--cc': PACK_CATS[p.pack] }}>
                      {p.title}
                    </h2>
                    <span className="pack-desc dim">{p.desc}</span>
                    {/* Derived from the rules, never held separately: a pack IS however many
                        of its rules are on. */}
                    <span className="pack-state mono">{packState(p)}</span>
                  </div>
                  {!p.active && !canApply && (
                    // The fallback for a console with no install to rebuild: a reader still
                    // needs the exact selection, because `--doctrines` REPLACES the set.
                    // ⚠ `geneseed-build`, not `geneseed build`: the CLI's `build` verb
                    // forwards `--theme` and nothing else, so the shorter spelling errors.
                    <div className="pack-enable">
                      $ geneseed-build --doctrines{' '}
                      {packs
                        .filter((x) => x.active || x.pack === p.pack)
                        .map((x) => x.pack)
                        .join(',')}
                      {deployedExcluded.length > 0 &&
                        ` --exclude-rules ${deployedExcluded.join(',')}`}
                    </div>
                  )}
                  {rows.map((r) => (
                    <LawRow
                      key={r.addr}
                      law={docRow(r)}
                      isOpen={open === r.addr}
                      onToggle={() => toggle(r.addr)}
                      toggleCol={
                        canApply ? (
                          <button
                            type="button"
                            className={`sw-toggle${isOn(r.addr) ? ' on' : ''}`}
                            role="switch"
                            aria-checked={isOn(r.addr)}
                            aria-label={`${r.name} rule`}
                            onClick={() => toggleRule(r.addr)}
                          />
                        ) : null
                      }
                    />
                  ))}
                </div>
              )
            })}
          {shownCount === 0 && (
            <div className="empty" style={{ padding: 32 }}>
              <div className="big">{ql ? 'No matching rules' : 'Nothing in this tier'}</div>
              {ql ? <>Nothing matches “{q.trim()}”.</> : <>This install predates the tier.</>}
            </div>
          )}
        </section>

        <aside className="aside-stack">
          <PackPanel
            packs={packs}
            sel={sel}
            canApply={canApply}
            install={install}
            gateArmed={gateArmed}
          />
          <GateAsks gates={setup?.gates} byAddr={byAddr} onJump={jumpToRule} />
        </aside>
      </div>
    </>
  )
}
