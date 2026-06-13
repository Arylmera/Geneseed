// Library browsing: list a section's items, or read one rendered item.
import { get } from './http.js'

export const catalog = (section) => get(`/api/catalog/${section}`)
export const item = (type, name) => get(`/api/item/${type}/${encodeURIComponent(name)}`)
