import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { DUR } from '../lib/motion.js'

// styles.css `:root` is the one writer of the motion scale. anime.js cannot read a CSS variable, so
// lib/motion.js mirrors it; this reads the reference at test time rather than holding a copy.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
const scale = [...code.matchAll(/--dur-(\d+):\s*(\d+)ms;/g)].map((m) => [
  Number(m[1]),
  Number(m[2]),
])

describe('the motion token scale', () => {
  it('is mirrored step for step in lib/motion.js', () => {
    expect(scale.length).toBeGreaterThan(10)
    expect(scale.map(([i]) => i)).toEqual(DUR.map((_, i) => i))
    expect(scale.map(([, ms]) => ms)).toEqual(DUR)
  })

  // The stop in the reduced-motion blocks is the one literal: it is an off switch, not a timing.
  it('leaves no literal duration or curve in a transition or an animation', () => {
    const literals = []
    for (const m of code.matchAll(
      /(?:^|[\s;{])((?:transition|animation)(?:-duration|-delay|-timing-function)?)\s*:\s*([^;}]+)/g,
    )) {
      const value = m[2].replace(/var\([^)]*\)/g, '')
      const time = /(?<![\w.-])\d*\.?\d+m?s\b/.exec(value)
      const curve = /cubic-bezier|(?<![\w-])ease(?:-in-out|-in|-out)?(?![\w-])/.exec(value)
      if (curve || (time && !/^\.01m?s$/.test(time[0]))) literals.push(`${m[1]}: ${m[2].trim()}`)
    }
    expect(literals).toEqual([])
  })
})
