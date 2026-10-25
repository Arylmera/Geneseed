import React, { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon.jsx'
import { api } from '../../api/index.js'
import { FLAVOURS } from '../../hooks/useFlavour.js'
import { accentTagline } from '../../hooks/useAccentMode.js'
import AccentPicker from '../../components/AccentPicker.jsx'
import { LAYOUTS } from '../../hooks/useLayout.js'
import { RestartServer, StopServer } from './ServerControl.jsx'
import Seg from '../../components/Seg.jsx'
import { useConfirm } from '../../hooks/useConfirm.jsx'
import { TAB_LABELS } from '../../lib/router.js'
import { hostInfo } from '../../lib/hosts.js'
import { relTime } from '../../lib/format.js'
import { motionOK } from '../../lib/motion.js'

// The repo the install actually updates from (its git origin). Falls back to the canonical
// upstream when the About payload can't be fetched. The github-shaped deep links (/issues,
// /blob/main/LICENSE) only resolve on github.com, so they are gated on repo_is_github.
const FALLBACK_REPO = 'https://github.com/Arylmera/Geneseed'
const CREATOR_URL = 'https://github.com/Arylmera'

// The sheet's sections, in page order: the index is built from this, so the two never differ.
const SECTIONS = [
  ['appearance', 'Appearance'],
  ['machine', 'Machine'],
  ['server', 'Server'],
  ['about', 'About'],
  ['danger', 'Danger zone'],
]

// What stops another page from driving the console, each enforced in js/web/handler.mjs
// (requestGuard and the response headers). Stated, not probed: a GET cannot see its own guard.
const GUARDS = ['Host check', 'token on writes', 'framing refused', 'cross-site GET refused']

// One row of the sheet: what it is, with one line of help, its value, and its control.
function Row({ k, help, children, control }) {
  return (
    <div className="sheet-row">
      <span className="sheet-k">
        {k}
        {help ? <span className="sheet-h sub">{help}</span> : null}
      </span>
      <div className="sheet-v">{children}</div>
      <div className="sheet-c">{control}</div>
    </div>
  )
}

function Section({ id, title, head, className = '', children }) {
  return (
    <section id={`set-${id}`} className={`card sheet-sec ${className}`} aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <h3 id={`${id}-h`}>{title}</h3>
        {head}
      </div>
      {children}
    </section>
  )
}

// The index scrolls instead of linking: a bare href="#server" would be read by the hash router
// as a page and leave the Installs view.
function SheetIndex({ stale }) {
  const go = (id) =>
    document
      .getElementById(`set-${id}`)
      ?.scrollIntoView?.({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' })
  return (
    <nav className="sheet-index" aria-label="On this page">
      {SECTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={id === 'danger' ? 't-bad' : ''}
          onClick={() => go(id)}
        >
          {label}
          {id === 'server' && (
            <span className={`sheet-dot ${stale ? 'warn' : 'good'}`} aria-hidden="true" />
          )}
        </button>
      ))}
    </nav>
  )
}

// The About rows, folded in from the retired `#/about` tab (which still resolves here —
// router.js's VIEW_ALIAS).
function AboutSection({ version }) {
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
  // The changelog and the credits are repo files with no console docs page, so they open on
  // the repo — on github.com only, like every other deep link here.
  const ext = (href, label) => (
    <a href={href} target="_blank" rel="noreferrer">
      {label} <Icon name="external" />
    </a>
  )

  return (
    <Section id="about" title="About">
      <Row
        k="Version"
        control={isGithub ? ext(repo + '/blob/main/CHANGELOG.md', 'Changelog') : null}
      >
        <span className="mono">{version || 'unknown'}</span>
      </Row>
      {isGithub ? (
        <Row k="Credits" control={ext(repo + '#-credits', 'Credits')}>
          <span className="sub">
            Skills and agents adapted from other projects, with their licences
          </span>
        </Row>
      ) : null}
      <Row
        k="Geneseed"
        help="MIT-licensed"
        control={
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
        }
      >
        <span className="sub">
          A portable, theme-able harness you implant once and use everywhere to grow a disciplined
          AI coding agent. One canonical source, many voices.
        </span>
      </Row>
      <Row
        k="Creator"
        control={
          <a className="btn ghost" href={CREATOR_URL} target="_blank" rel="noreferrer">
            <Icon name="github" />
            @Arylmera on GitHub
          </a>
        }
      >
        <span className="sub">
          Built by <strong>Guillaume Lemer</strong>. It started as a personal, Obsidian-vault-grown
          agent operating system and was distilled into the repo you are running. If you find it
          useful, a star on the repo or an issue with feedback is the best way to help shape what
          comes next.
        </span>
      </Row>
    </Section>
  )
}

// The Server tab as a settings sheet: a section index beside rows of label | value | control.
// Appearance is client-only and live; Machine acts on this copy and the viewed install; Server
// describes the process answering the page; Danger zone holds what takes something away.
// Per-install detail and building live on the Hosts tab and the Overview.
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
  const confirm = useConfirm()
  const install = overview?.install
  const footprint = overview?.footprint
  const server = overview?.server
  const stale = overview?.daemon_stale

  const setFootprint = async (fp) => {
    if (!install || fp === footprint) return
    const ok = await confirm(
      `Rebuild ${hostInfo(install.host).label} · ${install.scope} with the “${fp}” footprint? ` +
        `It rebuilds in place, non-destructive.`,
      { title: 'Change the footprint?', confirmLabel: 'Rebuild' },
    )
    if (ok) onAction?.('install', { ...install, footprint: fp })
  }
  const autostart =
    server?.autostart === true
      ? 'On · login script'
      : server?.autostart === false
        ? 'Off'
        : 'unknown'

  return (
    <div className="narrow-lg">
      <div className="head-row mb-18">
        <div>
          <h2 className="h">{TAB_LABELS.server}</h2>
          <p className="sub">
            Console appearance, this copy of Geneseed, the local server, and about. Each install is
            managed on the Hosts tab.
          </p>
        </div>
      </div>

      <div className="sheet">
        <SheetIndex stale={stale} />
        <div className="sheet-body">
          <Section id="appearance" title="Appearance">
            {flavour && onFlavour && (
              <Row
                k={<span id="dir-skin-label">Skin</span>}
                help="Colours and fonts of the console"
              >
                <Seg aria-labelledby="dir-skin-label">
                  {FLAVOURS.map((f) => (
                    <button
                      key={f.id}
                      className={flavour === f.id ? 'on' : ''}
                      onClick={() => onFlavour(f.id)}
                      aria-pressed={flavour === f.id}
                      title={f.tagline}
                    >
                      {f.short}
                    </button>
                  ))}
                </Seg>
                <span className="dir-layout-note sub" role="status" aria-live="polite">
                  {FLAVOURS.find((f) => f.id === flavour)?.tagline ?? ''}
                </span>
              </Row>
            )}
            {accentMode && onAccentMode && (
              <Row k={<span id="dir-accent-label">Accent</span>} help="Live, saved in this browser">
                <AccentPicker
                  value={accentMode}
                  onChange={onAccentMode}
                  labelledBy="dir-accent-label"
                />
                <span className="dir-layout-note sub" role="status" aria-live="polite">
                  {accentTagline(accentMode)}
                </span>
              </Row>
            )}
            {layout && onLayout && (
              <Row
                k={<span id="dir-layout-label">Overview view</span>}
                help="The Overview, or one of the older dashboards"
              >
                <Seg aria-labelledby="dir-layout-label">
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
                </Seg>
                <span className="dir-layout-note sub" role="status" aria-live="polite">
                  {LAYOUTS.find((l) => l.id === layout)?.tagline ?? ''}
                </span>
              </Row>
            )}
          </Section>

          <Section id="machine" title="Machine">
            <Row
              k="Geneseed"
              help="This copy of the source"
              control={
                <button className="btn" onClick={() => onAction('update')}>
                  <Icon name="download" />
                  Update (git pull + rebuild)
                </button>
              }
            >
              <span className="mono">{overview?.version || 'unknown'}</span>
            </Row>
            <Row
              k="Command on PATH"
              help="Run geneseed from any folder"
              control={
                <button className="btn ghost" onClick={() => onAction('link')}>
                  <Icon name="external" />
                  Add to PATH
                </button>
              }
            />
            {/* How much of the Rules AGENT.md carries inline for the viewed install: a
                token-cost dial; flipping it rebuilds the install in place (re-emit). */}
            {install && footprint && (
              <Row
                k={<span id="footprint-label">Harness footprint</span>}
                help={
                  <>
                    For {hostInfo(install.host).label} · {install.scope}; every Rule stays in force.{' '}
                    <a href="#/docs/footprint">Learn more →</a>
                  </>
                }
              >
                <Seg aria-labelledby="footprint-label">
                  {['lean', 'full'].map((fp) => (
                    <button
                      key={fp}
                      className={footprint === fp ? 'on' : ''}
                      onClick={() => setFootprint(fp)}
                      aria-pressed={footprint === fp}
                    >
                      {fp}
                    </button>
                  ))}
                </Seg>
                <span className="dir-layout-note sub" role="status" aria-live="polite">
                  {footprint === 'lean'
                    ? 'Lean: terse rule lines + a pointer to the full law file (~40% smaller, lighter context per turn).'
                    : 'Full: every Rule’s complete text and rationale inlined (maximum guidance, largest context).'}
                </span>
              </Row>
            )}
          </Section>

          <Section
            id="server"
            title="Server"
            className="sheet-live"
            head={
              <>
                <span className="pill good">running</span>
                <span className="mono dim">
                  127.0.0.1:{window.location.port || '80'}
                  {server ? ` · pid ${server.pid} · up ${relTime(server.started)}` : ''}
                </span>
              </>
            }
          >
            <Row
              k="Code"
              help="The page you see matches the build on disk"
              control={<RestartServer />}
            >
              {stale ? (
                <span className="pill warn">disk has newer code → Restart</span>
              ) : (
                <span className="pill good">matches disk</span>
              )}
            </Row>
            <Row k="Start at login" help="A login script you set up by hand (install guide)">
              <span className="sub">{autostart}</span>
            </Row>
            <Row k="Guards" help="What stops another page from driving the console">
              <span className="row wrap gap-8">
                {GUARDS.map((g) => (
                  <span key={g} className="pill good">
                    {g}
                  </span>
                ))}
              </span>
            </Row>
          </Section>

          <AboutSection version={overview?.version} />

          <Section id="danger" title="Danger zone" className="danger-zone">
            <Row
              k="Stop the server"
              help="The console goes offline until you run geneseed web"
              control={<StopServer />}
            />
            <Row
              k="The geneseed command"
              help="Installs keep working; only the command goes"
              control={
                <button className="btn ghost danger-line" onClick={() => onAction('unlink')}>
                  Remove from PATH
                </button>
              }
            />
            <Row k="Uninstall a harness">
              <span className="sub">
                Each install has its own Uninstall in <a href="#/installs/hosts">Hosts</a>, bound to
                its host and path.
              </span>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  )
}
