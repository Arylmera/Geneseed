// Read-only status surface: the dashboards' overview, the install snapshot,
// doctor results, the theme/voice catalogue, and the cross-link graph.
import { get } from './http.js'

export const overview = () => get('/api/overview')
export const setup = () => get('/api/setup')
export const doctor = () => get('/api/doctor')
export const themes = () => get('/api/themes')
export const graph = () => get('/api/graph')
