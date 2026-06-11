// Tests for the context plugin's MACHINE WIKI rendering (AGENT.md §7) — folder
// entries, file-over-folder override, exclude pruning, dot-folder skipping, and
// lazy-listing truncation. Driven through the compaction hook (same render path as
// session.created), no live OpenCode. Run from the Geneseed root:
//   node --test tests/context_wiki.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import * as path from "node:path"

// Module-level config in the plugin — must be set BEFORE the import below.
process.env.GENESEED_WIKI_LAZY_LIMIT = "2"
// Pin the visible delivery: the compaction hook (our render driver) only re-pushes
// when delivery is visible — under the invisible default it returns early.
process.env.GENESEED_CONTEXT_VISIBLE = "1"

let tmp, text

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gswiki-"))
  const vault = path.join(tmp, "Brain")
  for (const d of ["Areas", "Journal", ".obsidian"]) {
    await fs.mkdir(path.join(vault, d), { recursive: true })
  }
  await fs.writeFile(path.join(vault, "ARCHITECTURE.md"), "# Architecture Map\nthe root index\n")
  await fs.writeFile(path.join(vault, "Areas", "one.md"), "# One\n")
  await fs.writeFile(path.join(vault, "Areas", "two.md"), "# Two\n")
  await fs.writeFile(path.join(vault, "Areas", "three.md"), "# Three\n")
  await fs.writeFile(path.join(vault, "Journal", "secret.md"), "# Private\n")
  await fs.writeFile(path.join(vault, ".obsidian", "skip.md"), "# Config\n")

  // The canonical setup this feature was built for: the whole vault lazy, the
  // root index eager — plus an excluded folder. File entry deliberately listed
  // LAST and the exclude in the middle: order must not matter for the override.
  await fs.writeFile(path.join(tmp, "wiki.jsonc"), `// test manifest
{
  "wikis": [{
    "name": "Brain",
    "path": ${JSON.stringify(vault)},
    "entries": [
      { "path": ".", "load": "lazy" },
      { "path": "Journal", "load": "exclude" },
      { "path": "ARCHITECTURE.md", "load": "eager", "description": "vault map" },
    ],
  }],
}
`)
  process.env.GENESEED_WIKI = path.join(tmp, "wiki.jsonc")

  const repo = path.join(tmp, "repo")
  await fs.mkdir(repo)
  const mod = await import("../adapters/opencode/plugins/geneseed-context.js")
  const plugin = await mod.default({ directory: repo, client: {} })
  const output = { context: [] }
  await plugin["experimental.session.compacting"]({}, output)
  text = output.context[0] ?? ""
})

after(async () => {
  delete process.env.GENESEED_WIKI
  delete process.env.GENESEED_WIKI_LAZY_LIMIT
  delete process.env.GENESEED_CONTEXT_VISIBLE
  await fs.rm(tmp, { recursive: true, force: true })
})

test("the eager root file is injected in full, with its description", () => {
  assert.match(text, /----- Brain\/ARCHITECTURE\.md — vault map -----/)
  assert.match(text, /# Architecture Map/)
})

test("a folder entry expands: notes beneath it are listed lazy with headings", () => {
  assert.match(text, /^ {2}- Brain\/Areas\/one\.md — One$/m)
})

test("a file entry overrides its folder's mode (no duplicate lazy line)", () => {
  assert.doesNotMatch(text, /^ {2}- Brain\/ARCHITECTURE\.md/m)
})

test("an excluded folder is pruned from the listing", () => {
  assert.ok(!text.includes("Journal"))
})

test("dot-folders (.obsidian, .trash) are never walked", () => {
  assert.ok(!text.includes("skip.md"))
})

test("the lazy listing truncates at the cap with a visible count", () => {
  assert.match(text, /\[\+1 more notes in this wiki — explore its folders on demand\]/)
})
