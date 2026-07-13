import React, { useState } from 'react'
import { Icon } from './Icon.jsx'

// Load-mode pill. `eager` reads every session, `lazy` on demand, `exclude`
// prunes an entry from a folder that would otherwise be walked. The class
// carries the colour so the palette stays in styles.css.
function LoadBadge({ load }) {
  const l = String(load || 'lazy').toLowerCase()
  const cls = l === 'eager' ? 'ok' : l === 'exclude' ? 'warn' : 'muted'
  return <span className={`mf-load mf-load-${cls}`}>{l}</span>
}

// The path/load/description table shared by both manifest kinds. An excluded
// entry is struck through — it's declared, but deliberately not loaded.
function EntryTable({ entries }) {
  if (!entries.length) return null
  return (
    <table className="mf-entries">
      <tbody>
        {entries.map((e, i) => {
          const excluded = String(e.load).toLowerCase() === 'exclude'
          return (
            <tr key={`${e.path || i}-${i}`}>
              <td className={`mf-path mono ${excluded ? 'mf-struck' : ''}`}>{e.path || '·'}</td>
              <td className="mf-load-cell">
                <LoadBadge load={e.load} />
              </td>
              <td className="mf-edesc">{e.description || ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// One declared vault: its identity line, the vault-level roles (conventions,
// inbox, protected), and its entries table.
function VaultCard({ wiki }) {
  const entries = Array.isArray(wiki.entries) ? wiki.entries : []
  const protectedDirs = Array.isArray(wiki.protected) ? wiki.protected : []
  return (
    <div className="mf-vault">
      <div className="mf-vault-head">
        <div className="mf-vault-name">{wiki.name || 'wiki'}</div>
        {wiki.path ? <code className="mf-vault-path mono">{wiki.path}</code> : null}
      </div>
      {wiki.description ? <p className="mf-vault-desc">{wiki.description}</p> : null}
      <div className="mf-roles">
        {wiki.conventions ? (
          <span className="mf-role">
            <Icon name="skill" className="glyph" /> conventions: {wiki.conventions}
          </span>
        ) : null}
        {wiki.inbox ? (
          <span className="mf-role">
            <Icon name="notebook" className="glyph" /> inbox: {wiki.inbox}
          </span>
        ) : null}
        {protectedDirs.map((d) => (
          <span key={d} className="mf-role mf-role-danger">
            <Icon name="law" className="glyph" /> protected: {d}
          </span>
        ))}
      </div>
      <EntryTable entries={entries} />
    </div>
  )
}

// Collapsible raw source, so the parsed view never hides the literal file.
function RawSource({ body }) {
  const [open, setOpen] = useState(false)
  if (!body) return null
  return (
    <div className="mf-raw">
      <button className="mf-raw-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon name="chevron" className={`glyph mf-caret ${open ? 'on' : ''}`} />
        Raw source
      </button>
      {open ? <pre className="mf-raw-pre">{body.replace(/^```json\n|\n```$/g, '')}</pre> : null}
    </div>
  )
}

// ManifestDoc — renders a parsed setup manifest (wiki.jsonc or context.json) as
// cards + an entries table instead of a raw JSON dump. Falls back to the raw
// body when the file couldn't be parsed. Empty manifests become onboarding:
// they explain how to wire the thing up rather than reading as "nothing here".
export default function ManifestDoc({ manifest, body, name }) {
  if (!manifest) {
    return (
      <pre className="mf-raw-pre">{(body || '').replace(/^```json\n|\n```$/g, '')}</pre>
    )
  }

  if (manifest.kind === 'wiki') {
    const wikis = manifest.wikis || []
    if (!wikis.length) {
      return (
        <div className="mf-empty">
          <div className="mf-empty-title">No wiki declared yet</div>
          <p>
            A wiki is your machine-wide knowledge base — an Obsidian vault or any folder of
            linked markdown the agent reads from and writes back to. Declare one in{' '}
            <code className="mono">wiki.jsonc</code> to switch it on.
          </p>
          <a className="btn ghost sm" href="#/docs/configure-wiki">
            How to configure a wiki
          </a>
          <RawSource body={body} />
        </div>
      )
    }
    return (
      <div className="mf-doc">
        {wikis.map((w, i) => (
          <VaultCard key={w.name || i} wiki={w} />
        ))}
        <RawSource body={body} />
      </div>
    )
  }

  // context.json
  const entries = manifest.context || []
  if (!entries.length) {
    return (
      <div className="mf-empty">
        <div className="mf-empty-title">No project context declared</div>
        <p>
          Point the agent at this project's own docs by adding entries to{' '}
          <code className="mono">{name || 'context.json'}</code> — each with a{' '}
          <code className="mono">path</code>, a <code className="mono">load</code> mode
          (eager or lazy), and a description.
        </p>
        <RawSource body={body} />
      </div>
    )
  }
  return (
    <div className="mf-doc">
      <EntryTable entries={entries} />
      <RawSource body={body} />
    </div>
  )
}
