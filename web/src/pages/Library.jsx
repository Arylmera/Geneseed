import React, { useMemo, useState } from 'react'
import { api } from '../api/index.js'
import { go } from '../lib/router.js'
import { folderName } from '../lib/hosts.js'
import { Icon } from '../components/Icon.jsx'
import { SECTIONS, LIBRARY_ORDER } from '../lib/sections.js'
import { SKILL_CATS, SKILL_CAT_ORDER } from '../lib/lawCats.js'
import { useAsync } from '../hooks/useAsync.js'
import { dropRules } from '../hooks/useRules.js'
import Markdown from '../components/Markdown.jsx'
import ManifestDoc from '../components/ManifestDoc.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { GroupedRows, KitBadge, LibList, filterRows } from '../components/LibRows.jsx'
import RailCats from '../components/RailCats.jsx'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import AgentGlyph from '../components/AgentGlyph.jsx'
import Seg from '../components/Seg.jsx'
import Stat from '../components/Stat.jsx'

// The usage ledger's kind for a Library section; only these two are counted.
const USE_KIND = { skills: 'skill', agents: 'agent' }
const pct = (n, of) => `${of ? (n / of) * 100 : 0}%`
// An install key is `host:scope:root`, and a root may hold ':' (a Windows drive), so only the
// first two fields are read.
const hostOf = (key) => key.split(':').slice(0, 2).join(' ')
// The same key as the `{host, path}` pair the API takes: the path is everything after the second
// colon, byte for byte, or the server refuses it as an unknown install.
export const installOfKey = (key) => {
  const [host, scope, ...rest] = key.split(':')
  return { host, scope, path: rest.join(':') }
}
// An install as the harness switcher names it: a global by its tool, a project by its folder.
export const installLabel = (key) => {
  const i = installOfKey(key)
  return i.scope === 'global' ? `${i.host} · global` : `${folderName(i.path)} · ${i.host}`
}

// The on-disk source path for a given (section, name), for the reader's source line when
// the item payload carries none. Informational only; it drives no fetch.
function libSource(sec, name) {
  if (sec === 'memory') return `memory/${name}`
  if (sec === 'notebook') return `notebook/${name}`
  if (sec === 'wiki') return `geneseed-wiki.jsonc`
  if (sec === 'config') return name
  if (sec === 'skills') return `skills/${name}/SKILL.md`
  return `${sec}/${name}.md`
}

// A wiki or config entry that is a convention rather than a document of its own. The
// source path stays visible so the reader still learns where the content lives.
function EmptyDoc({ section, source }) {
  return (
    <div className="lib-doc-empty">
      <Icon name={SECTIONS[section].icon} className="glyph" />
      <span>
        This entry is part of the {SECTIONS[section].label.toLowerCase()} convention; see{' '}
        <code className="mono">{source}</code>. It has no standalone per-entry document.
      </span>
    </div>
  )
}

// An entry body's own head, split off: its leading `# …` (the reader already prints a title,
// so a second one breaks the heading outline) and the `> …` paragraph right after it when that
// is only the description again (the reader prints it as the lede). "Again" is a prefix match:
// a real agent's description is the quote plus "Use when: …", so equality never holds; the
// prefix must end on a word boundary. Returns the H1 text so the reader can use it where the
// title is just the slug. Any other blockquote is the author's. The H1 follows CommonMark: at
// most three spaces of indent (four is a code block), and a closing `#` run only after a space.
const norm = (s) => s.replace(/\s+/g, ' ').trim()
const dropBlank = (s) => s.replace(/^(?:[ \t]*\n)+/, '')
export function bodyHead(body, desc) {
  const lf = body.replace(/\r\n/g, '\n')
  const h1 = /^(?:[ \t]*\n)*[ ]{0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*(?:\n|$)/.exec(lf)
  if (!h1) return { title: null, body }
  let rest = dropBlank(lf.slice(h1[0].length))
  const quote = /^(?:>[^\n]*(?:\n|$))+/.exec(rest)
  const said = quote ? norm(quote[0].replace(/^>[ \t]?/gm, '')) : ''
  const d = desc ? norm(desc) : ''
  if (said && (d === said || d.startsWith(said + ' ')))
    rest = dropBlank(rest.slice(quote[0].length))
  return { title: h1[1].trim(), body: rest }
}

// The reader's usage card for one skill or agent: its fleet-wide count, then one line with the
// last day it fired, the window it covers and the hosts that fired it, then a 30-day sparkline
// across the card. One card, not two: the user found a separate "Last used" tile too big
// (2026-10-25). `n` counts
// only the 30-day window, so "since <first day>" is said only while fewer than 30 are counted.
function UseStats({ u, usage, noCall }) {
  if (!u || (u.n === 0 && !u.last)) {
    return (
      <div className="lib-stats">
        <Stat label="Used" value={0} delta={noCall} />
      </div>
    )
  }
  const hosts = [...new Set(u.installs.map(hostOf))].join(', ')
  const span = usage.days_counted >= 30 ? 'in the last 30 days' : `since ${usage.since}`
  const dmax = Math.max(1, ...u.per_day)
  const line = [u.last ? `last used ${u.last}` : null, span, hosts ? `on ${hosts}` : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="lib-stats">
      <Stat label="Used" value={u.n} delta={line}>
        <div className="cols30" aria-hidden="true">
          {u.per_day.map((v, d) => (
            <i key={d} className={d === 29 ? 'today' : ''} style={{ height: pct(v, dmax) }} />
          ))}
        </div>
      </Stat>
    </div>
  )
}

// A skill or agent description is "what it is. Use when: the trigger." The reader prints the
// two apart, as the lede and a "Use when" note; a description without the marker is all lede.
export function splitWhen(desc) {
  // The colon is the marker: "use when you…" or "use whenever" in prose is not one.
  const m = /\s*\bUse when:\s*/i.exec(desc || '')
  if (!m) return { lede: desc || '', when: '' }
  const when = desc.slice(m.index + m[0].length).trim()
  return {
    lede: desc.slice(0, m.index).trim(),
    when: when && when[0].toUpperCase() + when.slice(1),
  }
}

// The Docs page that explains each kind, for the reader's "About … in Docs" link.
const DOC_OF = {
  skills: 'skills',
  agents: 'agents',
  memory: 'memory',
  notebook: 'notebook',
  wiki: 'wiki',
  config: 'project-context',
}

const resolveSec = (s, lock) => lock || (s && LIBRARY_ORDER.includes(s) ? s : LIBRARY_ORDER[0])
const enc = encodeURIComponent

// Skills in class order, each row tagged with its class and the header it sits under, plus
// the classes present with their counts (the rail's categories). Exported for the test that pins it.
export function splitSkills(items) {
  const catOf = (it) => (SKILL_CATS[it.klass] ? it.klass : 'personal')
  const rows = SKILL_CAT_ORDER.flatMap((k) =>
    items
      .filter((it) => catOf(it) === k)
      .map((it) => ({ ...it, cat: k, group: SKILL_CATS[k].label, groupC: SKILL_CATS[k].c })),
  )
  const cats = SKILL_CAT_ORDER.map((k) => ({
    key: k,
    label: SKILL_CATS[k].label,
    c: SKILL_CATS[k].c,
    n: rows.filter((r) => r.cat === k).length,
  })).filter((x) => x.n > 0)
  return { rows, cats }
}

// Memory facts topic by topic, each row headed by its `topic` (the catalog reads it off the
// fact's frontmatter, as the store files it), in the map's sorted topic order. The store's own
// MEMORY and README rows carry none: they lead, unheaded. Exported for the test that pins it.
export function groupMemory(items) {
  const facts = items.filter((it) => it.topic).map((it) => ({ ...it, group: it.topic }))
  // Array.prototype.sort is stable: within a topic the catalog's name order holds.
  facts.sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0))
  return [...items.filter((it) => !it.topic), ...facts]
}

// The Library: what the agent knows, in three panes. The kinds column picks a section
// (skills, agents, memory, notebook, wiki, setup files), the list pane lists it, the
// reader renders the selected entry straight from its source file. Routing:
//   #/library, #/skills, #/agents, #/section/<kind>  -> kind selected
//   #/item/<type>/<name>                              -> kind + entry selected
//
// Personal's Memory and Notebook tabs render this same component with `lock` (one kind,
// no kinds column) and `base` (the tab's own address, `#/personal/memory`), so an entry
// opened there stays on the Personal page.
export default function Library({
  overview,
  section,
  selected,
  dataRev,
  lock,
  base,
  onRulesChanged,
}) {
  const confirm = useConfirm()
  const [sec, setSec] = useState(() => resolveSec(section, lock))
  const [q, setQ] = useState('')
  // The skill class picked under Skills in the rail ('all' or a SKILL_CATS key). Skills only; reset with the kind.
  const [cat, setCat] = useState('all')
  // The list filter ('all' | 'used' | 'unused' | 'experimental'): the usage half for skills and
  // agents only, the lifecycle half wherever an entry is experimental; reset with the kind.
  const [use, setUse] = useState('all')
  // A failed memory action (promote, forget), shown in the page's error slot until the
  // next one.
  const [actionErr, setActionErr] = useState('')
  // The last copy of a source path and how it went ({ src, ok }), so the button says so for
  // that path; a blocked clipboard (a plain-HTTP address has none) says so too.
  const [copied, setCopied] = useState(null)
  // The one install pick, as { sec, name, key }: it applies only to the entry (sec, name) it was
  // made on. Every other entry reads the server's default copy (the first install that has it).
  // Opening another entry does not clear it, so the picked entry shows that copy again on return,
  // until a pick on another entry replaces it.
  const [copyFrom, setCopyFrom] = useState(null)

  // Follow the route's section, and drop any filter text so it doesn't carry across kinds.
  // Adjusted during render against the last-seen prop, not in an effect.
  const [seenSection, setSeenSection] = useState(section)
  if (section !== seenSection) {
    setSeenSection(section)
    setActionErr('')
    const next = resolveSec(section, lock)
    if (next !== sec) {
      setSec(next)
      setQ('')
      setCat('all')
      setUse('all')
    }
  }
  // A failed action names one entry: opening another drops it, the same way.
  const [seenSelected, setSeenSelected] = useState(selected)
  if (selected !== seenSelected) {
    setSeenSelected(selected)
    setActionErr('')
  }

  const {
    data: catalog,
    error: catErr,
    reload: reloadCatalog,
  } = useAsync(() => api.catalog(sec), [sec, dataRev], 'catalog')

  // How often each skill or agent fires, fleet-wide (GET /api/usage `names`). A soft read: a
  // failed, missing or older-shaped answer hides the usage UI and never breaks the page.
  const useKind = lock ? null : USE_KIND[sec] || null
  // Skills, agents, memory and notebook are listed across every install; each row names the
  // installs that have it.
  const fleetOn = useKind !== null || sec === 'memory' || sec === 'notebook'
  // The rail counts skills and agents off the same fleet-wide lists the page shows, not off
  // `overview.counts`, which counts one install.
  const { data: fleetLists } = useAsync(
    () =>
      lock
        ? Promise.resolve(null)
        : Promise.all(Object.keys(USE_KIND).map((k) => api.catalog(k))).catch(() => null),
    [lock, dataRev],
  )
  const want = useKind !== null
  const { data: usage } = useAsync(
    () =>
      want
        ? Promise.resolve()
            .then(() => api.usage())
            .catch(() => null)
        : Promise.resolve(null),
    [want, dataRev],
    'usage',
    // The ledger is written by hooks, outside the console: a cached answer (or a failed read)
    // must not stand for the whole session, so each mount refetches.
    { revalidate: true },
  )
  const useOn = want && !!usage?.enabled && Array.isArray(usage.names)
  // One lookup per answer, keyed by kind+name: a skill and an agent may share a name.
  const byName = useMemo(
    () =>
      new Map(
        (Array.isArray(usage?.names) ? usage.names : []).map((u) => [
          `${u.kind}\u0000${u.name}`,
          u,
        ]),
      ),
    [usage],
  )
  const callsOf = (name) => (useOn && byName.get(`${useKind}\u0000${name}`)) || null
  // "Not used yet" is no call on ANY install since tracking began, not a per-install `never`.
  const unused = (it) => {
    const u = callsOf(it.name)
    return !u || (u.n === 0 && !u.last)
  }
  const noCall = usage?.since ? `No call since ${usage.since}` : 'No call recorded yet'

  // useAsync keeps the prior section's catalog in `data` while the new one is in flight
  // (so the list doesn't flash empty). Only treat it as current when its `section`
  // matches, or the first row would be the PREVIOUS kind's first item, fetched under the
  // new kind's type: a guaranteed NotFound flash on every switch.
  const items = catalog?.section === sec ? catalog?.items || [] : []
  // The entry on display: the URL-selected one, or the first row when the kind was opened
  // without a selection, so the highlighted row and the reader always agree.
  // Skills are listed class by class (splitSkills), so their first row is not items[0].
  const isSkills = sec === 'skills'
  const skillSplit = isSkills ? splitSkills(items) : null
  const rows = isSkills ? skillSplit.rows : sec === 'memory' ? groupMemory(items) : items
  const activeName = selected || rows[0]?.name || null
  const fromCatalog = activeName ? items.find((it) => it.name === activeName) : null
  const activeType = fromCatalog?.type || SECTIONS[sec].type
  const pick = copyFrom?.sec === sec && copyFrom?.name === activeName ? copyFrom.key : null
  const { data: lastItem, error: itemErr } = useAsync(
    () =>
      !activeName
        ? Promise.resolve(null)
        : pick
          ? api.item(activeType, activeName, installOfKey(pick))
          : api.item(activeType, activeName),
    [sec, activeName, activeType, pick, dataRev],
  )
  // useAsync keeps the last good read beside a failed one; here that is the PREVIOUS
  // entry, so a failed read shows nothing of it (title, lede, source).
  const item = itemErr ? null : lastItem

  const err = actionErr || catErr || itemErr
  // Prefer the catalog row; fall back to a synthetic one when the URL names an item that
  // isn't in the listing (a fresh deep link before the catalog lands).
  const synthetic = activeName
    ? { name: activeName, title: item?.title || activeName, desc: item?.desc || '' }
    : null
  const activeItem = fromCatalog || synthetic
  const counts = overview?.counts || {}
  const railCount = (k) => {
    if (!USE_KIND[k]) return counts[k] ?? ''
    if (k === sec && catalog?.section === sec) return items.length
    return fleetLists?.find((c) => c?.section === k)?.items?.length ?? ''
  }
  // Install badges only say something when the list spans two installs or more.
  const fleetWide = fleetOn && new Set(items.flatMap((it) => it.installs || [])).size > 1

  // Skills are divided by class, as the old Skills page did: listed class by class under a
  // header, with a category per class under Skills in the rail to narrow to one. A skill the
  // registry does not know is yours (`personal`), outside the taxonomy, so it gets its own
  // category only when one exists.
  const inCat = isSkills ? rows.filter((it) => cat === 'all' || it.cat === cat) : rows
  const nUnused = useOn ? inCat.filter(unused).length : 0
  const isExp = (it) => it.status === 'experimental'
  const nExp = inCat.filter(isExp).length
  // The "Show" chips: what this kind can be narrowed by. A choice that is no longer on offer
  // (the class picked holds no experimental entry) falls back to All.
  const shows = [
    ['all', 'All', inCat.length],
    ...(useOn
      ? [
          ['used', 'Used', inCat.length - nUnused],
          ['unused', 'Not used yet', nUnused, noCall],
        ]
      : []),
    ...(nExp
      ? [['experimental', 'Experimental', nExp, 'Shipped, not yet confirmed by real use']]
      : []),
  ]
  const useF = shows.some(([k]) => k === use) ? use : 'all'
  const pool =
    useF === 'all'
      ? inCat
      : useF === 'experimental'
        ? inCat.filter(isExp)
        : inCat.filter((it) => unused(it) === (useF === 'unused'))
  const useMax = useOn ? Math.max(0, ...items.map((it) => callsOf(it.name)?.n || 0)) : 0

  // Render-cap the list so a big kind (a wiki vault is the case that bites) doesn't paint
  // hundreds of rows. Typing searches the full list; the active item is always kept in view.
  // Skills are never capped: a class header must not promise rows the cap then hides.
  const CAP = isSkills ? Infinity : 50
  const ql = q.trim().toLowerCase()
  const matches = ql ? filterRows(pool, ql) : pool.slice(0, CAP)
  // A class category or a usage filter narrows on purpose, so it does not pull the active entry
  // back in.
  const shown =
    !ql &&
    cat === 'all' &&
    useF === 'all' &&
    activeName &&
    !matches.some((it) => it.name === activeName)
      ? [...matches, ...rows.filter((it) => it.name === activeName)]
      : matches

  const itemHref = (it) =>
    base ? `${base}/${enc(it.name)}` : `#/item/${it.type || SECTIONS[sec].type}/${enc(it.name)}`

  const onForget = async () => {
    const name = activeItem?.name
    if (!name) return
    const ok = await confirm(
      `Forget the memory fact "${name}"? It leaves the index and moves to memory/archive/ (geneseed memory rm --archived --purge deletes it for good).`,
      { title: 'Forget this fact?', confirmLabel: 'Forget', tone: 'danger' },
    )
    if (!ok) return
    setActionErr('')
    try {
      // The copy on screen is the one forgotten: its own install, never the default.
      await api.memoryDelete(name, item?.install ? installOfKey(item.install) : undefined)
    } catch (e) {
      // Stay on the fact that failed to go, and say why.
      setActionErr(`Could not forget "${name}": ${e.message}`)
      return
    }
    go(base || '#/section/memory')
    reloadCatalog()
  }

  // Promote a memory fact into a standing trial rule in user-rules.md, the web twin of the
  // rule skill's memory->rule flow. The fact is archived after the promotion (keeping both
  // would load the lesson twice), which is why the confirm spells that out. Lands on the
  // Rules tab so the new trial rule is immediately visible and editable.
  const onPromote = async () => {
    const name = activeItem?.name
    if (!name) return
    const ok = await confirm(
      `Promote "${name}" into a standing rule? It is appended to user-rules.md as a trial rule (a month of probation), and the memory fact moves to memory/archive/ so the lesson isn't loaded twice.`,
      { title: 'Promote to a rule?', confirmLabel: 'Promote' },
    )
    if (!ok) return
    setActionErr('')
    try {
      // The fact becomes a rule in ITS install's user-rules.md, with that file's fingerprint.
      const inst = item?.install ? installOfKey(item.install) : undefined
      const cur = await api.rules(inst)
      await api.rulesPromote({ name, fingerprint: cur.fingerprint, delete_memory: true }, inst)
      // The Rules tab must show the promoted rule: a mounted Personal (its own Memory tab)
      // reloads its read; a Personal mounted next must not be served the cached old copy.
      dropRules()
      onRulesChanged?.()
      go('#/personal/rules')
    } catch (e) {
      setActionErr(`Could not promote: ${e.message}`)
      reloadCatalog()
    }
  }

  const head = item?.body ? bodyHead(item.body, item.desc || activeItem?.desc) : null
  const named = item?.title || activeItem?.title || activeItem?.name
  const title = named === activeItem?.name && head?.title ? head.title : named
  const empty = catalog?.section === sec && items.length === 0
  const status = item?.status || activeItem?.status
  const skillCat = sec === 'skills' ? SKILL_CATS[fromCatalog?.klass] : null
  const label = SECTIONS[sec].label
  const desc = item?.desc || activeItem?.desc || ''
  const { lede, when } = splitWhen(desc)
  const src = activeItem
    ? item?.source || activeItem.source || (itemErr ? null : libSource(sec, activeItem.name))
    : null
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(src)
      setCopied({ src, ok: true })
    } catch {
      // The path stays on screen to select by hand.
      setCopied({ src, ok: false })
    }
  }

  return (
    <>
      <ErrorState error={err} style={{ margin: '0 0 var(--sp-3)' }} />
      {/* `lib-dossier` scopes the Library's own look: Docs, Loops and Kits reuse `.library`. */}
      <div className={`library lib-dossier${lock ? ' locked' : ''}${useOn ? ' uses' : ''}`}>
        {lock ? null : (
          <aside className="lib-kinds" aria-label="Library kinds">
            <div className="lib-title">
              <h1 className="h">Library</h1>
              <span className="dim">What the agent knows</span>
            </div>
            <nav className="kind-list" aria-label="Kinds">
              {LIBRARY_ORDER.map((k) => (
                <React.Fragment key={k}>
                  <a
                    href={`#/section/${k}`}
                    className={sec === k ? 'on' : ''}
                    aria-current={sec === k ? 'page' : undefined}
                  >
                    {SECTIONS[k].label}
                    <span className="mono dim">{railCount(k)}</span>
                  </a>
                  {/* The skill classes, nested under Skills while it is the selected kind:
                    they cut this kind's list only, so they sit with it, not across the card. */}
                  {k === sec && isSkills && (
                    <RailCats
                      label="Skill types"
                      total={items.length}
                      cats={skillSplit.cats}
                      cat={cat}
                      onChange={setCat}
                    />
                  )}
                </React.Fragment>
              ))}
            </nav>
          </aside>
        )}

        <LibList
          label={label}
          count={ql ? `${matches.length} of ${pool.length}` : pool.length}
          q={q}
          onQ={setQ}
          matched={matches.length}
          inView={[sec, selected]}
          extra={
            useOn && usage.since ? (
              <span className="mono dim lib-since">calls since {usage.since}</span>
            ) : null
          }
          tools={
            shows.length > 1 ? (
              <Seg aria-label="Show">
                {shows.map(([k, l, n, t]) => (
                  <button
                    type="button"
                    key={k}
                    className={useF === k ? 'on' : ''}
                    aria-pressed={useF === k}
                    title={t}
                    onClick={() => setUse(k)}
                  >
                    {l} <span className="mono">{n}</span>
                  </button>
                ))}
              </Seg>
            ) : null
          }
        >
          <GroupedRows
            rows={shown}
            activeName={activeItem?.name}
            hrefOf={itemHref}
            // Inside the row link, so nothing here may take focus: the list is one tab stop.
            pills={
              useOn || fleetWide
                ? (it) => {
                    const n = callsOf(it.name)?.n || 0
                    const badges = fleetWide
                      ? (it.installs || []).map((k) => (
                          <span
                            key={k}
                            className="tag mono lr-install"
                            title={installOfKey(k).path}
                          >
                            {installLabel(k)}
                          </span>
                        ))
                      : null
                    if (!useOn) return badges
                    return (
                      <>
                        {badges}
                        <span className="lr-use">
                          <span className="ub-trk" aria-hidden="true">
                            <i style={{ width: pct(n, useMax) }} />
                          </span>
                          <span className={n ? 'mono' : 'mono dim'}>
                            {n}
                            <span className="sr-only">{n === 1 ? ' call' : ' calls'}</span>
                          </span>
                        </span>
                      </>
                    )
                  }
                : undefined
            }
          />
          {!ql && items.length > CAP && (
            <div className="lib-more">
              Showing {CAP} of {items.length}; type to search the rest.
            </div>
          )}
          {empty &&
            (sec === 'wiki' ? (
              <EmptyState
                title="No wiki entries"
                action={<a href="#/section/config">Open the setup files</a>}
                docs={{ href: '#/docs/wiki', label: 'How to configure a wiki →' }}
              >
                Declare a wiki in <code className="mono">geneseed-wiki.jsonc</code> and its entries
                appear here.
              </EmptyState>
            ) : (
              <EmptyState title="Nothing here yet">
                Once the harness produces entries they appear here.
              </EmptyState>
            ))}
        </LibList>

        <article className="lib-reader" aria-label="Entry">
          {activeItem ? (
            <>
              <div className="reader-tags">
                <span className="tag acc">{label.replace(/s$/, '')}</span>
                {skillCat ? <span className="tag">{skillCat.label}</span> : null}
                {(item?.kit ?? activeItem.kit) ? (
                  <KitBadge name={item?.kit ?? activeItem.kit} />
                ) : null}
                <StatusBadge status={status} withHint />
                {src ? (
                  <>
                    <span className="mono dim reader-src">{src}</span>
                    <button type="button" className="btn ghost sm" onClick={onCopy}>
                      {copied?.src !== src ? 'Copy path' : copied.ok ? 'Copied' : 'Copy failed'}
                    </button>
                  </>
                ) : null}
              </div>
              <div className="reader-head">
                <h2 className="reader-title">{title}</h2>
                {/* Console-only: the agent's emblem, beside its name (components/AgentGlyph.jsx). */}
                {sec === 'agents' ? <AgentGlyph name={activeItem.name} /> : null}
              </div>
              {/* The usage tiles sit beside the lede where the reader is wide enough, under it
                  where it is not (a container query on .lib-reader). The user asked for this
                  compact header (2026-10-25), over the mockup's tiles-under-the-lede. */}
              <div className={`reader-intro${useOn ? ' with-stats' : ''}`}>
                <div className="reader-intro-text">
                  {lede ? <p className="reader-lede">{lede}</p> : null}
                  {when ? (
                    <section className="reader-when">
                      <h3 className="reader-when-h">Use when</h3>
                      <p>{when}</p>
                    </section>
                  ) : null}
                </div>
                {useOn ? (
                  <UseStats u={callsOf(activeItem.name)} usage={usage} noCall={noCall} />
                ) : null}
              </div>
              {/* Only once the copy is read: its `install` is the one a forget or a promote acts on. */}
              {sec === 'memory' &&
                item &&
                activeItem.name !== 'MEMORY' &&
                activeItem.name !== 'README' && (
                  <div className="row gap-8">
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={onPromote}
                      title="Turn this lesson into a standing trial rule in user-rules.md"
                    >
                      Promote to rule
                    </button>
                    <button type="button" className="btn ghost sm" onClick={onForget}>
                      Forget this fact
                    </button>
                  </div>
                )}
              {item?.installs?.length > 1 && item.installs.includes(item.install) ? (
                <label className="row gap-8 lib-copy">
                  <span className="dim">Viewing copy from:</span>
                  <select
                    className="sel"
                    value={pick || item.install}
                    onChange={(e) => setCopyFrom({ sec, name: activeName, key: e.target.value })}
                  >
                    {item.installs.map((k) => (
                      <option key={k} value={k} title={installOfKey(k).path}>
                        {installLabel(k)}
                      </option>
                    ))}
                  </select>
                  <span className="dim">this entry only</span>
                </label>
              ) : null}
              <hr className="hr" />
              {/* A failed read (a stale bookmark, a retired skill) ends here, not on "Loading…" forever. */}
              {itemErr ? (
                <p className="sub">
                  No {label.replace(/s$/, '').toLowerCase()} named <em>{activeItem.name}</em> could
                  be read in this install.
                </p>
              ) : activeItem?.kind === 'manifest' || item?.manifest !== undefined ? (
                item ? (
                  <ManifestDoc manifest={item.manifest} body={item.body} name={activeItem.name} />
                ) : (
                  <p className="sub">Loading…</p>
                )
              ) : item?.body ? (
                <div className="lib-doc detail-doc">
                  <Markdown body={head.body} links={item.links || []} />
                </div>
              ) : item === null && activeName ? (
                <p className="sub">Loading…</p>
              ) : (
                <EmptyDoc section={sec} source={libSource(sec, activeItem.name)} />
              )}
              {DOC_OF[sec] ? (
                <div className="reader-links">
                  <a className="btn ghost sm" href={`#/docs/${DOC_OF[sec]}`}>
                    About {label.toLowerCase()} in Docs
                  </a>
                </div>
              ) : null}
            </>
          ) : empty ? null : (
            // An empty kind has nothing to pick; the list pane already says how to fill it.
            <EmptyState title="Select an entry">
              Pick something from the list to read it.
            </EmptyState>
          )}
        </article>
      </div>
    </>
  )
}
