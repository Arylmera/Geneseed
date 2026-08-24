import React, { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon.jsx'
import { api } from '../../api/index.js'
import { FLAVOURS } from '../../hooks/useFlavour.js'
import { ACCENT_MODES } from '../../hooks/useAccentMode.js'
import { LAYOUTS, defaultLayoutFor } from '../../hooks/useLayout.js'
import ServerControl from './ServerControl.jsx'

// The repo the install actually updates from (its git origin). Falls back to the canonical
// upstream when the About payload can't be fetched. The github-shaped deep links (/issues,
// /blob/main/LICENSE) only resolve on github.com, so they are gated on repo_is_github.
const FALLBACK_REPO = 'https://github.com/Arylmera/Geneseed'
const CREATOR_URL = 'https://github.com/Arylmera'

// The About cards, folded in from the retired `#/about` tab (which still resolves here —
// router.js's VIEW_ALIAS). It was a two-card page of static prose with one fetch, reached
// from its own rail group of one; as the last section of Setup → Settings it costs a scroll
// instead of a tab, and the rail loses a group whose only member was a colophon.
function AboutSection() {
  const [repo, setRepo] = useState(FALLBACK_REPO)
  const [isGithub, setIsGithub] = useState(true)
  useEffect(() => {
    // Wrapped rather than called bare: Settings renders in suites that stub the api module
    // down to the calls the page under test makes, and an optional-chained miss yields
    // `undefined`, which has no `.then`. The fallback repo above is the whole point — this
    // fetch only ever upgrades a constant.
    Promise.resolve(api.docsPage?.('about'))
      .then((p) => {
        if (p?.repo) {
          setRepo(p.repo)
          setIsGithub(!!p.repo_is_github)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <>
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>About</h3>
        </div>
        <p className="sub mb-16">
          Geneseed is a portable, theme-able harness you implant once and use everywhere to grow a
          disciplined AI coding agent. One canonical source, many voices, MIT-licensed.
        </p>
        <div className="row wrap gap-10">
          <a className="btn ghost" href={repo} target="_blank" rel="noreferrer">
            <Icon name="github" />
            {isGithub ? 'Source on GitHub' : 'Source repo'}
          </a>
          {isGithub && (
            <>
              <a className="btn ghost" href={repo + '/issues'} target="_blank" rel="noreferrer">
                <Icon name="external" />
                Issues
              </a>
              <a
                className="btn ghost"
                href={repo + '/blob/main/LICENSE'}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="external" />
                MIT License
              </a>
            </>
          )}
        </div>
      </div>

      <div className="card pad-lg">
        <div className="card-head">
          <h3>Creator</h3>
        </div>
        <p className="sub mb-16">
          Geneseed is built by <strong>Guillaume Lemer</strong>. It started as a personal,
          Obsidian-vault-grown agent operating system and was distilled into the repo you are
          running. Implant it once, and a disciplined agent grows around the same inherited rules,
          skills, and memory in every repo it follows you into.
        </p>
        <p className="sub mb-16">
          If you find this useful, a star on the repo or an issue with feedback is the best way to
          help shape what comes next.
        </p>
        <div className="row wrap gap-10">
          <a className="btn ghost" href={CREATOR_URL} target="_blank" rel="noreferrer">
            <Icon name="github" />
            @Arylmera on GitHub
          </a>
        </div>
      </div>
    </>
  )
}

// The settings page: the console direction picker, machine maintenance
// (PATH/uninstall, git-pull update), server control, and the About colophon.
// Per-install detail and building live in the Harness tab and the Dashboard.
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
            Console direction, harness footprint, machine maintenance (incl. git-pull update),
            server control, and about. See per-install detail in the Harness tab; build from there
            and the Dashboard.
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
      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Server</h3>
        </div>
        <p className="sub mb-16">
          The console runs a small local server. Leave it running in the background and reopen any
          time, or stop it when you are done.
        </p>
        <ServerControl />
      </div>

      <AboutSection />
    </div>
  )
}
