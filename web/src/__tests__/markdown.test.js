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
  // SMIL rewrites an attribute after the walk: the scheme check never sees the value.
  [
    'svg <set> writing a javascript: href',
    '<svg><a><set attributeName="href" to="javascript:alert(1)"/></a></svg>',
    /javascript:/i,
  ],
  [
    'svg <animate> cycling a javascript: href',
    '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>',
    /javascript:/i,
  ],
  // The parser keeps SVG's camelCase name, so a lower-case selector alone misses it.
  ['svg <animateMotion>', '<svg><animateMotion dur="1s"/></svg>', /animatemotion/i],
  ['svg <animateColor>', '<svg><animateColor dur="1s"/></svg>', /animatecolor/i],
  // A nested template's content is its own fragment, out of reach of the walk.
  ['nested template', '<template><img src="x" onerror="alert(1)"></template>', /onerror/i],
  // A transparent full-viewport link over the console, or a beacon through url().
  [
    'style attribute',
    '<a href="https://evil.test" style="position:fixed;inset:0;opacity:0">x</a>',
    /style=/i,
  ],
  ['srcdoc', '<div srcdoc="<script>alert(1)</script>">x</div>', /srcdoc/i],
  [
    'javascript: formaction',
    '<button formaction="javascript:alert(1)">go</button>',
    /javascript:/i,
  ],
]

// Mutation XSS: markup that serialises to something the next parse reads
// differently. The sink re-parses the output, so the assertion re-parses too
// and checks the elements the browser would build, not the string.
const MXSS = [
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  // The first pin with every other raw-text element in place of <style>: each
  // hides the <img> as text in the first parse and lets it out in the second.
  '<math><mtext><table><mglyph><xmp><img src=x onerror=alert(1)>',
  '<math><mtext><table><mglyph><noembed><img src=x onerror=alert(1)>',
  '<math><mtext><table><mglyph><noframes><img src=x onerror=alert(1)>',
  '<math><mtext><table><mglyph><noscript><img src=x onerror=alert(1)>',
  '<math><mtext><table><mglyph><plaintext><img src=x onerror=alert(1)>',
]

function liveAttributes(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return [...div.querySelectorAll('*')].flatMap((el) => [...el.attributes])
}

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
  for (const src of MXSS) {
    it(`re-parses clean: ${src}`, () => {
      const attrs = liveAttributes(renderMarkdown(src))
      expect(attrs.filter((a) => a.name.toLowerCase().startsWith('on'))).toEqual([])
      expect(attrs.filter((a) => /javascript:/i.test(a.value))).toEqual([])
    })
  }
  for (const [name, src, good] of KEPT) {
    it(`keeps ${name}`, () => expect(renderMarkdown(src)).toContain(good))
  }
})
