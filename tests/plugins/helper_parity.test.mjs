// The OpenCode plugins ship standalone — each is one file copied into a plugins dir, with no
// imports from js/ and none from each other — so what the hook path owns is COPIED into a
// plugin, and a helper several plugins need is copied into each. A copy that drifts is a plugin
// that answers differently from the hook or from its siblings: a folder excluded for the guard
// but not for context. The rule: every row of tests/twins.mjs is byte-identical to its source,
// a leading `export ` aside. The rows are the list — a copy added to another plugin goes there,
// and `node tests/twins.mjs --write` repairs what these tests report. They also hold every
// plugin file to OpenCode's loader contract.
//
// js/hosts/hosts.mjs's `sovereignBypass` is the same RULE in the harness's own idiom, so it is
// not a row: both follow symlinks on both sides, and tests/unit/excludes_guard.test.mjs holds
// the harness to a linked entry.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { TWINS, twinState } from "../twins.mjs"

const PLUGINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../adapters/opencode/plugins")

for (const t of twinState()) {
  test(`${t.kind} twin '${t.name}': ${path.basename(t.target)} carries ${t.source} verbatim`, () => {
    assert.ok(t.at, `'${t.name}' is missing from ${t.source} or ${t.target}`)
    assert.ok(t.same, `${t.target}'s '${t.name}' drifted from ${t.source} — node tests/twins.mjs --write`)
  })
}

// A row listed twice would be written twice and reported once; a row whose source is its own
// target compares a file with itself and can never fail.
test("no twin row is repeated, and none copies a file into itself", () => {
  const keys = TWINS.map(([kind, name, , target]) => `${kind} ${name} -> ${target}`)
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [])
  assert.deepEqual(TWINS.filter(([, , source, target]) => source === target), [])
})

// Both OpenCode majors read the DEFAULT export, and each ignores the other's key: V1
// (>= 1.3.4) loads `{ id, server }`, V2 loads `{ id, setup }` (it rejects a bare function —
// "Plugin must export a default definition with an id and an effect or setup function").
// So one object `{ id, server, setup }` serves both. The id is the file stem: V2 refuses a
// duplicate id, and V1 resolves the plugin by it. Named exports stay functions, because a V1
// build whose default is not such an object falls back to calling every export as a factory.
for (const file of readdirSync(PLUGINS).filter((f) => f.endsWith(".js")).sort()) {
  test(`${file}: default export loads on OpenCode V1 and V2`, async () => {
    const mod = await import(pathToFileURL(path.join(PLUGINS, file)).href)
    const def = mod.default
    assert.equal(typeof def, "object", "default export must be an object, not a factory")
    assert.deepEqual(Object.keys(def).sort(), ["id", "server", "setup"])
    assert.equal(def.id, file.slice(0, -3))
    assert.equal(typeof def.server, "function")
    assert.equal(typeof def.setup, "function")
    const bad = Object.entries(mod).filter(([k, v]) => k !== "default" && typeof v !== "function").map(([k]) => k)
    assert.deepEqual(bad, [], `non-function named export(s): ${bad.join(", ")}`)
  })
}
