// Docs surface: the menu (groups + pages) and one page at a time. The page
// payload's `kind` decides how the frontend renders it (markdown, cli, specs,
// glossary, about, concept) — see rituals/web.py:api_docs_page.
import { get } from './http.js'

export const docs = () => get('/api/docs')
export const docsPage = (id) => get(`/api/docs/page/${encodeURIComponent(id)}`)

// Dated implementation specs — own rail entry, sibling to Docs under Learn.
// The detail view reuses docsPage('spec:<filename>') so the markdown pipeline
// stays single-sourced.
export const specs = () => get('/api/specs')
