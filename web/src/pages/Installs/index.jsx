import React from 'react'
import Tabs from '../../components/Tabs.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import Hosts from './Hosts.jsx'
import Diff from '../Diff.jsx'
import Doctor from '../Doctor.jsx'

// Installs: where the harness lives on this machine and how each copy is kept. Three tabs: Hosts
// (the old Harness page), Local edits (Changes) and Doctor. The old flat routes land on their tab
// (lib/router.js VIEW_ALIAS), and the tabs that left, Kits and Server, on their pages.
export default function Installs({
  tab = 'hosts',
  overview,
  setup,
  themes,
  onAction,
  onMutated,
  dataRev,
}) {
  return (
    <>
      {/* No primary here: each tab holds its own one filled action, under its own h2. */}
      <PageHeader
        title="Installs"
        sub="Where the harness lives on this machine, and how each copy is built."
      />
      {/* No badges: each tab reads its own picked install, so no one figure stands for the tab. */}
      <Tabs page="installs" current={tab} label="Installs" />
      {tab === 'hosts' && (
        <Hosts
          onAction={onAction}
          themes={themes}
          currentTheme={overview?.theme}
          overview={overview}
          setup={setup}
          dataRev={dataRev}
          onMutated={onMutated}
        />
      )}
      {tab === 'edits' && (
        <Diff onMutated={onMutated} onAction={onAction} dataRev={dataRev} overview={overview} />
      )}
      {tab === 'doctor' && <Doctor dataRev={dataRev} />}
    </>
  )
}
