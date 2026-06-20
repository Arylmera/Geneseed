// Long-running actions and their job lifecycle. `action` kicks off a named
// action (build, update, doctor, export, …) and returns { job_id }; the others
// poll, list, and cancel. opts (e.g. { theme, emit } for build) ride in the body.
import { get, post } from './http.js'

const HTTP_CONFLICT = 409 // server is busy with another single-flight action

export const job = (id) => get(`/api/jobs/${id}`)
export const jobs = () => get('/api/jobs')
export const cancelJob = (id) => post(`/api/jobs/${id}/cancel`)

export async function action(name, opts) {
  try {
    return await post(`/api/actions/${name}`, opts || {})
  } catch (e) {
    if (e.status === HTTP_CONFLICT) throw new Error('An action is already running.')
    throw e
  }
}
