import { useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { useAsync } from '../hooks/useAsync.js'
import { useRules } from '../hooks/useRules.js'
import { useRuleSelection } from '../hooks/useRuleSelection.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { LAW_CATS, PACK_CATS } from '../lib/lawCats.js'
import {
  GATE_COPY,
  GATE_SWITCH,
  PRECEDENCE,
  PRECEDENCE_INFORM,
  enforcedBy,
  gateAddress,
  parseRuleTitle,
} from '../lib/constitution.js'
import Seg from '../components/Seg.jsx'
import FilterInput from '../components/FilterInput.jsx'
import { Bar } from '../components/StackBar.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import LawRow from './Laws/LawRow.jsx'
import TierStrip from './Laws/TierStrip.jsx'
import GateAsks from './Laws/GateAsks.jsx'
import PackPanel from './Laws/PackPanel.jsx'

// THE FILENAME AND THE ROUTE STAY `laws`: a rename buys nothing and costs a redirect. Only what
// a reader sees says "Constitution".

// ⚠ SIX CLASSES, THOUGH ONLY FOUR HAVE A MEMBER. `context` and `comms` lost theirs when the corpus
// became nine invariants — that material moved to the ontology and the doctrine packs, neither of
// which is classed here. The list stays six because it is the VOCABULARY that
// js/inspect/inventory.mjs's LAW_CLASSES publishes and doctor quotes verbatim; the PAGE renders
// only non-empty facets, which is a display decision and not a change to the taxonomy. The colour
// vocabulary lives in lib/lawCats.js because the Journal dashboard's constitution map paints the
// same rules, and this page is lazy for a reason. Each rule's one-line principle is the item's
// `summary`, which the server reads from src/ beside the rule.

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
    const t = parseRuleTitle(it.title)
    pack.rules.push({
      addr: it.name,
      no: `${it.pack} ${it.name.split('.')[1] || ''}`,
      name: t.name,
      latin: t.latin,
      ess: it.summary || '',
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
  // A second, narrower axis beside the tier tabs: every rule, the hook-gated ones, or the
  // doctrine rules whose staged switch differs from the install. Two toggles, not three tabs:
  // "All" is already the tier tabs' name, and two buttons both called "All" read as one.
  const [view, setView] = useState('all')
  // Packs the reader folded. Open by default: a folded pack hides its rule switches.
  const [folded, setFolded] = useState(() => new Set())
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
      // `selected` comes from the URL hash: escaped, so a quote in it cannot throw here.
      const el = document.querySelector(`[data-addr="${CSS.escape(selected)}"]`)
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

  // The tier nouns in the install's theme voice (`nouns` on /api/catalog/laws). An older daemon
  // sends none, and the page keeps the names it always printed.
  const nouns = {
    ontology: data.nouns?.ontology || 'Ethos',
    law: data.nouns?.law || 'Dictate',
    laws: data.nouns?.laws || 'Dictates',
    doctrines: data.nouns?.doctrines || 'Doctrines',
  }

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
      // The class and the principle line both come from the server (LAW_CLASS, and the rule's
      // summary in src/); an unknown or missing class reads as craft.
      const cat = it.klass && LAW_CATS[it.klass] ? it.klass : 'craft'
      const t = parseRuleTitle(it.title)
      return {
        addr: it.name,
        no: it.name,
        name: t.name,
        latin: t.latin,
        ess: it.summary || '',
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
    // The rebuild carries the DEPLOYED doctrine rules (`install` is spread), so staged switches
    // are neither applied nor lost by it: say so, or a yes reads as applying them too.
    const stays = sel.dirty
      ? ' Your staged doctrine changes are not part of this rebuild; they stay staged.'
      : ''
    const ok = await confirm(
      (next
        ? `Re-arm the ${name} on ${where}? ${GATE_COPY[addr].arm} It rebuilds in place, non-destructive.`
        : `Switch the ${name} off on ${where}? ${GATE_COPY[addr].off} It rebuilds in place, non-destructive.`) +
        stays,
      {
        title: next ? `Re-arm the ${name}?` : `Switch the ${name} off?`,
        confirmLabel: next ? 'Re-arm' : 'Switch off',
      },
    )
    if (ok) onAction('install', { ...install, [key]: next })
  }

  // Gated: a hook enforces it now (a switched-off gate reads "Gate off", and an excluded
  // doctrine rule takes its hook with it, so neither is counted).
  // Changed: a doctrine rule whose staged switch differs from the install; a law never is, its
  // gate switch rebuilds at once.
  const isChanged = (r) =>
    String(r.addr).includes('.') && isOn(r.addr) !== deployedRules.includes(r.addr)
  const inView = (r, v = view) =>
    v === 'all' ||
    (v === 'gated'
      ? r.enf === 'Hook gate' && (!String(r.addr).includes('.') || deployedRules.includes(r.addr))
      : isChanged(r))
  // Substring narrowing over address, name, Latin name and principle; display-only, so the
  // staged selection above keeps operating on the full rule set.
  const ql = q.trim().toLowerCase()
  const match = (r) =>
    inView(r) && (!ql || `${r.addr} ${r.name} ${r.latin} ${r.ess}`.toLowerCase().includes(ql))
  // From the Gate asks card: make the rule's row visible first (a tab or a filter can hide
  // it), then open it; the effect above scrolls there and lights it.
  const jumpToRule = (addr) => {
    const row = byAddr[addr]
    const doctrine = String(addr).includes('.')
    if ((doctrine && tab === 'invariants') || (!doctrine && tab === 'doctrines')) setTab('all')
    if (row && !inView(row)) setView('all')
    if (row && !match(row)) setQ('')
    jumpTo.current = addr
    setJump((n) => n + 1)
    go(`#/item/law/${encodeURIComponent(addr)}`)
  }

  // How often each gate stopped to ask, by rule address: an all-time count from the gate ledger
  // (`setup.gates.asks`), the same figure the Gate asks card draws. The ledger keeps no dates.
  const asksOf = {}
  for (const [gate, n] of Object.entries(setup?.gates?.asks || {})) asksOf[gateAddress(gate)] = n
  const withAsks = (r) =>
    asksOf[r.addr] ? { ...r, asks: `${asksOf[r.addr]} ask${asksOf[r.addr] === 1 ? '' : 's'}` } : r

  const activeInv = laws.filter((l) => !l.retired).length
  const activeDoc = deployedRules.length
  const gatesOff = Object.keys(GATE_SWITCH).filter(
    (a) => laws.some((l) => l.addr === a) && !armed(a),
  ).length
  const excludedDoc = allRules.length - activeDoc
  const stats = rulesData?.stats
  const tierOf = {
    ethos: {
      name: nouns.ontology,
      n: ontology.length,
      fill: 1,
      sub: `${ontology.length} sections`,
      pill: ['always', 'ok'],
    },
    invariants: {
      name: nouns.laws,
      n: activeInv,
      fill: laws.length ? activeInv / laws.length : 0,
      sub:
        laws.length > activeInv
          ? `${activeInv} active · ${laws.length - activeInv} retired`
          : `${activeInv} active`,
      pill: gatesOff
        ? [`${gatesOff} gate${gatesOff === 1 ? '' : 's'} off`, 'warn']
        : ['always', 'ok'],
    },
    doctrines: {
      name: nouns.doctrines,
      n: activeDoc,
      fill: allRules.length ? activeDoc / allRules.length : 0,
      sub: `${activeDoc} rules · ${packs.filter((p) => p.active).length} of ${packs.length} packs`,
      pill: excludedDoc > 0 ? [`${excludedDoc} excluded`, 'warn'] : ['all on', 'ok'],
    },
    yours: {
      name: 'Your rules',
      n: stats?.rules ?? 0,
      // A zero budget draws an empty bar, not a NaN% width.
      fill: stats?.max_rules ? stats.rules / stats.max_rules : 0,
      sub: stats
        ? `${stats.rules} of ${stats.max_rules} · ${stats.tokens}/${stats.max_tokens} tok`
        : 'user-rules.md',
      href: '#/personal/rules',
      pill: ['yours', ''],
    },
  }
  // The strip follows the Precedence table, highest rank first, each cell with its rule
  // against the rank above (rank 1 has none above it).
  const rankRule = (against) => {
    if (against === '—') return 'Nothing outranks them.'
    const s = against.replace('{{LAW}}', nouns.law)
    return `${s[0].toUpperCase()}${s.slice(1)}.`
  }
  const tiers = PRECEDENCE.map((p) => ({ key: p.key, ...tierOf[p.key], rule: rankRule(p.against) }))
  const byAddr = Object.fromEntries(
    [...laws, ...packs.flatMap((p) => p.rules)].map((r) => [r.addr, r]),
  )

  const TABS_ = [
    ['all', 'All', laws.length + allRules.length],
    ['invariants', nouns.laws, laws.length],
    ['doctrines', nouns.doctrines, allRules.length],
  ]
  const showInv = tab === 'all' || tab === 'invariants'
  const showDoc = tab === 'all' || tab === 'doctrines'
  // The view toggles count what the tier tabs show, before the text filter, as the tabs do.
  const tierRows = [...(showInv ? laws : []), ...(showDoc ? packs.flatMap((p) => p.rules) : [])]
  const VIEWS = [
    ['gated', 'Gated', tierRows.filter((r) => inView(r, 'gated')).length],
    ['changed', 'Changed', tierRows.filter((r) => inView(r, 'changed')).length],
  ]
  // A pack holding the open rule never reads folded: a deep link or a gate jump must find its
  // row. So folding that pack also closes the rule.
  const packOf = (addr) => (String(addr).includes('.') ? String(addr).split('.')[0] : null)
  // The Changed view unfolds every pack too: it exists to show each staged row.
  const isShut = (pack) => view !== 'changed' && folded.has(pack) && packOf(open) !== pack
  const fold = (pack) => {
    const shut = isShut(pack)
    setFolded((f) => {
      const next = new Set(f)
      if (shut) next.delete(pack)
      else next.add(pack)
      return next
    })
    if (!shut && packOf(open) === pack) go('#/laws')
  }
  // The staged changes, one chip each: `+` switches a rule on, `−` off.
  const changes = packs.flatMap((p) =>
    p.rules.filter(isChanged).map((r) => ({ ...r, plus: isOn(r.addr) })),
  )
  const showBar = canApply && packs.length > 0 && sel.dirty
  // Review lifts whatever hides a staged row: the Dictates tab and the text filter.
  const review = () => {
    setView('changed')
    if (tab === 'invariants') setTab('all')
    setQ('')
  }
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
      <PageHeader
        eyebrow={
          install
            ? [
                overview?.theme,
                install.footprint && `${install.footprint} footprint`,
                install.host,
                install.scope,
              ]
                .filter(Boolean)
                .join(' · ')
            : null
        }
        title="Constitution"
        sub="What the agent follows on every turn. Ranked: a lower rank may tighten a higher one, never repeal it. Open any rule to read its canonical text."
        actions={
          <FilterInput
            className="law-filter"
            value={q}
            onChange={setQ}
            placeholder="Filter rules"
            label="Filter rules"
          />
        }
      />
      <section className="ladder" aria-labelledby="ladder-h">
        <h2 id="ladder-h" className="eyebrow">
          Precedence
        </h2>
        <TierStrip tiers={tiers} current={tab} onPick={setTab} />
        {/* Ranks 5 and 6 bind or inform how work runs, but hold no rules to list here. */}
        <div className="ladder-tail">
          {PRECEDENCE_INFORM.map((r, i) => (
            <span key={r.source} className="ladder-low">
              <span className="mono tier-k">RANK {PRECEDENCE.length + i + 1}</span> {r.label} —{' '}
              {r.against}
            </span>
          ))}
        </div>
      </section>

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
              {bandHead(nouns.ontology, 'ontology/universal.md')}
              {ontology.map((s) => (
                <LawRow
                  key={s.addr}
                  law={s}
                  rev={dataRev}
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
            <Seg aria-label="Narrow">
              {VIEWS.map(([k, l, n]) => (
                <button
                  type="button"
                  key={k}
                  className={view === k ? 'on' : ''}
                  aria-pressed={view === k}
                  onClick={() => setView(view === k ? 'all' : k)}
                >
                  {l} <span className="mono">{n}</span>
                </button>
              ))}
            </Seg>
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
              {bandHead(nouns.laws, 'laws/universal.md')}
              {invRows.map((l) => (
                <LawRow
                  key={l.addr}
                  law={withAsks(l)}
                  rev={dataRev}
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
              const shut = isShut(p.pack)
              const on = p.rules.filter((r) => isOn(r.addr)).length
              return (
                <div className={`pack-wrap${packOn(p) ? '' : ' pack-off'}`} key={p.pack}>
                  <div className="band-head pack-head">
                    {/* The heading holds the disclosure (a button may not hold a heading). Its
                        name is the pack's title alone: "<title> pack" is the pack switch's. */}
                    <h2 className="tier-h" style={{ '--cc': PACK_CATS[p.pack] }}>
                      <button
                        type="button"
                        className="pack-fold"
                        aria-expanded={!shut}
                        onClick={() => fold(p.pack)}
                      >
                        {p.title}
                      </button>
                    </h2>
                    <span className="mono dim">{p.pack}</span>
                    <span className="pack-desc dim">{p.desc}</span>
                    <span className="pack-fill">
                      <Bar value={on} max={p.rules.length} label={`${p.title} rules switched on`} />
                    </span>
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
                  {!shut &&
                    rows.map((r) => (
                      <LawRow
                        key={r.addr}
                        law={withAsks(docRow(r))}
                        rev={dataRev}
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
            <EmptyState title={ql || view !== 'all' ? 'No matching rules' : 'Nothing in this tier'}>
              {ql ? (
                <>Nothing matches “{q.trim()}”.</>
              ) : view !== 'all' ? (
                <>No {view} rule in this tier.</>
              ) : (
                <>This install predates the tier.</>
              )}
            </EmptyState>
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
          <GateAsks
            gates={setup?.gates}
            byAddr={byAddr}
            onJump={jumpToRule}
            disarmed={(addr) => Boolean(GATE_SWITCH[addr]) && !armed(addr)}
          />
        </aside>
      </div>
      {/* Apply is the page's one primary action, and the bar exists only while something is
          staged: a disabled filled button on a clean page is a call to do nothing. */}
      {showBar && (
        <div className="law-bar" role="region" aria-label="Unapplied changes">
          <span className="law-bar-n">
            {changes.length} unapplied change{changes.length === 1 ? '' : 's'}
          </span>
          <span className="law-bar-list">
            {changes.map((r) => (
              <span key={r.addr} className={`badge ${r.plus ? 'ok' : 'warn'}`}>
                {r.plus ? '+' : '−'} {r.no} {r.name}
              </span>
            ))}
          </span>
          <button type="button" className="btn ghost" onClick={review}>
            Review changes
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setView('all')
              sel.revert()
            }}
          >
            Revert
          </button>
          <button type="button" className="btn" onClick={sel.applyPacks}>
            Apply ({sel.pickedRules.length}/{allRules.length} rules)
          </button>
        </div>
      )}
    </>
  )
}
