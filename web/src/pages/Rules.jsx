import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'

// Rules — the user's own standing rules (user-rules.md beside the deployed
// AGENT.md). The page is the curation surface for the file the agent obeys
// alongside the Laws: list with status/scope chips, add/edit/retire, and the
// budget meter that keeps the set lean (a bloated rule set is ignored, not
// obeyed — Design decision 7). Every mutation carries the fingerprint of the
// content we last read; a 409 means an agent session edited the file first,
// and we reload instead of clobbering its write.

const EMPTY_FORM = { title: '', body: '', scope: 'project', trial_until: '' }

function RuleForm({ initial, onCancel, onSave, busy }) {
  const [f, setF] = useState(initial)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const valid = f.title.trim() && f.body.trim()
  return (
    <div className="rule-form">
      <input
        className="lib-filter"
        type="text"
        value={f.title}
        onChange={set('title')}
        placeholder="Title — short and imperative (e.g. No emoji in commit subjects)"
        aria-label="Rule title"
      />
      <textarea
        className="rule-body-input"
        value={f.body}
        onChange={set('body')}
        rows={4}
        placeholder="The rule, stated plainly and testably, in one short paragraph."
        aria-label="Rule body"
      />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select className="sel" value={f.scope} onChange={set('scope')} aria-label="Rule scope">
          <option value="project">scope: project (this repo, committable)</option>
          <option value="user">scope: user (personal)</option>
        </select>
        <label className="rule-trial-label">
          trial until
          <input
            className="lib-filter rule-date"
            type="date"
            value={f.trial_until}
            onChange={set('trial_until')}
            aria-label="Trial until date (optional)"
          />
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn sm" disabled={!valid || busy} onClick={() => onSave(f)}>
            {busy ? 'Saving…' : 'Save rule'}
          </button>
          <button className="btn ghost sm" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function RuleRow({ rule, isOpen, onToggle, onEdit, onDelete, onGraduate }) {
  return (
    <div className={`rule-row ${isOpen ? 'on' : ''}`}>
      <button className="rule-head" onClick={onToggle} aria-expanded={isOpen}>
        <span className="rule-no">R{rule.id}</span>
        <span className="rule-title">{rule.title}</span>
        <span className={`rule-chip ${rule.scope === 'user' ? 'user' : ''}`}>{rule.scope}</span>
        {rule.status === 'trial' && (
          <span className={`rule-chip trial ${rule.overdue ? 'overdue' : ''}`}>
            {rule.overdue ? 'review due' : `trial · ${rule.trial_until}`}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="rule-expand">
          <p>{rule.body}</p>
          {rule.source ? <div className="rule-src">source: {rule.source}</div> : null}
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            {rule.status === 'trial' && (
              <button
                className="btn sm"
                onClick={onGraduate}
                title="Adopt for good — drop the trial marker"
              >
                Graduate
              </button>
            )}
            <button className="btn ghost sm" onClick={onEdit}>
              Edit
            </button>
            <button className="btn ghost sm" onClick={onDelete}>
              Retire
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Rules() {
  const [rev, setRev] = useState(0)
  const { data, error } = useAsync(() => api.rules(), [rev])
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null) // 'new' | rule id | null
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const reload = () => setRev((v) => v + 1)

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const rules = data.rules || []
  const { stats } = data
  // The meter reads whichever budget is closer to spent — count or tokens.
  const pct = Math.round(
    Math.max(stats.rules / stats.max_rules, stats.tokens / stats.max_tokens) * 100,
  )
  const meterClass = pct >= 100 ? 'over' : pct >= 70 ? 'warn' : ''

  const mutate = async (body) => {
    setBusy(true)
    setNotice('')
    try {
      await api.rulesMutate({ ...body, fingerprint: data.fingerprint })
      setEditing(null)
    } catch (e) {
      setNotice(
        e.status === 409
          ? 'user-rules.md changed on disk (an agent session?) — reloaded the fresh copy; re-apply your edit.'
          : e.message,
      )
    } finally {
      setBusy(false)
      reload()
    }
  }

  const onDelete = (r) => {
    if (!window.confirm(`Retire rule R${r.id} — “${r.title}”? It is removed from user-rules.md.`))
      return
    mutate({ op: 'delete', id: r.id })
  }
  // Graduate = same rule, trial marker dropped (adopted for good).
  const onGraduate = (r) =>
    mutate({
      op: 'update',
      id: r.id,
      title: r.title,
      body: r.body,
      scope: r.scope,
      source: r.source,
      trial_until: '',
    })

  return (
    <>
      <div className="head-row mb-16">
        <div>
          <div className="eyebrow">governance · yours</div>
          <h1 className="h">Rules</h1>
          <p className="sub">
            Your own standing rules, from <code className="mono">user-rules.md</code> beside the
            deployed AGENT.md. The agent obeys them with the same force as the Laws — they may
            tighten a Law, never repeal one — and no update ever touches the file. Keep the set
            small: every rule is loaded every session.
          </p>
        </div>
        {data.exists && editing === null && (
          <button className="btn" onClick={() => setEditing('new')}>
            Add rule
          </button>
        )}
      </div>

      {data.exists && (
        <div className={`rules-meter ${meterClass}`}>
          <div className="rules-meter-bar">
            <div className="rules-meter-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className="rules-meter-label">
            {stats.rules}/{stats.max_rules} rules · ~{stats.tokens} tokens
            {pct >= 100
              ? ' — over budget: a bloated rule set dilutes the rules that matter'
              : pct >= 70
                ? ' — getting heavy; consider merging or pruning'
                : ''}
          </span>
        </div>
      )}

      {notice ? <p className="sub rule-notice">{notice}</p> : null}
      {(data.warnings || []).map((w) => (
        <p key={w} className="sub rule-notice">
          format warning: {w}
        </p>
      ))}

      {editing === 'new' && (
        <div className="card pad-lg mb-16">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            new rule
          </div>
          <RuleForm
            initial={EMPTY_FORM}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(f) => mutate({ op: 'add', ...f })}
          />
        </div>
      )}

      {!data.exists ? (
        <div className="empty" style={{ padding: 48 }}>
          <div className="big">No user-rules.md here yet</div>
          The build seeds it beside AGENT.md — run a build/update from the Dashboard (or{' '}
          <code className="mono">geneseed update</code>) and it appears, ready for your rules.
        </div>
      ) : rules.length === 0 && editing !== 'new' ? (
        <div className="empty" style={{ padding: 48 }}>
          <div className="big">No rules yet</div>
          The file is seeded and loaded every session — it is just empty. Add your first standing
          rule here, ask the agent for one in-session (the rule skill), or promote a recurring
          memory fact from the Library.
        </div>
      ) : (
        <div className="card rules-list">
          {rules.map((r) =>
            editing === r.id ? (
              <div className="rule-row on" key={r.id}>
                <div className="rule-expand" style={{ paddingTop: 14 }}>
                  <RuleForm
                    initial={{
                      title: r.title,
                      body: r.body,
                      scope: r.scope,
                      trial_until: r.trial_until,
                    }}
                    busy={busy}
                    onCancel={() => setEditing(null)}
                    onSave={(f) => mutate({ op: 'update', id: r.id, source: r.source, ...f })}
                  />
                </div>
              </div>
            ) : (
              <RuleRow
                key={r.id}
                rule={r}
                isOpen={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
                onEdit={() => {
                  setOpen(r.id)
                  setEditing(r.id)
                }}
                onDelete={() => onDelete(r)}
                onGraduate={() => onGraduate(r)}
              />
            ),
          )}
        </div>
      )}
    </>
  )
}
