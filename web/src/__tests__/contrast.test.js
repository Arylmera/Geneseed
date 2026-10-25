import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAGES, applyAccent, applyCuratedAccent, applyHexAccent, contrast } from '../lib/accents.js'
import { CUSTOM_ACCENTS } from '../hooks/useAccentMode.js'

// The light/dark contrast contract of the console, measured on the stylesheet and the accent
// functions themselves — no colour is copied in here. Each (flavour, mode) gets its token map
// from its `.fl-F` block (light: merged with `.fl-F.light`); each accent source is the real
// apply* function writing on a fake element, whose values override the flavour's (inline style
// on .app wins). Every check collects ALL failing pairs and asserts the list is empty, so a red
// run names each pair instead of stopping at the first.

// WCAG 2.x 1.4.3 AA for normal text: the console's text is 10-13 px, never "large".
const AA_TEXT = 4.5
// WCAG 2.x 1.4.11 non-text contrast (and 2.4.11 focus appearance) for the focus ring.
const NON_TEXT = 3
// VS-7: an accent this close in hue to the base warning colour makes the warning read as decoration.
const WARN_HUE_NEAR = 25
// Below this HSL saturation a colour is grey and has no meaningful hue to collide on.
const MIN_SATURATION = 0.15
// Status pills/tags/badges sit on a 9-15% tint of their own colour; 15 is the largest used.
const STATUS_TINT = 15

const FLAVOURS = ['cultivar', 'operator', 'matrix', 'atlas']
const MODES = ['dark', 'light']
const SURFACES = ['--bg', '--bg-2', '--surface', '--surface-2', '--surface-3']
// Free picks for the colour picker: very light, very dark, the amber warn twin, pure magenta, grey.
const HEX_PICKS = ['#FFF176', '#1A2B8C', '#E8B53D', '#FF00FF', '#7F7F7F']

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const accentsSrc = readFileSync(resolve(process.cwd(), 'src/lib/accents.js'), 'utf8')

// ---- a small CSS reader: rules, selector lists, declarations ----

// Split at `sep` outside parentheses (selector lists hold :is(a, b), values hold color-mix(...)).
function splitTop(s, sep) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((p) => p.trim()).filter(Boolean)
}

function parseRules(src, at = null, out = []) {
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let close = open + 1
    for (; close < src.length && depth > 0; close++) {
      if (src[close] === '{') depth++
      else if (src[close] === '}') depth--
    }
    close-- // index of the matching '}'
    const head = src.slice(i, open)
    const sel = head.slice(head.lastIndexOf(';') + 1).trim()
    const body = src.slice(open + 1, close)
    if (sel.startsWith('@')) parseRules(body, sel, out)
    else {
      const decls = splitTop(body.includes('{') ? '' : body, ';')
        .map((d) => {
          const c = d.indexOf(':')
          return c < 0 ? null : [d.slice(0, c).trim(), d.slice(c + 1).trim()]
        })
        .filter(Boolean)
      out.push({ sel, selectors: splitTop(sel, ','), at, decls })
    }
    i = close + 1
  }
  return out
}

const rules = parseRules(css.replace(/\/\*[\s\S]*?\*\//g, ''))

// Every top-level rule whose selector list holds `selector` standalone, merged in source order.
function blockTokens(selector) {
  const map = {}
  for (const r of rules)
    if (r.at === null && r.selectors.includes(selector))
      for (const [p, v] of r.decls) if (p.startsWith('--')) map[p] = v
  return map
}

// ---- colour arithmetic ----

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (rgb) =>
  '#' +
  rgb
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

// sRGB mix of a at p% over b, as CSS `color-mix(in srgb, a p%, b)`.
const tint = (a, p, b) => {
  const [x, y] = [toRgb(a), toRgb(b)]
  return toHex(x.map((v, i) => (v * p + y[i] * (100 - p)) / 100))
}

function hsl(hex) {
  const [r, g, b] = toRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s }
}
const hueDist = (a, b) => {
  const d = Math.abs(hsl(a).h - hsl(b).h) % 360
  return d > 180 ? 360 - d : d
}

// Resolve a token value to #RRGGBB against `map`, or null (missing token, transparent, unknown form).
function resolveValue(value, map, depth = 0) {
  if (value == null || depth > 20) return null
  const v = value.trim()
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return '#' + h.toUpperCase()
  }
  m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/)
  if (m) {
    if (m[1] in map) return resolveValue(map[m[1]], map, depth + 1)
    return m[2] === undefined ? null : resolveValue(m[2], map, depth + 1)
  }
  m = v.match(/^color-mix\(([\s\S]*)\)$/)
  if (m) {
    const [space, a, b] = splitTop(m[1], ',')
    if (space !== 'in srgb' || !a || !b) return null
    const pa = a.match(/^([\s\S]*?)\s+([\d.]+)%$/)
    const pb = b.match(/^([\s\S]*?)\s+([\d.]+)%$/)
    const ca = resolveValue(pa ? pa[1] : a, map, depth + 1)
    const cb = resolveValue(pb ? pb[1] : b, map, depth + 1)
    if (!ca || !cb) return null
    const p = pa ? Number(pa[2]) : pb ? 100 - Number(pb[2]) : 50
    return tint(ca, p, cb)
  }
  return null
}
const tok = (map, name) => resolveValue(`var(${name})`, map)

// ---- accent sources: the real functions on a fake element ----

function fakeEl() {
  const props = {}
  return {
    props,
    style: {
      setProperty: (k, v) => (props[k] = v),
      removeProperty: (k) => delete props[k],
    },
  }
}

// ACCENT_HEX is private to accents.js: its keys are read from the source text.
const accentHexBlock = accentsSrc.match(/const ACCENT_HEX = \{([\s\S]*?)\}/)
const ACCENT_HEX_KEYS = accentHexBlock
  ? [...accentHexBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  : []
const NAMED = [...new Set([...CUSTOM_ACCENTS.map((c) => c.name), ...ACCENT_HEX_KEYS])]

function sources(flavour, mode) {
  const out = []
  const add = (label, apply) => {
    const el = fakeEl()
    apply(el)
    out.push({ label, writes: { ...el.props } })
  }
  add('curated', (el) => applyCuratedAccent(el, flavour, mode))
  for (const name of NAMED) add(`accent:${name}`, (el) => applyAccent(el, name, mode))
  for (const hex of HEX_PICKS) add(`hex:${hex}`, (el) => applyHexAccent(el, hex, mode))
  return out
}

const flavourMap = (f, m) => ({
  ...blockTokens(`.fl-${f}`),
  ...(m === 'light' ? blockTokens(`.fl-${f}.light`) : {}),
})

// Every (flavour, mode, source) with its effective token map.
const CASES = FLAVOURS.flatMap((f) =>
  MODES.flatMap((m) => {
    const base = flavourMap(f, m)
    return sources(f, m).map((s) => ({
      f,
      m,
      src: s.label,
      base,
      writes: s.writes,
      map: { ...base, ...s.writes },
    }))
  }),
)

const fmt = (x) => x.toFixed(2)
// One line per failing pair, duplicates dropped, so the diff of a red run lists every pair.
const report = (fails) => [...new Set(fails)].join('\n')

// Push a failure when fg on bg is below `min`, or when either side does not resolve.
function pair(fails, who, fgName, fg, bgName, bg, min) {
  if (!fg || !bg) {
    fails.push(`${who}: ${!fg ? `missing ${fgName}` : `missing ${bgName}`}`)
    return
  }
  const r = contrast(fg, bg)
  if (r < min) fails.push(`${who}: ${fgName} ${fg} on ${bgName} ${bg} = ${fmt(r)} < ${min}`)
}

// The soft accent fill's percentage, read from the one rule that defines --accent-soft.
const softRule = css.match(/--accent-soft:\s*color-mix\(in srgb, var\(--accent\) (\d+)%/)
const SOFT_PCT = softRule ? Number(softRule[1]) : null

describe('light/dark contrast contract', () => {
  it('reads every flavour block and every accent source (the gate is not walking an empty set)', () => {
    for (const f of FLAVOURS)
      for (const m of MODES)
        expect(Object.keys(flavourMap(f, m)).length, `${f} ${m}`).toBeGreaterThan(10)
    expect(ACCENT_HEX_KEYS).toEqual(expect.arrayContaining(['red', 'white', 'cyan']))
    expect(CUSTOM_ACCENTS.length).toBeGreaterThanOrEqual(5)
    expect(SOFT_PCT).not.toBeNull()
  })

  it('1: --text, --text-2, --text-3 hold AA on every surface', () => {
    const fails = []
    for (const f of FLAVOURS)
      for (const m of MODES) {
        const map = flavourMap(f, m)
        for (const t of ['--text', '--text-2', '--text-3'])
          for (const s of SURFACES)
            pair(fails, `${f} ${m}`, t, tok(map, t), s, tok(map, s), AA_TEXT)
      }
    expect(report(fails)).toBe('')
  })

  it('2: --accent-text holds AA on every surface and on the soft accent tint', () => {
    const fails = []
    for (const c of CASES) {
      const who = `${c.f} ${c.m} ${c.src}`
      const text = tok(c.map, '--accent-text')
      const accent = tok(c.map, '--accent')
      for (const s of SURFACES) pair(fails, who, '--accent-text', text, s, tok(c.map, s), AA_TEXT)
      for (const s of ['--surface', '--surface-2']) {
        const sv = tok(c.map, s)
        const bg = accent && sv ? tint(accent, SOFT_PCT, sv) : null
        pair(fails, who, '--accent-text', text, `tint(--accent ${SOFT_PCT}%, ${s})`, bg, AA_TEXT)
      }
    }
    expect(report(fails)).toBe('')
  })

  it('3: --good-text, --warn-text, --bad-text exist and hold AA on surfaces and their own tint', () => {
    const fails = []
    const status = ['--good', '--warn', '--bad']
    const statusTokens = status.flatMap((b) => [b, `${b}-text`])
    for (const c of CASES) {
      // A source that writes no status token shares the flavour's result: label it once.
      const own = statusTokens.some((t) => t in c.writes)
      const who = own ? `${c.f} ${c.m} ${c.src}` : `${c.f} ${c.m}`
      for (const b of status) {
        const name = `${b}-text`
        const text = tok(c.map, name)
        if (!text) {
          fails.push(`${who}: missing ${name}`)
          continue
        }
        for (const s of SURFACES) pair(fails, who, name, text, s, tok(c.map, s), AA_TEXT)
        const base = tok(c.map, b)
        for (const s of ['--surface', '--surface-2']) {
          const sv = tok(c.map, s)
          const bg = base && sv ? tint(base, STATUS_TINT, sv) : null
          pair(fails, who, name, text, `tint(${b} ${STATUS_TINT}%, ${s})`, bg, AA_TEXT)
        }
      }
    }
    expect(report(fails)).toBe('')
  })

  it('4: --accent-ink holds AA on the filled --accent', () => {
    const fails = []
    for (const c of CASES)
      pair(
        fails,
        `${c.f} ${c.m} ${c.src}`,
        '--accent-ink',
        tok(c.map, '--accent-ink'),
        '--accent',
        tok(c.map, '--accent'),
        AA_TEXT,
      )
    expect(report(fails)).toBe('')
  })

  it('5: the global :focus-visible ring holds 3:1 on every surface', () => {
    const fails = []
    const rule = rules.find((r) => r.at === null && r.selectors.includes(':focus-visible'))
    const outline = rule?.decls.find(([p]) => p === 'outline' || p === 'outline-color')?.[1]
    const colour = outline?.match(/var\([^()]*(?:\([^()]*\))?[^()]*\)|#[0-9a-fA-F]{3,6}\b/)?.[0]
    expect(colour, 'global :focus-visible outline colour').toBeTruthy()
    for (const c of CASES) {
      const ring = resolveValue(colour, c.map)
      for (const s of SURFACES)
        pair(
          fails,
          `${c.f} ${c.m} ${c.src}`,
          `focus ring ${colour}`,
          ring,
          s,
          tok(c.map, s),
          NON_TEXT,
        )
    }
    expect(report(fails)).toBe('')
  })

  it('6: an accent near the warning hue moves --warn away from it', () => {
    const fails = []
    for (const c of CASES) {
      const accent = tok(c.map, '--accent')
      const baseWarn = tok(c.base, '--warn')
      if (!accent || !baseWarn) {
        fails.push(`${c.f} ${c.m} ${c.src}: missing ${accent ? '--warn' : '--accent'}`)
        continue
      }
      if (hsl(accent).s < MIN_SATURATION || hsl(baseWarn).s < MIN_SATURATION) continue
      const near = hueDist(accent, baseWarn)
      if (near > WARN_HUE_NEAR) continue
      const warn = tok(c.map, '--warn')
      const who = `${c.f} ${c.m} ${c.src}: --accent ${accent} is ${fmt(near)} deg from --warn ${baseWarn}`
      if (warn === baseWarn) fails.push(`${who}, --warn not shifted`)
      else if (hueDist(warn, accent) <= near)
        fails.push(
          `${who}, shifted --warn ${warn} sits ${fmt(hueDist(warn, accent))} deg (not farther)`,
        )
    }
    expect(report(fails)).toBe('')
  })

  // Non-text uses that may keep the raw fill colour: icons and shapes, never glyphs of text.
  const ACCENT_ALLOWED = {
    '.gcell:hover .gicon': 'an SVG icon glyph (Genome.jsx <Icon>), non-text graphic',
    '.cm-hub-disc': 'the constitution map hub circle, a shape',
    '.cm-sat-disc': 'a satellite circle on the constitution map, a shape',
    '.spk-end': 'the sparkline end dot (Ledger.jsx <circle>), a shape',
    '.ldg-ring .fg': 'the ledger progress ring stroke, a shape',
    '.lr-ring': 'the loop ring stroke, a shape',
    '.lr-head-ring': 'the arrowhead marker on the loop ring, a shape',
    '.lr-node circle': 'a loop node circle, a shape',
    '.lr-node.current circle': 'the lit loop node circle, a shape',
    '.lr-node.inner.current circle': 'the lit inner-loop node circle, a shape',
  }

  it('7: no text is painted with the raw --accent (text uses --accent-text)', () => {
    const fails = []
    for (const r of rules)
      for (const [p, v] of r.decls) {
        if (p !== 'color' && p !== 'fill') continue
        // var(--accent-text, var(--accent)) is --accent-text with a fallback, always fine.
        if (/^var\(--accent-text\b/.test(v)) continue
        // `var(--accent)` or `var(--accent, <fallback>)`; --accent-text/-soft never match.
        if (!/var\(\s*--accent\s*[,)]/.test(v)) continue
        if (r.selectors.every((s) => s in ACCENT_ALLOWED)) continue
        fails.push(`${r.sel} { ${p}: ${v} }`)
      }
    expect(report(fails)).toBe('')
  })

  // Non-text uses that may keep a raw status colour: loop-diagram shapes, never glyphs of text.
  const STATUS_ALLOWED = {
    '.lr-inner': 'the inner-loop band and path on the loop ring, a shape',
    'path.lr-inner': 'the inner-loop path stroke on the loop ring, a shape',
    '.lr-head-inner': 'the arrowhead marker on the inner loop, a shape',
    '.lr-node.inner circle': 'an inner-loop node circle, a shape',
    '.lr-gate circle': 'the human-gate disc on the loop ring, a shape',
  }

  it('7b: no text is painted with a raw status colour (text uses --good/--warn/--bad-text)', () => {
    const fails = []
    for (const r of rules)
      for (const [p, v] of r.decls) {
        if (p !== 'color' && p !== 'fill') continue
        if (!/var\(\s*--(good|warn|bad)\s*[,)]/.test(v)) continue
        if (r.selectors.every((s) => s in STATUS_ALLOWED)) continue
        fails.push(`${r.sel} { ${p}: ${v} }`)
      }
    expect(report(fails)).toBe('')
  })

  // Rules 7/7b read the stylesheet; an inline `style={{ color: 'var(--accent)' }}` in a
  // component paints text just the same and the stylesheet never sees it (LN-5). Only the
  // `color` and `fill` keys: lib/activity.jsx's `accent: 'var(--bad)'` is a border colour.
  it('7c: no component paints text inline with a raw --accent or status colour', () => {
    const srcDir = resolve(process.cwd(), 'src')
    const files = readdirSync(srcDir, { recursive: true }).filter(
      (f) => /\.jsx?$/.test(f) && !/__tests__/.test(f),
    )
    expect(files.length, 'component sources found').toBeGreaterThan(50)
    const fails = []
    for (const f of files) {
      const text = readFileSync(resolve(srcDir, f), 'utf8')
      for (const m of text.matchAll(
        /\b(color|fill)\s*:\s*['"`]var\(\s*--(accent|good|warn|bad)\s*[,)]/g,
      ))
        fails.push(`${f}: ${m[0]}`)
    }
    expect(report(fails)).toBe('')
  })

  // Greenhouse's category colours (tiles, legend dots, ring arcs) are non-text marks: 3:1 on
  // every surface, both modes (LN-11). They are mode-wide tokens beside --chart-*: `.app`
  // for dark, `.app.light` for light, read here on top of each flavour's surfaces.
  it('10: the --cat-0..6 category colours hold 3:1 on every surface', () => {
    const root = blockTokens('.app')
    const light = blockTokens('.app.light')
    const fails = []
    for (const f of FLAVOURS)
      for (const m of MODES) {
        const map = { ...root, ...flavourMap(f, m), ...(m === 'light' ? light : {}) }
        for (let i = 0; i < 7; i++)
          for (const s of SURFACES)
            pair(fails, `${f} ${m}`, `--cat-${i}`, tok(map, `--cat-${i}`), s, tok(map, s), NON_TEXT)
      }
    expect(report(fails)).toBe('')
  })

  it('1b: the accent functions copy the stylesheet surfaces exactly (PAGES)', () => {
    const fails = []
    for (const m of MODES) {
      const maps = FLAVOURS.map((f) => flavourMap(f, m))
      // Contrast is a function of luminance alone: the darkest light surface is the one farthest
      // from white, the lightest dark surface the one farthest from black.
      const ref = m === 'light' ? '#FFFFFF' : '#000000'
      const plain = maps.flatMap((map) => SURFACES.map((s) => tok(map, s)))
      const worst = plain.reduce((a, b) => (contrast(b, ref) > contrast(a, ref) ? b : a))
      if (PAGES[m].worst !== worst) fails.push(`${m}: PAGES.worst ${PAGES[m].worst} != ${worst}`)
      const soft = [
        ...new Set(maps.flatMap((map) => ['--surface', '--surface-2'].map((s) => tok(map, s)))),
      ]
      const have = [...new Set(PAGES[m].soft)]
      for (const s of soft) if (!have.includes(s)) fails.push(`${m}: PAGES.soft lacks ${s}`)
      for (const s of have) if (!soft.includes(s)) fails.push(`${m}: PAGES.soft has stray ${s}`)
    }
    expect(report(fails)).toBe('')
  })

  // A focus rule that may drop the outline: not a control the keyboard user lands on.
  const OUTLINE_ALLOWED = {
    '#main:focus': 'programmatic focus target (tabIndex -1) for the skip link, not a control',
  }

  // The danger button paints its label on the filled --bad. Measured on whatever the rule
  // says, so the old hard-coded #fff is red here on the dark flavours. Flavour x mode, not
  // CASES: no accent source writes --bad (accents.js only moves --warn).
  const dangerRules = rules.filter((r) => r.at === null && r.selectors.includes('.btn.danger'))
  const dangerColour = dangerRules.flatMap((r) => r.decls.filter(([p]) => p === 'color'))

  it('9: the .btn.danger label holds AA on the filled --bad', () => {
    expect(dangerColour.length, '.btn.danger color declarations').toBe(1)
    const fails = []
    const value = dangerColour[0][1]
    for (const f of FLAVOURS)
      for (const m of MODES) {
        const map = flavourMap(f, m)
        pair(
          fails,
          `${f} ${m}`,
          `.btn.danger ${value}`,
          resolveValue(value, map),
          '--bad',
          tok(map, '--bad'),
          AA_TEXT,
        )
      }
    expect(report(fails)).toBe('')
  })

  it('9b: .btn.danger reads --bad-ink, and no flavour primary-button rule paints over it', () => {
    expect(dangerColour.map(([, v]) => v)).toEqual(['var(--bad-ink)'])
    // Each flavour's primary-button rule (glow, atlas gradient) matches .btn.danger too unless
    // it excludes it: an accent halo would make the danger button read as the primary one.
    const fails = []
    // A rule that only resets (`box-shadow: none`, the disabled state) paints nothing.
    const paints = (r) =>
      r.decls.some(([p, v]) => (p === 'box-shadow' || p === 'background-image') && v !== 'none')
    let matched = 0
    for (const r of rules)
      for (const s of r.selectors)
        if (/^\.fl-\w+ \.btn:not\(\.ghost\)/.test(s) && paints(r)) {
          matched++
          if (!s.includes(':not(.danger)')) fails.push(s)
        }
    // One per flavour at least, so a renamed selector cannot make this pass on an empty set.
    expect(matched, 'flavour primary-button rules found').toBeGreaterThanOrEqual(FLAVOURS.length)
    expect(report(fails)).toBe('')
  })

  it('8: no :focus rule removes the outline', () => {
    const fails = []
    for (const r of rules) {
      if (!r.sel.includes(':focus')) continue
      if (r.selectors.every((s) => s in OUTLINE_ALLOWED)) continue
      for (const [p, v] of r.decls)
        if (
          (p === 'outline' && /^(none|0)\b/.test(v)) ||
          (p === 'outline-style' && /^none\b/.test(v)) ||
          (p === 'outline-width' && /^0\b/.test(v))
        )
          fails.push(`${r.sel} { ${p}: ${v} }`)
    }
    expect(report(fails)).toBe('')
  })
})
