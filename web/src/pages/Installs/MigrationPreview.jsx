import React from 'react'
import { api } from '../../api/index.js'
import { useAsync } from '../../hooks/useAsync.js'
import Loading from '../../components/Loading.jsx'
import ErrorState from '../../components/ErrorState.jsx'

// What the next rebuild would do: the fold of each global install and the orphans, as
// `geneseed migrate --dry-run` reads them. Read-only, on the server too: nothing here writes.
// Mounted only while open, so each opening reads the tier as it stands.
export default function MigrationPreview({ dataRev }) {
  const { data, error, reload } = useAsync(() => api.migratePreview(), [dataRev])
  return (
    <section className="panel" aria-labelledby="preview-h">
      <div className="panel-head">
        <h2 id="preview-h">Next rebuild</h2>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          {data.folds.length ? (
            <ul className="preview-list">
              {data.folds.map((f) => (
                <li key={f.host}>
                  <b className="mono">{f.host}</b> {f.summary || 'nothing to fold'}
                  {f.failed.map((x) => (
                    <div key={x} className="t-warn">
                      The fold would stop at {x}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dim">No global install to fold.</p>
          )}
          {data.orphans.length ? (
            <>
              <h3>Orphans</h3>
              <p className="dim">
                No manifest owns these. An earlier build may have written them, or they may be
                yours. Nothing moves them: if one is not yours, move it by hand.
              </p>
              <ul className="preview-list mono">
                {data.orphans.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
