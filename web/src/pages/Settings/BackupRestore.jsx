import React, { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import { api } from '../../api/index.js'
import { useConfirm } from '../../hooks/useConfirm.jsx'
import { relTime } from '../../lib/format.js'
import { Row, Section } from './sheet.jsx'

const kb = (bytes) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

// One read of a folder's backups, as `{ folder, files }` or `{ error }`; null when the api has no
// such call (suites stub it down to the calls they make). A 409 carries the server's own text.
const readBackups = (want) =>
  Promise.resolve(api.backupsList?.(want))
    .then((r) => (r?.ok === false ? { error: r.error } : (r ?? null)))
    .catch((e) => ({ error: e.body?.error ?? e.message }))

// A backup is one .zip in a folder on this machine: nothing is uploaded. Create, Preview and
// Restore start the CLI's own `backup` and `restore` as jobs, and their output opens in the job
// console. Preview is the restore's dry run, so it asks nothing; Restore names the file and asks.
export default function BackupRestore({ onAction }) {
  const confirm = useConfirm()
  const [folder, setFolder] = useState('')
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const show = useCallback((r) => {
    if (!r) return
    setError(r.error ?? null)
    if (r.error) return
    setFolder(r.folder)
    setFiles(r.files)
  }, [])
  const load = (want) => readBackups(want).then(show)
  useEffect(() => {
    let live = true
    readBackups('').then((r) => live && show(r))
    return () => {
      live = false
    }
  }, [show])

  const choose = async () => {
    setBusy(true)
    try {
      const r = await api.pickFolder()
      if (r.path) await load(r.path)
      else if (r.error) setError(r.error)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const create = async () => {
    await onAction('backup', { folder })
  }
  const restore = async (f) => {
    const ok = await confirm(
      `Restore ${f.name} on this machine? Nothing of yours is overwritten: a file that differs lands beside it as <name>-restored, ` +
        'and each recorded install is rebuilt with geneseed profile apply.',
      { title: 'Restore this backup?', confirmLabel: 'Restore' },
    )
    if (ok) await onAction('backup-restore', { file: f.path })
  }

  return (
    <Section id="backup" title="Backup & restore">
      <Row
        k="Folder"
        help="Where backups are written and listed"
        control={
          <>
            <button className="btn ghost" disabled={busy} onClick={choose}>
              Choose…
            </button>
            <button className="btn ghost" onClick={() => load(folder)}>
              Refresh
            </button>
          </>
        }
      >
        <span className="mono">{folder || '…'}</span>
        <ErrorState error={error} />
      </Row>
      <Row
        k="Back up"
        help="Your rules, profile, memory, notes and own skills, in one .zip"
        control={
          <button className="btn ghost" disabled={!folder} onClick={create}>
            <Icon name="download" />
            Create backup
          </button>
        }
      >
        <span className="sub">
          A plain copy of your own files: keep it where only you can read it.
        </span>
      </Row>
      {files.length === 0 ? (
        <Row k="Restore">
          <span className="sub">No geneseed-backup-*.zip in this folder.</span>
        </Row>
      ) : (
        files.map((f) => (
          <Row
            key={f.path}
            k="Backup file"
            help={`${kb(f.size)} · ${relTime(f.mtime)} ago`}
            control={
              <>
                <button
                  className="btn ghost"
                  onClick={() => onAction('backup-restore', { file: f.path, dryRun: true })}
                >
                  Preview
                </button>
                <button className="btn ghost" onClick={() => restore(f)}>
                  Restore
                </button>
              </>
            }
          >
            <span className="mono">{f.name}</span>
          </Row>
        ))
      )}
    </Section>
  )
}
