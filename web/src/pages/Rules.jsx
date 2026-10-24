import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import Loading from '../components/Loading.jsx'
import ErrorState from '../components/ErrorState.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { useFileEditor } from '../hooks/useFileEditor.js'

// Rules — the user's own standing rules (user-rules.md beside the deployed
// AGENT.md). The page is the curation surface for the file the agent obeys
// alongside the Laws: list with status/scope chips and add/edit/retire. The
// budget that keeps the set lean (a bloated rule set is ignored, not obeyed —
// Design decision 7) is Personal's "Rule budget" panel, above. Every mutation carries the fingerprint of the
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
  const missing = !(f.title.trim() && f.body.trim())
  const valid = !missing && !bodyError
  return (
    <div className="rule-form">
      <label className="field">
        <span>Rule title</span>
        <input
          className="lib-filter"
          type="text"
          value={f.title}
          onChange={set('title')}
          placeholder="Title — short and imperative (e.g. No emoji in commit subjects)"
          autoFocus
        />
      </label>
      <label className="field">
        <span>Rule body</span>
        <textarea
          className="rule-body-input"
          value={f.body}
          onChange={set('body')}
          rows={4}
          placeholder="The rule, stated plainly and testably, in one short paragraph."
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? 'rule-body-error' : undefined}
        />
      </label>
      {bodyError ? (
        <p id="rule-body-error" className="sub rule-notice" role="alert">
          {bodyError}
        </p>
      ) : null}
      <div className="row wrap">
        <label className="field">
          <span>Rule scope</span>
          <select className="sel" value={f.scope} onChange={set('scope')}>
            <option value="project">scope: project (this repo, committable)</option>
            <option value="user">scope: user (personal)</option>
            <option value="global">scope: global (every repository)</option>
            {SCOPES.includes(scope0) ? null : (
              <option value={scope0}>scope: {scope0} (as written in the file)</option>
            )}
          </select>
        </label>
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
        <div className="row gap-8" style={{ marginLeft: 'auto' }}>
          <button
            className="btn sm"
            disabled={!valid || busy}
            onClick={() => onSave(f)}
            aria-describedby={missing ? 'rule-form-hint' : undefined}
          >
            {busy ? 'Saving…' : 'Save rule'}
          </button>
          <button className="btn ghost sm" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      {missing ? (
        <p id="rule-form-hint" className="panel-note">
          A rule needs a title and a body.
        </p>
      ) : null}
    </div>
  )
}

function RuleRow({ rule, isOpen, onToggle, onEdit, onDelete, onGraduate }) {
  return (
    <div className={`rule-row ${isOpen ? 'on' : ''}`}>
      <button
        className="rule-head"
        onClick={onToggle}
        aria-expanded={isOpen}
        data-rule-head={rule.id}
      >
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
          <div className="row gap-8" style={{ marginTop: 10 }}>
            {rule.status === 'trial' && (
              <button
                className="btn ghost sm"
                onClick={onGraduate}
                title="Adopt for good — drop the trial marker"
                aria-label={`Graduate R${rule.id}`}
              >
                Graduate
              </button>
            )}
            <button className="btn ghost sm" onClick={onEdit} aria-label={`Edit R${rule.id}`}>
              Edit
            </button>
            <button className="btn ghost sm" onClick={onDelete} aria-label={`Retire R${rule.id}`}>
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
  // Where focus goes once the act has re-rendered: 'add' (the Add rule button) or a rule id
  // (that rule's row head). A closed form unmounts the element that had focus, which would
  // drop it on <body>; the target exists only after the render, hence the effect. The target
  // is a ref, taken once (one attempt: a target missing now must not steal focus later); the
  // tick only asks for the render, so the effect never sets state.
  const focusTo = useRef(null)
  const [focusTick, setFocusTick] = useState(0)
  const setFocusTo = (to) => {
    focusTo.current = to
    setFocusTick((n) => n + 1)
  }
  const addRef = useRef(null)
  const listRef = useRef(null)
  useEffect(() => {
    const to = focusTo.current
    focusTo.current = null
    if (to === null) return
    const el =
      to === 'add' ? addRef.current : listRef.current?.querySelector(`[data-rule-head="${to}"]`)
    el?.focus()
  }, [focusTick])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Loading />

  const rules = data.rules || []

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
    return res
  }
  const setForm = (form) => editor.setDraft({ ...draft, form })
  // A refused save keeps the form open, and focus with it.
  const saveThen = async (body, to) => {
    if (await mutate(body, true)) setFocusTo(to)
  }
  const cancelThen = async (to) => {
    if (await editor.discard()) setFocusTo(to)
  }

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
    // With a draft open there is no Add rule button to land on.
    if ((await mutate({ op: 'delete', id: r.id })) && draft === null) setFocusTo('add')
  }
  // Graduate = same rule, trial marker dropped (adopted for good).
  const onGraduate = async (r) => {
    const res = await mutate({
      op: 'update',
      id: r.id,
      title: r.title,
      body: r.body,
      scope: r.scope,
      source: r.source,
      trial_until: '',
    })
    if (res) setFocusTo(r.id)
  }

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
            ref={addRef}
            onClick={() => editor.open({ target: 'new', title0: '', form: EMPTY_FORM })}
          >
            Add rule
          </button>
        )}
      </div>

      {notice ? (
        <p className="sub rule-notice" role="status">
          {notice}
        </p>
      ) : null}
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
            <p className="sub rule-notice" role="status">
              Rule R{target} is no longer in user-rules.md (an agent session removed or renumbered
              it). Your draft is kept — Save adds it as a new rule.
            </p>
          ) : null}
          <RuleForm
            value={draft.form}
            onChange={setForm}
            busy={busy}
            onCancel={() => cancelThen('add')}
            onSave={(f) => saveThen({ op: 'add', ...f }, 'add')}
          />
        </div>
      )}

      {!data.exists ? (
        <EmptyState title="No user-rules.md here yet">
          The build seeds it beside AGENT.md — run a build/update from the Dashboard (or{' '}
          <code className="mono">geneseed update</code>) and it appears, ready for your rules.
        </EmptyState>
      ) : rules.length === 0 && !newCard ? (
        <EmptyState title="No rules yet">
          The file is seeded and loaded every session — it is just empty. Add your first standing
          rule here, ask the agent for one in-session (the rule skill), or promote a recurring
          memory fact from the Library.
        </EmptyState>
      ) : (
        <div className="card rules-list" ref={listRef}>
          {rules.map((r) =>
            !gone && target === r.id ? (
              <div className="rule-row on" key={r.id}>
                <div className="rule-expand" style={{ paddingTop: 14 }}>
                  <RuleForm
                    value={draft.form}
                    onChange={setForm}
                    busy={busy}
                    onCancel={() => cancelThen(r.id)}
                    onSave={(f) =>
                      saveThen({ op: 'update', id: r.id, source: r.source, ...f }, r.id)
                    }
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
