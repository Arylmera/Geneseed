// Library browsing: list a section's items, read one rendered item, or delete a
// memory fact (which also drops it from the MEMORY.md index server-side).
import { get, post } from './http.js'

export const catalog = (section) => get(`/api/catalog/${section}`)
export const item = (type, name) => get(`/api/item/${type}/${encodeURIComponent(name)}`)
export const memoryDelete = (name) => post('/api/memory/delete', { name })
