// Docs surface: the menu (groups + pages) and one page at a time. The page
// payload's `kind` decides how the frontend renders it (markdown, cli, specs,
// glossary, about, concept) — see rituals/web.py:api_docs_page.
import { get } from './http.js'

// `harness` ('opencode' | 'claude') filters the menu and strips the other
// host's inline blocks server-side. Omitted → server uses the installed default.
const hq = (harness) => (harness ? `?harness=${encodeURIComponent(harness)}` : '')

export const docs = (harness) => get(`/api/docs${hq(harness)}`)
export const docsPage = (id, harness) =>
  get(`/api/docs/page/${encodeURIComponent(id)}${hq(harness)}`)
