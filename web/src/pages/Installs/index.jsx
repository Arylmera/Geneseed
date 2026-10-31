import React from 'react'
import Tabs from '../../components/Tabs.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { driftTotal } from '../../lib/format.js'
import Hosts from './Hosts.jsx'
import Kits from './Kits.jsx'
import Diff from '../Diff.jsx'
import Doctor from '../Doctor.jsx'
import Settings from '../Settings/index.jsx'

// Installs: where the harness lives on this machine and how each copy is kept. Five tabs:
// Hosts (the old Harness page), Kits (which optional kits each install carries), Local edits (Changes), Doctor,
// and Server (Settings: appearance, maintenance, server control, about). The old flat
// routes land on their tab (lib/router.js VIEW_ALIAS).
export default function Installs({
  tab = 'hosts',
  overview,
  setup,
  themes,
  onAction,
  onMutated,
  dataRev,
  appearance = {},
}) {
  const d = overview?.doctor
  const diff = overview?.diff
  const badges = {
    edits: diff ? driftTotal(diff) : null,
    doctor: !d ? null : d.ok ? 'clean' : d.problems.length,
  }
  return (
    <>
      {/* No primary here: each tab holds its own one filled action, under its own h2. */}
      <PageHeader
        title="Installs"
        sub="Where the harness lives on this machine, and how each copy is built."
      />
      <Tabs page="installs" current={tab} badges={badges} label="Installs" />
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
      {tab === 'kits' && <Kits onAction={onAction} dataRev={dataRev} />}
      {tab === 'edits' && (
        <Diff onMutated={onMutated} onAction={onAction} dataRev={dataRev} overview={overview} />
      )}
      {tab === 'doctor' && <Doctor dataRev={dataRev} />}
      {tab === 'server' && (
        <Settings overview={overview} onAction={onAction} dataRev={dataRev} {...appearance} />
      )}
    </>
  )
}
