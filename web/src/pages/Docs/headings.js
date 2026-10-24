import { renderMarkdown } from '../../components/Markdown.jsx'

// Slugify a heading title into a stable id we can also use as a CSS anchor.
// Always returns a value that is safe inside `id="..."` AND inside a CSS
// `#<id>` selector — never empty, never starting with a digit/dash. Headings
// can be unicode-heavy ("## 中文") or formatting-heavy ("## **Bold**"), and a
// fragile slug used to flow straight into querySelector — which is what threw
// "The string did not match the expected pattern" in WebKit.
export function slug(s, fallbackIdx = 0) {
  const cleaned = String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (cleaned && /^[a-z]/.test(cleaned)) return cleaned
  return `h-${fallbackIdx}-${cleaned || 'section'}`
}

// The body split around the map table: its rows are drawn as the list in its place, so the
// table would say everything twice. Only the table whose header opens on "Piece" goes; any
// other table in the prose stays. No map table → everything is "before".
export function splitAtMapTable(body) {
  const before = []
  const after = []
  let state = 'before'
  for (const ln of (body || '').split('\n')) {
    if (state === 'before' && /^\|\s*piece\s*\|/i.test(ln)) state = 'map'
    else if (state === 'map' && !ln.trimStart().startsWith('|')) state = 'after'
    if (state === 'before') before.push(ln)
    else if (state === 'after') after.push(ln)
  }
  return [before.join('\n'), after.join('\n')]
}

// Ids and the outline come from the RENDERED html, in one pass, so the page and the margin
// cannot disagree: the source of a heading holds link URLs and entities its text does not, and
// two headings with one title need two ids. `seen` (ids taken, heading count, outline) is shared
// across the parts of one page — a map page renders its prose in two pieces. Each table goes
// into a focusable scroll box, so a wide one scrolls by itself instead of stretching the page.
function addIds(html, seen) {
  const t = document.createElement('template')
  t.innerHTML = html
  t.content.querySelectorAll('h1, h2, h3').forEach((h) => {
    if (h.tagName !== 'H1') seen.idx += 1
    const base = h.id || slug(h.textContent || '', seen.idx)
    let id = base
    for (let n = 2; seen.ids.has(id); n++) id = `${base}-${n}`
    seen.ids.add(id)
    h.id = id
    if (h.tagName !== 'H1') {
      seen.toc.push({ level: Number(h.tagName[1]), title: (h.textContent || '').trim(), id })
    }
  })
  t.content.querySelectorAll('table').forEach((table) => {
    const box = document.createElement('div')
    box.className = 'table-scroll'
    box.setAttribute('tabindex', '0')
    box.setAttribute('role', 'region')
    box.setAttribute('aria-label', 'Table')
    table.replaceWith(box)
    box.appendChild(table)
  })
  return t.innerHTML
}

// A docs page as the reader sees it: its html (`before`/`after` around the map list for a map
// page, which draws its rows in place of the table) and the H2/H3 outline of exactly that html.
export function renderDoc(page) {
  const seen = { ids: new Set(), idx: 0, toc: [] }
  const one = (body) => addIds(renderMarkdown(body, page?.links), seen)
  if (page?.rows) {
    const [before, after] = splitAtMapTable(page.body)
    return { before: one(before), after: one(after), toc: seen.toc }
  }
  return { html: one(page?.body), toc: seen.toc }
}
