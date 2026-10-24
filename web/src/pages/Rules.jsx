import React, { useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { useFileEditor } from '../hooks/useFileEditor.js'

// Rules — the user's own standing rules (user-rules.md beside the deployed
// AGENT.md). The page is the curation surface for the file the agent obeys
// alongside the Laws: list with status/scope chips, add/edit/retire, and the
// budget meter that keeps the set lean (a bloated rule set is ignored, not
// obeyed — Design decision 7). Every mutation carries the fingerprint of the
// content we last read; a 409 means an agent session edited the file first,
// and we reload instead of clobbering its write. The open form is a useFileEditor
// draft, so a reload never wipes it and leaving with it unsaved asks first.

const EMPTY_FORM = { title: '', body: '', scope: 'project', trial_until: '' }

// The scopes the rule skill documents. A hand-written other one (`team`, say) is offered as
// its own option: without it the controlled <select> shows "project" over a rule that is not.
const SCOPES = ['project', 'user', 'global']

// The server's rule too (`isRuleEdge`, user-files.mjs): a body line starting `## ` would end
// this rule's block in user-rules.md and could forge another rule. Checked here so the user
// sees why before anything is sent.
// Same line breaks as the server's `splitLines` (js/lib/udiff.mjs); the server stays the authority.
// eslint-disable-next-line no-control-regex
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/
const isRuleEdge = (l) => l.startsWith('## ') || /^##\s+R\d+\s*[—–-]+\s*\S/.test(l)

// The 409 notices: a draft save keeps the draft; a delete/graduate has none to keep.
const DRAFT_CONFLICT =
  'user-rules.md changed on disk (an agent session?) — reloaded the fresh copy. ' +
  'Your draft is kept — Save again.'
const RETRY_CONFLICT =
  'user-rules.md changed on disk (an agent session?) — reloaded the fresh copy. Try again.'

// Controlled: the form's state is the page's draft, which outlives a reload.
function RuleForm({ value: f, onChange, onCancel, onSave, busy }) {
  // The scope as opened: a hand-written one stays offered even after the user picks another.
  const [scope0] = useState(f.scope)
  const set = (k) => (e) => onChange({ ...f, [k]: e.target.value })
  const bodyError = f.body.trim().split(LINE_BREAK).some(isRuleEdge)
    ? 'A line cannot start with “## ” — user-rules.md reads it as a new rule heading. Use ### or plain text.'
    : ''
  const valid = f.title.trim() && f.body.trim() && !bodyError
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
        aria-invalid={bodyError ? true : undefined}
        aria-describedby={bodyError ? 'rule-body-error' : undefined}
      />
      {bodyError ? (
        <p id="rule-body-error" className="sub rule-notice" role="alert">
          {bodyError}
        </p>
      ) : null}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select className="sel" value={f.scope} onChange={set('scope')} aria-label="Rule scope">
          <option value="project">scope: project (this repo, committable)</option>
          <option value="user">scope: user (personal)</option>
          <option value="global">scope: global (every repository)</option>
          {SCOPES.includes(scope0) ? null : (
            <option value={scope0}>scope: {scope0} (as written in the file)</option>
          )}
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

export default function Rules({ onChanged }) {
  const confirm = useConfirm()
  const [rev, setRev] = useState(0)
  const { data, error } = useAsync(() => api.rules(), [rev])
  const [open, setOpen] = useState(null)
  const reload = () => setRev((v) => v + 1)
  // draft: { target: 'new' | rule id, title0: the rule's title when opened, form }
  const editor = useFileEditor({ data, reload })
  const { draft, busy, notice } = editor

  if (error) return <ErrorState error={error} />
  if (!data) return <Loading />

  const rules = data.rules || []
  const { stats } = data
  // The meter reads whichever budget is closer to spent — count or tokens.
  const pct = Math.round(
    Math.max(stats.rules / stats.max_rules, stats.tokens / stats.max_tokens) * 100,
  )
  const meterClass = pct >= 100 ? 'over' : pct >= 70 ? 'warn' : ''

  // A draft's rule is GONE when no rule has both its id and the title it had when opened:
  // after a renumber the id names a different rule, and an update would overwrite that one.
  const target = draft?.target
  const gone =
    target !== undefined &&
    target !== 'new' &&
    !rules.some((r) => r.id === target && r.title === draft.title0)
  const newCard = target === 'new' || gone

  const mutate = async (body, fromDraft) => {
    const res = await editor.save((fp) => api.rulesMutate({ ...body, fingerprint: fp }), {
      conflict: fromDraft ? DRAFT_CONFLICT : RETRY_CONFLICT,
    })
    if (res && fromDraft) editor.close()
    onChanged?.()
  }
  const setForm = (form) => editor.setDraft({ ...draft, form })

  const onDelete = async (r) => {
    const ok = await confirm(
      `Retire rule R${r.id} — “${r.title}”? It is removed from user-rules.md.`,
      {
        title: 'Retire this rule?',
        confirmLabel: 'Retire',
        tone: 'danger',
      },
    )
    if (!ok) return
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
          <h2 className="h">Rules</h2>
          <p className="sub">
            Your own standing rules, from <code className="mono">user-rules.md</code> beside the
            deployed AGENT.md. The agent obeys them with the same force as the Laws — they may
            tighten a Law, never repeal one — and no update ever touches the file. Keep the set
            small: every rule is loaded every session.
          </p>
        </div>
        {data.exists && draft === null && (
          <button
            className="btn"
            onClick={() => editor.open({ target: 'new', title0: '', form: EMPTY_FORM })}
          >
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

      {newCard && (
        <div className="card pad-lg mb-16">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            new rule
          </div>
          {gone ? (
            <p className="sub rule-notice">
              Rule R{target} is no longer in user-rules.md (an agent session removed or renumbered
              it). Your draft is kept — Save adds it as a new rule.
            </p>
          ) : null}
          <RuleForm
            value={draft.form}
            onChange={setForm}
            busy={busy}
            onCancel={editor.discard}
            onSave={(f) => mutate({ op: 'add', ...f }, true)}
          />
        </div>
      )}

      {!data.exists ? (
        <div className="empty" style={{ padding: 48 }}>
          <div className="big">No user-rules.md here yet</div>
          The build seeds it beside AGENT.md — run a build/update from the Dashboard (or{' '}
          <code className="mono">geneseed update</code>) and it appears, ready for your rules.
        </div>
      ) : rules.length === 0 && !newCard ? (
        <div className="empty" style={{ padding: 48 }}>
          <div className="big">No rules yet</div>
          The file is seeded and loaded every session — it is just empty. Add your first standing
          rule here, ask the agent for one in-session (the rule skill), or promote a recurring
          memory fact from the Library.
        </div>
      ) : (
        <div className="card rules-list">
          {rules.map((r) =>
            !gone && target === r.id ? (
              <div className="rule-row on" key={r.id}>
                <div className="rule-expand" style={{ paddingTop: 14 }}>
                  <RuleForm
                    value={draft.form}
                    onChange={setForm}
                    busy={busy}
                    onCancel={editor.discard}
                    onSave={(f) => mutate({ op: 'update', id: r.id, source: r.source, ...f }, true)}
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
                  editor.open({
                    target: r.id,
                    title0: r.title,
                    form: {
                      title: r.title,
                      body: r.body,
                      scope: r.scope,
                      trial_until: r.trial_until,
                    },
                  })
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
