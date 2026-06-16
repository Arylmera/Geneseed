// Tests for the ponytail plugin's pure logic — mode normalisation, the opt-in default,
// and the per-level instruction builder. The two OpenCode hooks are thin wrappers over
// these helpers (read mode → push text); the flag-file IO is a side effect and is not
// unit-tested. Run from the Geneseed root:
//   node --test tests/ponytail.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import GeneseedPonytail from "../adapters/opencode/plugins/geneseed-ponytail.js"
const { normalizeMode, defaultMode, ponytailInstructions } = GeneseedPonytail

test("normalizeMode: known levels pass through, case/space-insensitive", () => {
  assert.equal(normalizeMode("lite"), "lite")
  assert.equal(normalizeMode("  FULL "), "full")
  assert.equal(normalizeMode("Ultra"), "ultra")
  assert.equal(normalizeMode("off"), "off")
})

test("normalizeMode: 'stop'/'normal'/'none' map to off; junk is null", () => {
  for (const s of ["stop", "normal", "none", "disable"]) assert.equal(normalizeMode(s), "off")
  assert.equal(normalizeMode("turbo"), null)
  assert.equal(normalizeMode(""), null)
  assert.equal(normalizeMode(null), null)
  assert.equal(normalizeMode(undefined), null)
})

test("defaultMode: off when GENESEED_PONYTAIL unset, honours a valid override", () => {
  const saved = process.env.GENESEED_PONYTAIL
  try {
    delete process.env.GENESEED_PONYTAIL
    assert.equal(defaultMode(), "off")
    process.env.GENESEED_PONYTAIL = "ultra"
    assert.equal(defaultMode(), "ultra")
    process.env.GENESEED_PONYTAIL = "nonsense"
    assert.equal(defaultMode(), "off")   // unrecognised → dormant
  } finally {
    if (saved === undefined) delete process.env.GENESEED_PONYTAIL
    else process.env.GENESEED_PONYTAIL = saved
  }
})

test("ponytailInstructions: off / unknown inject nothing", () => {
  assert.equal(ponytailInstructions("off"), null)
  assert.equal(ponytailInstructions("turbo"), null)
})

test("ponytailInstructions: each active level names itself and carries the ladder", () => {
  for (const [mode, tag] of [["lite", "LITE"], ["full", "FULL"], ["ultra", "ULTRA"]]) {
    const text = ponytailInstructions(mode)
    assert.ok(text.includes("PONYTAIL MODE"))
    assert.ok(text.includes(tag))
    assert.ok(text.includes("stdlib"))           // the ladder is present
    assert.ok(text.includes("ponytail:"))        // the shortcut-comment rule survives
  }
})
