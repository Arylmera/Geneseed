// Read-only status surface: the dashboards' overview, the install snapshot,
// doctor results, the theme/voice catalogue, and the cross-link graph. (Plus the
// one live-activity mutation — flipping its on/off toggle.)
import { get, post } from './http.js'

export const overview = () => get('/api/overview')
// The newest file-backed entries across the harness. Its own endpoint rather than a field on
// the overview: it stats every candidate file, which the overview (fetched on every mutation)
// has no business paying for.
export const recent = () => get('/api/recent')
export const activity = () => get('/api/activity')
export const activityDetail = (sid) => get('/api/activity/' + encodeURIComponent(sid))
export const activityToggle = (enabled) => post('/api/activity', { enabled })
export const setup = () => get('/api/setup')
export const doctor = () => get('/api/doctor')
export const themes = () => get('/api/themes')
export const graph = () => get('/api/graph')
