import React, { useCallback, useEffect, useRef, useState } from 'react'
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

// One read of a folder's backups, as `{ folder, projects, files }` or `{ error }`; null when the api has no
// such call (suites stub it down to the calls they make). A 409 carries the server's own text.
const readBackups = (want) =>
  Promise.resolve(api.backupsList?.(want))
    .then((r) => (r?.ok === false ? { error: r.error } : (r ?? null)))
    .catch((e) => ({ error: e.body?.error ?? e.message }))

// A backup is one .zip in a folder on this machine: nothing is uploaded. Create, Preview and
// Restore start the CLI's own `backup` and `restore` as jobs, and their output opens in the job
// console. Preview is the restore's dry run, so it asks nothing; Restore names the file and asks.
// `dataRev` moves when a job ends: a backup just made is listed without a Refresh.
export default function BackupRestore({ onAction, dataRev }) {
  const confirm = useConfirm()
  const [folder, setFolder] = useState('')
  const shown = useRef('') // the folder the card shows, for the re-read a finished job starts
  const [files, setFiles] = useState([])
  const [chosen, setChosen] = useState(null)
  const projects = chosen ?? []
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const show = useCallback((r) => {
    if (!r) return
    setError(r.error ?? null)
    if (r.error) return
    shown.current = r.folder
    setFolder(r.folder)
    setFiles(r.files)
    // Kept from the first read that worked: from then on the card holds the choice, and a backup
    // saves it. Never from a failed one, or the next backup would forget the remembered folders.
    setChosen((now) => now ?? r.projects ?? [])
  }, [])
  const load = (want) => readBackups(want).then(show)
  useEffect(() => {
    let live = true
    readBackups(shown.current).then((r) => live && show(r))
    return () => {
      live = false
    }
  }, [show, dataRev])

  const pick = async (then) => {
    setBusy(true)
    try {
      const r = await api.pickFolder()
      if (r.path) await then(r.path)
      else if (r.error) setError(r.error)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const addProject = (p) => setChosen(projects.includes(p) ? projects : [...projects, p])
  const create = async () => {
    await onAction('backup', { folder, projects })
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
          <div className="row wrap gap-10">
            <button className="btn ghost" disabled={busy} onClick={() => pick(load)}>
              Choose…
            </button>
            <button className="btn ghost" onClick={() => load(folder)}>
              Refresh
            </button>
          </div>
        }
      >
        <span className="mono">{folder || '…'}</span>
        <ErrorState error={error} />
      </Row>
      <Row
        k="Projects"
        help="Scanned for the memory, notebook, rules and profile git does not track"
        control={
          <button className="btn ghost" disabled={busy} onClick={() => pick(addProject)}>
            Add folder…
          </button>
        }
      >
        {projects.length === 0 ? (
          <span className="sub">No folder scanned: what your projects hold stays behind.</span>
        ) : (
          projects.map((p) => (
            <div key={p} className="row wrap gap-10">
              <span className="mono">{p}</span>
              <button
                className="btn ghost"
                aria-label={`Remove ${p}`}
                onClick={() => setChosen(projects.filter((x) => x !== p))}
              >
                Remove
              </button>
            </div>
          ))
        )}
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
              <div className="row wrap gap-10">
                <button
                  className="btn ghost"
                  onClick={() => onAction('backup-restore', { file: f.path, dryRun: true })}
                >
                  Preview
                </button>
                <button className="btn ghost" onClick={() => restore(f)}>
                  Restore
                </button>
              </div>
            }
          >
            <span className="mono">{f.name}</span>
          </Row>
        ))
      )}
    </Section>
  )
}
