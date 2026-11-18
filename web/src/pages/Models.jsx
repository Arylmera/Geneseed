import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { useInstallPick, useInstalls } from '../hooks/useInstalls.js'
import { hostInfo, installTag, pairOf } from '../lib/hosts.js'
import { becauseOf, isDetected, tierNow } from '../lib/models.js'
import InstallPicker from '../components/InstallPicker.jsx'
import ErrorState from '../components/ErrorState.jsx'
import Loading from '../components/Loading.jsx'
import ModelPicker from '../components/ModelPicker.jsx'
import PageHeader from '../components/PageHeader.jsx'
import Seg from '../components/Seg.jsx'

// Build → Models: which model each sub-agent of ONE install runs on (GET/POST /api/agent-models).
// Claude Code, OpenCode and OpenClaude share this page and one picker; Bob takes no per-agent model.
//
// What a save writes is `agent-overrides.json` (the `tiers` map and each agent's pin); the model
// reaches the agent files at the next rebuild, which the footer offers through the existing
// `install` action. The routing (`--tiers off|auto`) is not a file: it rides that same rebuild, as
// the action's `tiers` field. A draft is held here until Save; nothing is written by picking.
const TIERS = [
  ['standard', 'Standard'],
  ['light', 'Light'],
]
const TIER_TONE = { strong: 'acc', standard: '', light: 'ok' }
const TIER_RANK = { strong: 0, standard: 1, light: 2 }
const ROUTING = ['off', 'auto']

export default function Models({ dataRev, onAction }) {
  const confirm = useConfirm()
  const active = useInstalls(dataRev)
  const [install, pickInstall] = useInstallPick('models', active)
  const { data, error, setData, reload } = useAsync(
    () => Promise.resolve().then(() => api.agentModels(pairOf(install))),
    [dataRev, install?.id ?? ''],
  )
  const [tierDraft, setTierDraft] = useState({}) // { standard?: string | null }
  const [pinDraft, setPinDraft] = useState({}) // { <agent>: string | null }
  const [routing, setRouting] = useState(null) // null = what the install has
  const [picking, setPicking] = useState(null) // { kind: 'tier'|'pin', key }
  const [sort, setSort] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // A new install starts with a clean slate: drafts are about one install's file.
  const [seen, setSeen] = useState(install?.id)
  if (install?.id !== seen) {
    setSeen(install?.id)
    setTierDraft({})
    setPinDraft({})
    setRouting(null)
    setSaved(false)
    setErr('')
  }

  const head = (
    <>
      <InstallPicker
        className="page-pick"
        installs={active}
        value={install}
        onChange={pickInstall}
      />
      <PageHeader
        title="Models"
        sub="The model each sub-agent runs on, per install. Strong agents always use your session model."
      />
    </>
  )
  if (error)
    return (
      <div className="lib-wrap">
        {head}
        <ErrorState error={error} />
      </div>
    )
  if (!data || !install)
    return (
      <div className="lib-wrap">
        {head}
        {error ? null : <Loading />}
      </div>
    )
  const label = hostInfo(data.host).label
  if (!data.claude) {
    return (
      <div className="lib-wrap">
        {head}
        <p className="sub">
          {label} takes no per-agent model, so there is nothing to set here for{' '}
          {installTag(install)}.
        </p>
      </div>
    )
  }

  const problem = data.file?.problem
  const routingNow = routing ?? data.tiers
  const models = data.models || []
  const hasTier = (t) => tierDraft[t] !== undefined
  const tierValue = (t) =>
    hasTier(t)
      ? tierDraft[t] === null
        ? (data.defaults?.[t] ?? '')
        : tierDraft[t]
      : tierNow(data, t)
  const pinValue = (a) => (pinDraft[a.name] !== undefined ? pinDraft[a.name] : a.pin)
  const changes = Object.keys(tierDraft).length + Object.keys(pinDraft).length
  const sorted = sort
    ? [...data.agents].sort(
        (a, b) =>
          (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || a.name.localeCompare(b.name),
      )
    : data.agents
  const nameOf = (id) => {
    if (!id) return 'Session model'
    const m = models.find((x) => x.id === id && x.provider !== 'in-use')
    return m && m.name !== m.id ? `${m.name} (${id})` : id
  }
  const mark = (id) =>
    isDetected(models, id) ? null : <span className="tag warn">not detected</span>

  const choose = (value) => {
    const { kind, key } = picking
    setPicking(null)
    setSaved(false)
    if (kind === 'tier') {
      // `inherit` is the user's choice of the session model: an empty value, as the build reads it.
      // The host's own default is "no key", so the file stays minimal and the default can move.
      const v = value === 'inherit' ? '' : value
      setTierDraft((d) => ({ ...d, [key]: v === (data.defaults?.[key] ?? undefined) ? null : v }))
    } else {
      setPinDraft((d) => ({ ...d, [key]: value === 'inherit' ? null : value }))
    }
  }

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const res = await api.agentModelsSave({ tiers: tierDraft, agents: pinDraft }, pairOf(install))
      setData({ ...data, ...res })
      reload()
      setTierDraft({})
      setPinDraft({})
      setSaved(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const rebuild = async () => {
    const ok = await confirm(
      `Rebuild this ${label} install with model routing ${routingNow}? ` +
        'The models are written into the agent files; it rebuilds in place, non-destructive.',
      { title: 'Rebuild this install?', confirmLabel: 'Rebuild' },
    )
    if (ok) {
      onAction?.('install', {
        host: install.host,
        scope: install.scope,
        path: install.path,
        tiers: routingNow,
      })
    }
  }

  const current = picking
    ? picking.kind === 'tier'
      ? tierValue(picking.key) || 'inherit'
      : (pinDraft[picking.key] !== undefined
          ? pinDraft[picking.key]
          : data.agents.find((a) => a.name === picking.key)?.pin) || 'inherit'
    : null

  return (
    <div className="lib-wrap models-page">
      {head}
      <ErrorState error={err} style={{ margin: '0 0 var(--sp-3)' }} />
      {problem ? (
        <p className="sub tiers-warn" role="alert">
          {problem}.
        </p>
      ) : null}
      {data.warnings.map((w) => (
        <p className="sub tiers-warn" role="note" key={w}>
          {w}
        </p>
      ))}

      <div className="panel models-routing">
        <div className="panel-head">
          <h2>Routing</h2>
          <Seg aria-label={`Model routing for ${installTag(install)}`}>
            {ROUTING.map((r) => (
              <button
                key={r}
                type="button"
                className={routingNow === r ? 'on' : ''}
                aria-pressed={routingNow === r}
                onClick={() => {
                  setRouting(r === data.tiers ? null : r)
                  setSaved(false)
                }}
              >
                {r}
              </button>
            ))}
          </Seg>
        </div>
        <p className="panel-note">
          {routingNow === 'auto'
            ? 'Agents run on the model of their tier, unless you pin one. Applied at the next rebuild.'
            : 'Every agent runs on your session model, unless you pin one.'}
          {routing !== null ? ' Not rebuilt yet.' : ''}
        </p>
      </div>

      <div className="panel models-tiers" role="group" aria-label="Models by tier">
        <div className="panel-head">
          <h2>Tiers</h2>
        </div>
        <div className="models-tier-row">
          <span>Strong</span>
          <span className="dim">session model, always</span>
        </div>
        {TIERS.map(([t, title]) => {
          const v = tierValue(t)
          return (
            <div className="models-tier-row" key={t}>
              <span>{title}</span>
              <button
                type="button"
                className="btn ghost sm models-model"
                disabled={!!problem || busy}
                aria-label={`${title} tier model: ${nameOf(v)}. Change`}
                onClick={() => setPicking({ kind: 'tier', key: t })}
              >
                {nameOf(v)}
              </button>
              {mark(v)}
              {hasTier(t) ? <span className="tag acc">unsaved</span> : null}
            </div>
          )
        })}
        <p className="panel-note">
          {Object.keys(data.defaults || {}).length
            ? `Host defaults: ${Object.entries(data.defaults)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ')}.`
            : `${label} has no default model for a tier: a tier routes once you pick one.`}
        </p>
      </div>

      <div className="panel flush models-agents">
        <table className="ldg" aria-label="Agents">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col" aria-sort={sort ? 'ascending' : 'none'}>
                <button type="button" className="btn ghost sm" onClick={() => setSort((s) => !s)}>
                  Tier{sort ? ' ▲' : ''}
                </button>
              </th>
              <th scope="col">Runs on</th>
              <th scope="col">Because</th>
              <th scope="col">Pin</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const pin = pinValue(a)
              return (
                <tr key={a.name}>
                  <td className="mono">{a.name}</td>
                  <td>
                    {a.tier ? (
                      <span className={`tag ${TIER_TONE[a.tier] ?? ''}`}>{a.tier}</span>
                    ) : (
                      <span className="tag" title="No Geneseed source: not tiered">
                        not tiered
                      </span>
                    )}
                  </td>
                  <td className="mono">
                    {a.model ? nameOf(a.model) : <span className="dim">session model</span>}
                  </td>
                  <td className="dim">{becauseOf(a.from, data.tiers)}</td>
                  <td>
                    <span className="row gap-8 wrap">
                      <button
                        type="button"
                        className="btn ghost sm models-model"
                        disabled={!!problem || busy}
                        aria-label={`Pin a model for ${a.name}`}
                        onClick={() => setPicking({ kind: 'pin', key: a.name })}
                      >
                        {pin ? nameOf(pin) : 'No pin'}
                      </button>
                      {pin ? mark(pin) : null}
                      {pinDraft[a.name] !== undefined ? (
                        <span className="tag acc">unsaved</span>
                      ) : null}
                      {pin ? (
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={!!problem || busy}
                          aria-label={`Clear the pin of ${a.name}`}
                          onClick={() => {
                            setPinDraft((d) => ({ ...d, [a.name]: null }))
                            setSaved(false)
                          }}
                        >
                          Clear
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="models-foot row gap-8 wrap">
        <span className="sub" role="status">
          {changes
            ? `${changes} unsaved change${changes === 1 ? '' : 's'}`
            : saved
              ? 'Saved. The agent files change at the next rebuild.'
              : 'No unsaved changes.'}
        </span>
        <button
          type="button"
          className="btn"
          disabled={!changes || !!problem || busy}
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={changes > 0 || busy}
          onClick={rebuild}
        >
          Rebuild…
        </button>
      </div>

      <ModelPicker
        key={picking ? `${picking.kind}:${picking.key}` : 'closed'}
        open={!!picking}
        title={
          picking
            ? picking.kind === 'tier'
              ? `${picking.key} tier model`
              : `Model for ${picking.key}`
            : ''
        }
        data={data}
        current={current}
        onPick={choose}
        onClose={() => setPicking(null)}
      />
    </div>
  )
}
