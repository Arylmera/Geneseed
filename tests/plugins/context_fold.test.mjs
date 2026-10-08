// The OpenCode context plugin folds the project's lazy listing the same way the Claude hook
// does (tests/unit/claude.test.mjs pins the hook): three or more undescribed docs sharing a
// parent directory become one `dir/ — N docs` line, two stay listed by name (the threshold,
// both sides), root files never fold. A wiki listing is NOT folded — context_wiki pins that.
//   node --test tests/plugins/context_fold.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { makeSandbox } from "../helpers/sandbox.mjs"

// The compaction hook (the render driver) only re-pushes under visible delivery.
process.env.GENESEED_CONTEXT_VISIBLE = "1"

let tmp, text

before(async () => {
  tmp = makeSandbox("gsfold-").path
  const repo = path.join(tmp, "repo")
  await fs.mkdir(path.join(repo, "docs", "many"), { recursive: true })
  await fs.mkdir(path.join(repo, "docs", "two"), { recursive: true })
  for (let i = 0; i < 5; i++) await fs.writeFile(path.join(repo, "docs", "many", `m${i}.md`), "# M\n")
  for (let i = 0; i < 2; i++) await fs.writeFile(path.join(repo, "docs", "two", `t${i}.md`), "# T\n")
  for (let i = 0; i < 3; i++) await fs.writeFile(path.join(repo, `NOTE${i}.md`), "# N\n")
  await fs.writeFile(path.join(tmp, "geneseed-wiki.jsonc"), `{ "wikis": [] }`)
  process.env.GENESEED_WIKI = path.join(tmp, "geneseed-wiki.jsonc")
  const mod = await import("../../adapters/opencode/plugins/geneseed-context.js?case=fold")
  const plugin = await mod.default({ directory: repo, client: {} })
  const output = { context: [] }
  await plugin["experimental.session.compacting"]({}, output)
  text = output.context[0] ?? ""
})

after(async () => {
  delete process.env.GENESEED_WIKI
  delete process.env.GENESEED_CONTEXT_VISIBLE
  await fs.rm(tmp, { recursive: true, force: true })
})

test("five undescribed docs in one directory fold into one line", () => {
  assert.match(text, /^ {2}- docs\/many\/ — 5 docs$/m)
  assert.ok(!text.includes("m0.md"), "a folded doc was still listed by name")
})

test("two docs stay listed by name, below the threshold", () => {
  assert.match(text, /^ {2}- docs\/two\/t0\.md/m)
  assert.match(text, /^ {2}- docs\/two\/t1\.md/m)
})

test("root files are never folded", () => {
  assert.match(text, /^ {2}- NOTE0\.md/m)
})
