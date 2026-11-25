import React from 'react'
import { api } from '../api/index.js'
import { useAsync } from '../hooks/useAsync.js'
import { useRules } from '../hooks/useRules.js'
import Tabs from '../components/Tabs.jsx'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Rules from './Rules.jsx'
import Profile from './Profile.jsx'
import Library from './Library.jsx'
import { useInstalls } from '../hooks/useInstalls.js'

// The catalog lists entries only: a folder's index and README never reach it.
const countOf = (catalog) => (catalog ? (catalog.items || []).length : null)

const EMPTY = {
  notebook: {
    title: 'No notes yet',
    body: 'The notebook is the agent’s own scratch space: plans and notes it keeps for itself.',
  },
}

// Personal: the files that are yours alone and survive every update, reinstall and voice
// change. Rules and Profile are editors; Notebook is the Library reader locked to one kind, so
// an entry opened here keeps its address on this page. Memory was a tab here and is a page of
// its own now (pages/Memory.jsx): the old `#/personal/memory` addresses open it.
export default function Personal({ tab = 'rules', item, dataRev, onCountsChanged, onAction }) {
  const active = useInstalls(dataRev)
  // Each editor reloads only its own file after a write: the rules for the Overview and the
  // Constitution, which paint that copy, the profile for the tab's "template" badge. Not the
  // app-wide `dataRev`: neither file feeds the overview, the fleet or an install.
  const { reload: reloadRules } = useRules(dataRev)
  // Not soft: a failed read must not look like a profile with no template badge.
  const {
    data: profile,
    error: profileError,
    reload: reloadProfile,
  } = useAsync(() => api.profile(), [dataRev])
  // The same key and deps as Library's own read of the folder, so the count here and the pane
  // share one fetch. No `soft`: a cached null would be served to the pane's next mount.
  const { data: notebook } = useAsync(
    () => api.catalog('notebook'),
    ['notebook', dataRev],
    'catalog',
  )
  const notes = countOf(notebook)
  // No rules figure: each rules file heads its own list with its count and cost.
  const badges = {
    // The Profile tab itself says why, with a Retry; the badge only says the read failed.
    profile: profileError ? 'read failed' : profile?.seeded ? 'template' : null,
    notebook: notes,
  }
  const folder = tab === 'notebook'
  return (
    <>
      <PageHeader
        title="Personal"
        sub={
          'The only files you write. They survive updates, reinstalls and voice changes.' +
          (active?.some((i) => i.shared)
            ? ' Global installs share one copy of the rules and profile; a project install keeps its own.'
            : '')
        }
      />
      <Tabs page="personal" current={tab} badges={badges} label="Personal files" />
      {tab === 'rules' && <Rules onChanged={reloadRules} dataRev={dataRev} onAction={onAction} />}
      {tab === 'profile' && <Profile onChanged={reloadProfile} dataRev={dataRev} />}
      {folder && notes === 0 && !item ? (
        <EmptyState title={EMPTY[tab].title} action={EMPTY[tab].action}>
          {EMPTY[tab].body}
        </EmptyState>
      ) : folder ? (
        <Library
          key={tab}
          lock={tab}
          base={`#/personal/${tab}`}
          selected={item}
          dataRev={dataRev}
          onCountsChanged={onCountsChanged}
          onRulesChanged={reloadRules}
        />
      ) : null}
    </>
  )
}
