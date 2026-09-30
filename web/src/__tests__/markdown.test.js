import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../components/Markdown.jsx'

// Markdown bodies come from agents and web clippings, and the page holds the
// POST token. Each row is an input that must lose its script, and what must
// survive: benign HTML the docs use stays, and so do web and in-page links.
const STRIPPED = [
  ['inline handler', '<img src="x.png" onerror="alert(1)">', /onerror/i],
  ['script tag', '<script>alert(1)</script>', /<script/i],
  ['iframe', '<iframe src="https://evil.test"></iframe>', /<iframe/i],
  ['javascript: link', '[go](javascript:alert(1))', /javascript:/i],
  ['scheme split by a newline', '<a href="java\nscript:alert(1)">go</a>', /href=/i],
  ['data: link', '<a href="data:text/html,x">go</a>', /data:/i],
  ['svg onload', '<svg onload="alert(1)"></svg>', /onload/i],
]

const KEPT = [
  ['centred div', '<div align="center">hi</div>', 'align="center"'],
  ['kbd', 'press <kbd>Ctrl</kbd>', '<kbd>Ctrl</kbd>'],
  ['https link', '[site](https://example.com)', 'href="https://example.com"'],
  ['hash route', '[law](#/item/law/IV)', 'href="#/item/law/IV"'],
  ['mailto', '[mail](mailto:a@b.c)', 'href="mailto:a@b.c"'],
]

describe('renderMarkdown sanitising', () => {
  for (const [name, src, bad] of STRIPPED) {
    it(`strips ${name}`, () => expect(renderMarkdown(src)).not.toMatch(bad))
  }
  for (const [name, src, good] of KEPT) {
    it(`keeps ${name}`, () => expect(renderMarkdown(src)).toContain(good))
  }
})
