// Drift from source: read the deployed-vs-source diff, and restore (discard
// local edits for) selected files. Restore is synchronous — it returns
// { restored, deleted, errors }, not a job id.
import { get, post } from './http.js'

export const diff = () => get('/api/diff')
export const restore = (files) => post('/api/actions/restore', { files })
