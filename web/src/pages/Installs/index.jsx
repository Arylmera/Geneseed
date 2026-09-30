import React from 'react'
import Tabs from '../../components/Tabs.jsx'
import { editCount } from '../../lib/format.js'
import Hosts from './Hosts.jsx'
import Diff from '../Diff.jsx'
import Doctor from '../Doctor.jsx'
import Settings from '../Settings/index.jsx'

// Installs: where the harness lives on this machine and how each copy is kept. Four tabs,
// each the page it replaced: Hosts (the old Harness page), Local edits (Changes), Doctor,
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
    edits: diff ? editCount(diff) + (diff.missing ?? 0) : null,
    doctor: !d ? null : d.ok ? 'clean' : d.problems.length,
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h">Installs</h1>
          <p className="sub">
            Where the harness lives on this machine, and how each copy is built.
          </p>
        </div>
      </div>
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
      {tab === 'edits' && <Diff onMutated={onMutated} onAction={onAction} dataRev={dataRev} />}
      {tab === 'doctor' && <Doctor />}
      {tab === 'server' && <Settings overview={overview} onAction={onAction} {...appearance} />}
    </>
  )
}
