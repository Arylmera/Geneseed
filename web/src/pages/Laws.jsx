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
import InstallPicker from '../components/InstallPicker.jsx'
import { useInstallPick, useInstalls } from '../hooks/useInstalls.js'
import { installTag, pairOf } from '../lib/hosts.js'

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

// The Credo's Ownership section: the row that holds the ownership gate. The ledger and the deep
// links keep the switch's own address, `ownership`, so a link to the gate opens this row.
const OWNERSHIP_ROW = 'ont:ownership'
const rowOf = (addr) => (addr === 'ownership' ? OWNERSHIP_ROW : addr)

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
// The install this page reads and rebuilds (its gate switches, its doctrine Apply): its own pick,
// remembered, labelled beside the page. The default install's overview is App's; another
// install's is read with its pair. Keyed on the pick, so a switch never shows one install's
// staged selection over another's rules.
//
// ⚠ EVERY WRITE NAMES THE PICKED INSTALL, AND ONLY ONCE ITS OWN READ HAS LANDED. The picked
// install's overview is always read with its pair (never App's unnamed one, which answers for the
// daemon's state and can lag the default marker), and it counts only when it describes the pick:
// the read survives a re-pick for a moment, and an overview of B under a pick of C would let a
// switch rebuild B. Until then, and until the install list is read, the page offers no write.
export default function Laws(props) {
  const active = useInstalls(props.dataRev)
  const [install, pick] = useInstallPick('laws', active)
  return (
    <>
      <InstallPicker
        className="page-pick"
        installs={active}
        value={install}
        onChange={pick}
        label="Constitution of:"
      />
      {/* Keyed on the pick, so its read starts as pending and no other pick's answer shows. */}
      <LawsFor key={install?.id ?? 'none'} {...props} install={install} listed={active !== null} />
    </>
  )
}

const isInstall = (o, i) => o?.install?.host === i.host && o.install.path === i.path

// The overview the page reads for its pick: App's when it is that install, else one named read.
// The gates and the Enforced-by column read it, and a missing switch reads as armed, so until it
// lands the page shows no verdict. `loading` ends the wait: a finished read that names another
// install, or none, is unread and says so, and never hangs.
function LawsFor({ install, listed, ...props }) {
  const held = install && isInstall(props.overview, install) ? props.overview : null
  const {
    data: own,
    error: ownError,
    loading,
  } = useAsync(
    () => Promise.resolve().then(() => (install && !held ? api.overview(pairOf(install)) : null)),
    [Boolean(held), props.dataRev],
  )
  const mine = held || (install && isInstall(own, install) ? own : null)
  // No install to pick (none active, or the list unreadable): the default's overview, as before.
  const overview = install ? mine : props.overview
  const unread = Boolean(install && !mine && !loading)
  return (
    <>
      {unread ? (
        <ErrorState
          error={`Could not read this install's gates${ownError ? `: ${ownError}` : '.'}`}
        />
      ) : null}
      <LawsOf
        {...props}
        overview={overview}
        pair={pairOf(install)}
        onAction={listed && (!install || mine !== null) ? props.onAction : undefined}
        pending={!listed || Boolean(install && !mine && loading)}
        gatesUnread={unread}
      />
    </>
  )
}

function LawsOf({ selected, overview, setup, onAction, dataRev, pair, pending, gatesUnread }) {
  const confirm = useConfirm()
  // The default install's catalog shares the Overview's cached read; another install's is its own.
  const { data, error } = useAsync(
    () => api.catalog('laws', pair),
    pair ? [dataRev, pair.host, pair.path] : [dataRev],
    'catalog:laws',
  )
  const { data: rulesData } = useRules(dataRev, pair)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  // A second, narrower axis beside the tier tabs: every rule, the hook-gated ones, or the
  // doctrine rules whose staged switch differs from the install. Two toggles, not three tabs:
  // "All" is already the tier tabs' name, and two buttons both called "All" read as one.
  const [view, setView] = useState('all')
  // Packs the reader folded. Open by default: a folded pack hides its rule switches.
  const [folded, setFolded] = useState(() => new Set())
  const open = rowOf(selected) || null
  const toggle = (addr) => go(open === addr ? '#/laws' : `#/item/law/${encodeURIComponent(addr)}`)
  // Nothing to rebuild means nothing to toggle: a source render with no deployed install
  // still READS, it just cannot be changed from here.
  const install = overview?.install
  const canApply = Boolean(install && onAction)
  // Bring the open rule into view. Any deep link (a gate, the Overview, Spotlight) scrolls
  // to its row when it is off screen; a row clicked in place is already on screen and stays
  // put. A jump from the Gate asks card always scrolls and briefly lights the row, so the eye
  // lands on it. `jump` re-runs this when the same rule is asked for twice.
  const [jump, setJump] = useState(0)
  const jumpTo = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const raf = requestAnimationFrame(() => {
      // `open` comes from the URL hash: escaped, so a quote in it cannot throw here.
      const el = document.querySelector(`[data-addr="${CSS.escape(open)}"]`)
      if (!el) return
      const flash = jumpTo.current === open
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
  }, [open, jump, data])

  // ⚠ EVERY HOOK BEFORE THE EARLY RETURNS BELOW. The staged pack selection is derived from
  // `data`, which is null on the first render; a `useState` placed after `if (!data)` makes
  // React see a different number of hooks between the loading render and the loaded one
  // and throw, taking the whole page down rather than just the control.
  const items = data?.items || []
  const packs = doctrinePacks(items)
  // The gate switches (Laws I, III, IV and the one in the Ownership row), as the deployed
  // install reports them (`overview.install.secretsGate` / `doneGate` / `deletionGate` /
  // `ownershipGate`). Anything but an explicit `false` — an older daemon, no install — reads as
  // armed.
  const armed = (addr) => overview?.install?.[GATE_SWITCH[addr].key] !== false
  const gateArmed = armed('IV')
  const sel = useRuleSelection({ items, packs, install, canApply, onAction, gateArmed })
  const { deployedRules, isOn, toggleRule, packOn, packState, allRules } = sel

  if (error) return <ErrorState error={error} />
  if (!data || pending) return <Loading />

  // The tier nouns in the install's theme voice (`nouns` on /api/catalog/laws). An older daemon
  // sends none, and the page keeps the names it always printed.
  const nouns = {
    ontology: data.nouns?.ontology || 'Ethos',
    law: data.nouns?.law || 'Dictate',
    laws: data.nouns?.laws || 'Dictates',
    doctrines: data.nouns?.doctrines || 'Doctrines',
  }

  // A gate's state is what the unread overview would have said: never guess it armed.
  const enfOf = (addr, gates) => {
    const enf = enforcedBy(addr, gates)
    return gatesUnread && GATE_SWITCH[addr] && enf === 'Hook gate' ? 'Unknown' : enf
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
      // With no install there is no gate to read, so only the text is known to bind.
      enf:
        it.name === OWNERSHIP_ROW && (install || gatesUnread)
          ? enfOf('ownership', install)
          : 'Instruction',
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
        enf: t.retired ? 'None' : enfOf(it.name, overview?.install),
        cat,
        c: LAW_CATS[cat].c,
        off: t.retired,
        src: 'laws/universal.md',
      }
    })

  // The ownership gate: a switch, not a rule, with no catalog item or law number. It draws no row
  // of its own: the Ownership row holds its switch. This entry is what the counts read, so it
  // joins the Ethos pill, the Gated view and the text filter but no count of sections or rules,
  // and only where a switch can act.
  const gateRows = canApply
    ? [
        {
          addr: 'ownership',
          name: GATE_SWITCH.ownership.label,
          latin: '',
          ess: '',
          enf: enforcedBy('ownership', install),
        },
      ]
    : []

  // A doctrine row's status is the STAGED switch against what is deployed: a rule the
  // install carries reads Active, one it excludes reads Off, and a rule whose switch was
  // flipped but not applied says so rather than reporting the staged state as fact.
  const docRow = (r) => {
    const on = isOn(r.addr)
    const live = deployedRules.includes(r.addr)
    const status = on === live ? (on ? 'Active' : 'Off') : on ? 'Staged on' : 'Staged off'
    return {
      ...r,
      enf: gatesUnread && GATE_SWITCH[r.addr] && r.enf === 'Hook gate' ? 'Unknown' : r.enf,
      off: !on,
      status,
      statusTone: on ? 'ok' : on === live ? '' : 'warn',
    }
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
    const where = installTag(install)
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
  const gateSwitch = (addr) => (
    <button
      type="button"
      className={`sw-toggle${armed(addr) ? ' on' : ''}`}
      role="switch"
      aria-checked={armed(addr)}
      aria-label={GATE_SWITCH[addr].label}
      onClick={() => toggleGate(addr)}
    />
  )

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
  // it), then open it; the effect above scrolls there and lights it. The ownership gate is not in
  // `byAddr`: its row sits in the Ethos band, which no tab, view or filter hides.
  const jumpToRule = (addr) => {
    const row = byAddr[addr]
    const doctrine = String(addr).includes('.')
    const hiddenByTab = doctrine ? tab === 'invariants' : row && tab === 'doctrines'
    if (hiddenByTab) setTab('all')
    if (row && !inView(row)) setView('all')
    if (row && !match(row)) setQ('')
    jumpTo.current = rowOf(addr)
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
  // Each tier's pill warns for the switches in its own band.
  const gatePill = (rows) => {
    if (gatesUnread) return ['gates unread', 'warn']
    const off = rows.filter((r) => GATE_SWITCH[r.addr] && !armed(r.addr)).length
    return off ? [`${off} gate${off === 1 ? '' : 's'} off`, 'warn'] : ['always', 'ok']
  }
  const excludedDoc = allRules.length - activeDoc
  const stats = rulesData?.stats
  const tierOf = {
    ethos: {
      name: nouns.ontology,
      n: ontology.length,
      fill: 1,
      sub: `${ontology.length} sections`,
      pill: gatePill(gateRows),
    },
    invariants: {
      name: nouns.laws,
      n: laws.length,
      fill: laws.length ? activeInv / laws.length : 0,
      sub:
        laws.length > activeInv
          ? `${activeInv} active · ${laws.length - activeInv} retired`
          : `${activeInv} active`,
      pill: gatePill(laws),
    },
    doctrines: {
      name: nouns.doctrines,
      n: allRules.length,
      fill: allRules.length ? activeDoc / allRules.length : 0,
      sub: `${packs.length} packs`,
      pill: excludedDoc > 0 ? [`${excludedDoc} excluded`, 'warn'] : ['all on', 'ok'],
    },
    yours: {
      name: 'Your rules',
      // Blank until the read lands: "0" would say the file holds no rule.
      n: stats?.rules ?? '',
      // No ceiling to measure against: the bar only says whether the tier holds a rule.
      fill: stats?.rules ? 1 : 0,
      sub: stats
        ? `${stats.rules} rule${stats.rules === 1 ? '' : 's'} · ≈${stats.tokens.toLocaleString('en-US')} tok`
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
  // The view toggles count what the tier tabs show, before the text filter, as the tabs do. The
  // ownership gate counts under every tab, because its row does not depend on one.
  const tierRows = [
    ...gateRows,
    ...(showInv ? laws : []),
    ...(showDoc ? packs.flatMap((p) => p.rules) : []),
  ]
  const VIEWS = [
    // No figure with the gates unread: what enforces a rule is the unknown here.
    ['gated', 'Gated', gatesUnread ? null : tierRows.filter((r) => inView(r, 'gated')).length],
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
  // What the tabs and the filter reach, so not the Ethos band above them. The gate counts only as
  // a match: "Nothing matches" must not sit under its row, but it fills no empty tier.
  const shownCount =
    (ql || view !== 'all' ? gateRows.filter(match).length : 0) +
    (showInv ? invRows.length : 0) +
    (showDoc ? packs.reduce((n, p) => n + p.rules.filter(match).length, 0) : 0)
  // The switch inside the open Ownership row, where a switch can act. It sits outside the row's
  // disclosure button, so a click on it never folds the row.
  const gateAsks = withAsks(gateRows[0] || {}).asks
  const gateLine = gateRows.length > 0 && (
    <div className="law-gate">
      <span className="law-name">
        <span>{GATE_SWITCH.ownership.label}</span>
        {gateAsks ? <span className="law-asks mono">{gateAsks}</span> : null}
        <span className="law-princ">{GATE_COPY.ownership.desc}</span>
      </span>
      {gateSwitch('ownership')}
    </div>
  )

  return (
    <>
      <PageHeader
        eyebrow={
          install
            ? [
                overview?.theme,
                install.footprint && `${install.footprint} footprint`,
                installTag(install),
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
          {/* Ethos sits ABOVE the tabs and the filter, and neither touches its sections: they
              are the character the rules below serve, not rules to narrow down, so the tabs
              and "All" count only what the filter can actually reach. */}
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
                  after={s.addr === OWNERSHIP_ROW ? gateLine : null}
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
                  disabled={n === null}
                  onClick={() => setView(view === k ? 'all' : k)}
                >
                  {l} {n === null ? null : <span className="mono">{n}</span>}
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
                      gateSwitch(l.addr)
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
            install={overview?.install}
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
