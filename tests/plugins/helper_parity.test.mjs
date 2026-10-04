// The OpenCode plugins ship standalone — each is one file copied into a plugins dir, with no
// imports from js/ and none from each other — so a helper several of them need is COPIED into
// each. A copy that drifts is a plugin that answers differently from its siblings: a folder
// excluded for the guard but not for context. These tests hold every copy to the first one,
// byte for byte, and hold every plugin file to OpenCode's loader contract.
//
// Deliberately NOT compared: js/hosts/hosts.mjs's own `sovereignBypass`, which resolves the
// path with realpath where these copies use path.resolve. Which one is right is an open
// decision; this file only keeps the plugins agreeing with each other.
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

// OpenCode calls EVERY export of a plugin file as a plugin factory, so an exported string or
// helper crashes startup or logs "not a function". Helpers tests need hang off the factory.
for (const file of readdirSync(PLUGINS).filter((f) => f.endsWith(".js")).sort()) {
  test(`${file}: every export is a function`, async () => {
    const mod = await import(pathToFileURL(path.join(PLUGINS, file)).href)
    const bad = Object.entries(mod).filter(([, v]) => typeof v !== "function").map(([k]) => k)
    assert.deepEqual(bad, [], `non-function export(s): ${bad.join(", ")}`)
  })
}
