// The OpenCode plugins ship standalone — each is one file copied into a plugins dir, with no
// imports from js/ and none from each other — so a helper several of them need is COPIED into
// each. A copy that drifts is a plugin that answers differently from its siblings: a folder
// excluded for the guard but not for context. These tests hold every copy to the first one,
// byte for byte, and hold every plugin file to OpenCode's loader contract.
//
// js/hosts/hosts.mjs's `sovereignBypass` is the same RULE in the harness's own idiom, so it is
// not compared byte for byte: both follow symlinks on both sides, and tests/unit/
// excludes_guard.test.mjs holds the harness to a linked entry.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PLUGINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../adapters/opencode/plugins")
const read = (name) => readFileSync(path.join(PLUGINS, `geneseed-${name}.js`), "utf8")

// A helper's source: from its declaration to the first `}` at column 0 — every copied helper
// is a top-level declaration whose body closes there.
function helperSource(src, name) {
  const start = [`const ${name} = `, `async function ${name}(`, `function ${name}(`]
    .map((d) => src.search(new RegExp(`^${d.replace(/[()]/g, "[$&]")}`, "m")))
    .find((i) => i >= 0)
  if (start === undefined) return null
  const rest = src.slice(start)
  const close = /^}/m.exec(rest)
  return close ? rest.slice(0, close.index + 1) : null
}

// helper -> the plugins that carry a copy. A helper added to another plugin goes in its row.
const COPIES = {
  norm: ["context", "guard", "learn"],
  sovereignBypass: ["context", "guard", "learn"],
  mainWorktreeOf: ["context", "guard", "learn"],
  stripJsonc: ["context", "guard"],
}

for (const [helper, plugins] of Object.entries(COPIES)) {
  test(`${helper} is the same in ${plugins.join(", ")}`, () => {
    const [first, ...others] = plugins.map((p) => [p, helperSource(read(p), helper)])
    assert.ok(first[1], `${helper} not found in geneseed-${first[0]}.js`)
    for (const [plugin, src] of others) {
      assert.equal(src, first[1], `geneseed-${plugin}.js's ${helper} drifted from geneseed-${first[0]}.js's`)
    }
  })
}

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
