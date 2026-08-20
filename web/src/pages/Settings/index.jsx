import React, { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon.jsx'
import { FLAVOURS } from '../../hooks/useFlavour.js'
import { ACCENT_MODES } from '../../hooks/useAccentMode.js'
import { LAYOUTS, defaultLayoutFor } from '../../hooks/useLayout.js'
import ServerControl from './ServerControl.jsx'

// The settings page: the console direction picker, machine maintenance
// (PATH/uninstall, git-pull update), and server control. Per-install detail and
// building live in the Harnesses tab and the Dashboard.
export default function Settings({
  overview,
  onAction,
  flavour,
  onFlavour,
  accentMode,
  onAccentMode,
  layout,
  onLayout,
}) {
  const install = overview?.install
  const footprint = overview?.footprint

  // ---- doctrine packs: STAGED, then applied once ------------------------------------------
  //
  // ⚠ ONE REBUILD, NOT ONE PER TOGGLE. Every other control on this page is either live
  // (console direction) or a single choice (footprint), so each can act on click. A pack
  // selection is a SET, and acting per click would re-emit the install four times to get from
  // all-four to one — four rebuilds, three of them describing a state nobody asked for, and
  // the intermediate ones would each write a different `Active packs:` marker. So the switches
  // edit local state and `Apply` sends the whole selection.
  const packs = overview?.doctrines ?? []
  const deployed = packs.filter((p) => p.active).map((p) => p.pack)
  const [picked, setPicked] = useState(deployed)
  // Re-sync when the overview refetches — after an Apply, and after anything else rebuilds the
  // install. Keyed on the VALUE rather than on the array identity: `overview` is a fresh object
  // on every poll, so an identity dependency would discard a half-made selection every few
  // seconds. `deployed` is already in PACK_ORDER, so the join is a stable key.
  const deployedKey = deployed.join(',')
  useEffect(() => {
    setPicked(deployedKey ? deployedKey.split(',') : [])
  }, [deployedKey])

  const isOn = (name) => picked.includes(name)
  const togglePack = (name) =>
    setPicked((cur) => (cur.includes(name) ? cur.filter((p) => p !== name) : [...cur, name]))
  // Compared in PACK_ORDER — `packs` arrives in it — so a toggle off and back on is not "dirty".
  const pickedKey = packs
    .filter((p) => isOn(p.pack))
    .map((p) => p.pack)
    .join(',')
  const dirty = pickedKey !== deployedKey
  const losingConsent = deployed.includes('process') && !picked.includes('process')

  const applyPacks = () => {
    if (!install || !dirty) return
    const chosen = packs.filter((p) => isOn(p.pack)).map((p) => p.pack)
    // The consent gate is a real capability and turning it off is a supported choice — so this
    // names the consequence rather than refusing it. `git commit`/`git push` stop being gated
    // at the tool boundary because the rule behind that gate is no longer built in; the
    // invariant-territory refusals (`rm -rf`, force-push) are unaffected either way.
    const warn = losingConsent
      ? '\n\n⚠ The process pack carries commit/push consent. Dropping it also removes the ' +
        'git-gate hook, so commits and pushes stop being confirmed at the tool boundary. ' +
        '(rm -rf and force-push stay gated — those are Rule IV’s, not the pack’s.)'
      : ''
    if (
      window.confirm(
        `Rebuild ${install.host} · ${install.scope} with ${
          chosen.length ? chosen.join(', ') : 'no doctrine packs'
        }? It rebuilds in place, non-destructive.${warn}`,
      )
    )
      onAction?.('install', { ...install, doctrines: chosen })
  }

  const setFootprint = (fp) => {
    if (!install || fp === footprint) return
    if (
      window.confirm(
        `Rebuild ${install.host} · ${install.scope} with the “${fp}” footprint? ` +
          `It rebuilds in place, non-destructive.`,
      )
    )
      onAction?.('install', { ...install, footprint: fp })
  }
  return (
    <div className="narrow-lg">
      <div className="head-row mb-18">
        <div>
          <h1 className="h">Settings</h1>
          <p className="sub">
            Console direction, harness footprint, machine maintenance (incl. git-pull update), and
            server control. See per-install detail in the Harnesses tab; build from there and the
            Dashboard.
          </p>
        </div>
      </div>

      {/* Console direction card — picks the visual flavour of the console.
          Persisted to localStorage; the change is live (no rebuild needed). */}
      {flavour && onFlavour && (
        <div className="card pad-lg mb-16">
          <div className="card-head">
            <h3>Console direction</h3>
          </div>
          <p className="sub mb-16">
            {FLAVOURS.length} takes on the same data. Pick a direction; it applies instantly and
            persists across reloads.
          </p>

          {/* Accent source — chosen independently of the skin below. 'Auto'
              follows the deployed voice's accent; 'Curated' gives each theme its
              own designed signature colour. Live, persisted across reloads. */}
          {accentMode && onAccentMode && (
            <div className="dir-layout">
              <span className="tick" id="dir-accent-label">
                Accent
              </span>
              <div className="seg" role="group" aria-labelledby="dir-accent-label">
                {ACCENT_MODES.map((m) => (
                  <button
                    key={m.id}
                    className={accentMode === m.id ? 'on' : ''}
                    onClick={() => onAccentMode(m.id)}
                    aria-pressed={accentMode === m.id}
                    title={m.tagline}
                  >
                    {m.short}
                  </button>
                ))}
              </div>
              <span className="dir-layout-note sub" role="status" aria-live="polite">
                {ACCENT_MODES.find((m) => m.id === accentMode)?.tagline ?? ''}
              </span>
            </div>
          )}

          {/* Dashboard layout — the Status lens, chosen independently of the
              skin chosen below. 'Auto' follows the layout each theme was
              designed around; the others force one regardless of skin. */}
          {layout && onLayout && (
            <div className="dir-layout">
              <span className="tick" id="dir-layout-label">
                Dashboard layout
              </span>
              <div className="seg" role="group" aria-labelledby="dir-layout-label">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    className={layout === l.id ? 'on' : ''}
                    onClick={() => onLayout(l.id)}
                    aria-pressed={layout === l.id}
                    title={l.tagline}
                  >
                    {l.short}
                  </button>
                ))}
              </div>
              <span className="dir-layout-note sub" role="status" aria-live="polite">
                {layout === 'auto'
                  ? `Following the theme: ${
                      LAYOUTS.find((l) => l.id === defaultLayoutFor(flavour))?.short ?? ''
                    }.`
                  : (LAYOUTS.find((l) => l.id === layout)?.tagline ?? '')}
              </span>
            </div>
          )}

          <div className="dir-grid">
            {FLAVOURS.map((f) => (
              <button
                key={f.id}
                className={`dir-tile dir-${f.id} ${flavour === f.id ? 'on' : ''}`}
                onClick={() => onFlavour(f.id)}
                aria-pressed={flavour === f.id}
              >
                <span className="dir-thumb" aria-hidden="true">
                  <span className="dir-thumb-rail" />
                  <span className="dir-thumb-bar" />
                  <span className="dir-thumb-bar" style={{ width: '70%' }} />
                  <span className="dir-thumb-bar" style={{ width: '52%' }} />
                  <span className="dir-thumb-dot" />
                </span>
                <span className="dir-meta">
                  <span className="dir-name">
                    {f.short}
                    {flavour === f.id && <span className="dir-check">● active</span>}
                  </span>
                  <span className="dir-tag">{f.tagline}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Harness footprint — how much of the Rules AGENT.md carries inline for the
          current install. A token-cost dial; flipping it rebuilds the install in place
          (re-emit), unlike the live console-direction controls above. */}
      {install && footprint && (
        <div className="card pad-lg mb-16">
          <div className="card-head">
            <h3>Harness footprint</h3>
          </div>
          <p className="sub mb-16">
            How much of the Rules <code>AGENT.md</code> carries inline each turn, for the current
            install (
            <code>
              {install.host} · {install.scope}
            </code>
            ). A token-cost dial; every Rule stays in force either way. Changing it rebuilds the
            install in place. <a href="#/docs/footprint">Learn more →</a>
          </p>
          <div className="dir-layout">
            <span className="tick" id="footprint-label">
              Footprint
            </span>
            <div className="seg" role="group" aria-labelledby="footprint-label">
              {['full', 'lean'].map((fp) => (
                <button
                  key={fp}
                  className={footprint === fp ? 'on' : ''}
                  onClick={() => setFootprint(fp)}
                  aria-pressed={footprint === fp}
                >
                  {fp}
                </button>
              ))}
            </div>
            <span className="dir-layout-note sub" role="status" aria-live="polite">
              {footprint === 'lean'
                ? 'Lean: terse rule lines + a pointer to the full law file (~40% smaller, lighter context per turn).'
                : 'Full: every Rule’s complete text and rationale inlined (maximum guidance, largest context).'}
            </span>
          </div>
        </div>
      )}

      {/* Doctrine packs — which practice rules this install is bound by. Unlike the footprint
          dial above, a pack that is off is genuinely NOT in AGENT.md: this changes what the
          agent must do, not how much of it loads. Staged, applied once. */}
      {install && packs.length > 0 && (
        <div className="card pad-lg mb-16">
          <div className="card-head">
            <h3>Doctrine packs</h3>
          </div>
          <p className="sub mb-16">
            Which practice rules bind this install (
            <code>
              {install.host} · {install.scope}
            </code>
            ). The Ontology and the nine Rules are always on and are not listed here — these are the
            toggleable tier. A pack you switch off still ships in the bundle, so its text stays
            readable and any rule citing it still resolves; it just stops being rendered into{' '}
            <code>AGENT.md</code>. <a href="#/laws">Read them →</a>
          </p>
          <div className="pack-toggles">
            {packs.map((p) => (
              <label className="pack-toggle" key={p.pack}>
                <span
                  className={`sw-toggle${isOn(p.pack) ? ' on' : ''}`}
                  role="switch"
                  aria-checked={isOn(p.pack)}
                  aria-label={`${p.title} pack`}
                  tabIndex={0}
                  onClick={() => togglePack(p.pack)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      if (e.key === ' ') e.preventDefault()
                      togglePack(p.pack)
                    }
                  }}
                />
                <span className="pack-toggle-body">
                  <span className="pack-toggle-name">
                    {p.title}
                    <span className="pack-toggle-n">
                      {p.rules} rule{p.rules === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="sub">{p.desc}</span>
                </span>
              </label>
            ))}
          </div>
          {losingConsent && (
            <p className="pack-warn" role="status" aria-live="polite">
              ⚠ Dropping <b>process</b> also removes the commit/push consent gate —{' '}
              <code>git commit</code> and <code>git push</code> stop being confirmed at the tool
              boundary. <code>rm -rf</code> and force-push stay gated.
            </p>
          )}
          <div className="pack-apply">
            <button className="btn soft" onClick={applyPacks} disabled={!dirty}>
              Apply{dirty ? ` (${picked.length}/${packs.length} packs)` : ''}
            </button>
            <button
              className="btn ghost"
              onClick={() => setPicked(deployedKey ? deployedKey.split(',') : [])}
              disabled={!dirty}
            >
              Revert
            </button>
            <span className="sub" role="status" aria-live="polite">
              {dirty
                ? 'Not applied yet — Apply rebuilds the install once, with every change together.'
                : 'Matches the deployed install.'}
            </span>
          </div>
        </div>
      )}

      {/* Maintenance card */}
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Maintenance</h3>
        </div>
        <p className="sub mb-16">
          Put <code>geneseed</code> on your PATH so it runs from any directory, or remove a global
          install. Your memory store is always kept. Each runs live in the console.
        </p>
        <div className="row wrap gap-10">
          <button className="btn ghost" onClick={() => onAction('update')}>
            <Icon name="download" />
            Update (git pull + rebuild)
          </button>
          <button className="btn ghost" onClick={() => onAction('link')}>
            <Icon name="external" />
            Add to PATH
          </button>
          <button className="btn ghost" onClick={() => onAction('unlink')}>
            Remove from PATH
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              if (
                window.confirm(
                  'Uninstall the global Geneseed harness? Your memory store is kept; everything else this install added is removed.',
                )
              )
                onAction('uninstall')
            }}
          >
            <Icon name="clear" />
            Uninstall
          </button>
        </div>
      </div>

      {/* Server card */}
      <div className="card pad-lg">
        <div className="card-head">
          <h3>Server</h3>
        </div>
        <p className="sub mb-16">
          The console runs a small local server. Leave it running in the background and reopen any
          time, or stop it when you are done.
        </p>
        <ServerControl />
      </div>
    </div>
  )
}
