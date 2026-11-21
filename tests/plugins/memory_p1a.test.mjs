// P1a of the memory-at-scale work, on the OpenCode side: the plugins carry hand twins of the hook's
// store-document rule (D2), its index rebuild (D4), its misc-only nudge (D23) and its drafts
// (D31), and each is held equal to the original here, on one store, by comparing what they write or
// print. The code is not shared (a plugin ships alone), so the comparison is the only gate.
//   node --test tests/plugins/memory_p1a.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from "../helpers/sandbox.mjs"
import { GeneseedLearn } from "../../adapters/opencode/plugins/geneseed-learn.js"
import { writeMemories as coreWriteMemories } from "../../js/hosts/memory-files.mjs"

// The compaction hook only re-pushes under visible delivery.
process.env.GENESEED_CONTEXT_VISIBLE = "1"

let home
before(() => { home = sandboxProcessHome() })
after(() => { restoreProcessHome(); delete process.env.GENESEED_CONTEXT_VISIBLE })

const fact = (name, type, desc) => `---\nname: ${name}\ndescription: ${desc}\ntype: ${type}\n---\nBody of ${name}.\n`

/** Every file under `dir`, CRLF folded (the core writes the platform's ending, the plugin LF). */
async function snapshot(dir) {
  const out = {}
  for (const e of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue
    const p = path.join(e.parentPath, e.name)
    out[path.relative(dir, p).replaceAll("\\", "/")] = (await fs.readFile(p, "utf8")).replaceAll("\r\n", "\n")
  }
  return out
}

// One store with a store document, a flat index that points at it and at a missing fact, and a fact.
async function store(dir) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "ARCHIVE-INDEX.md"), "# Archive\n")
  await fs.writeFile(path.join(dir, "kept.md"), fact("kept", "project", "kept fact"))
  await fs.writeFile(path.join(dir, "MEMORY.md"), [
    "# Memory Index", "## Notes", "A line a person wrote.",
    "- [Archive hub](archive-index.md) — old material", "- [Gone](gone.md) — file moved away",
    "- [Kept](kept.md) — kept fact", ""].join("\n"))
}

test("learn plugin: a store document is no fact, and the index rebuild matches the core line for line", async () => {
  const sb = makeSandbox("p1a-learn-")
  try {
    const a = path.join(sb.path, "core")
    const b = path.join(sb.path, "plugin")
    await store(a)
    await store(b)
    // `ARCHIVE-INDEX` and `TODO` are store documents (refused); `fresh` is created.
    const chunk = (name) => `---\nname: ${name}\ndescription: d\ntype: project\n---\nbody`
    const output = ["ARCHIVE-INDEX", "TODO", "fresh"].map(chunk).join("\n---FILE---\n")
    const viaCore = coreWriteMemories(output, a, new Set(["kept"]))
    const viaPlugin = await GeneseedLearn.writeMemories(output, b, new Set(["kept"]))
    assert.deepEqual(viaCore, { created: ["fresh"], updated: [], archived: [], skipped: [] })
    assert.deepEqual(viaPlugin, viaCore)
    const [left, right] = [await snapshot(a), await snapshot(b)]
    assert.deepEqual(right, left)
    // The pointer to the store document is carried, the missing fact's goes, the fact's moved (D4).
    assert.equal(left["MEMORY.md"], [
      "# Memory Index", "", "Each topic file lists its facts; open the one the task needs, or search every fact: `geneseed memory search \"<words>\"` (OpenCode: the `memory_search` tool).", "",
      "- [project](topics/project.md) — 2 facts", "",
      "## Notes", "A line a person wrote.",
      "- [Archive hub](archive-index.md) — old material", ""].join("\n"))
    // `kept` keeps its own pointer's title ("Kept"), a migration being lossless.
    assert.equal(left["topics/project.md"], "# project\n\n- [fresh](../fresh.md) — d\n- [Kept](../kept.md) — kept fact\n")
  } finally { sb.cleanup() }
})

// A global OpenCode install reads the tier. Its harness dir is the host's config dir, `<XDG>/opencode`.
test("context plugin: pending memory drafts add no rule text, and a 300-fact topic does not nudge", async () => {
  const tier = path.join(home, ".config", "geneseed")
  const harness = path.join(home, ".config", "opencode")
  await fs.mkdir(path.join(tier, "memory"), { recursive: true })
  await fs.mkdir(harness, { recursive: true })
  await fs.writeFile(path.join(tier, "memory", "MEMORY.md"), [
    "# Memory Index", "", "Each topic file lists its facts; open the one the task needs.", "",
    "- [feedback](topics/feedback.md) — 300 facts", "- [project](topics/project.md) — 1 fact", ""].join("\n"))
  const items = {}
  for (let i = 0; i < 12; i++) {
    const slug = `rule-${i}`
    await fs.writeFile(path.join(tier, "memory", `${slug}.md`),
      `---\nname: ${slug}\ndescription: "rule ${i}"\n---\n${"never do the thing, ".repeat(25)}\n`)
    items[`k${i}`] = { kind: "rule", host: "memory", state: i === 3 ? "approved" : "pending", fact: slug }
  }
  await fs.writeFile(path.join(tier, ".fold-state.json"), JSON.stringify({ version: 1, items }))
  process.env.GENESEED_HARNESS = harness
  try {
    const mod = await import("../../adapters/opencode/plugins/geneseed-context.js?case=p1a")
    const plugin = await mod.default.server({ directory: path.join(home, "repo"), client: {} })
    const output = { context: [] }
    await plugin["experimental.session.compacting"]({}, output)
    const text = output.context[0] ?? ""
    // D32: no drafted rule text rides in; the reminder line does, counting the 11 pending drafts.
    assert.equal(text.includes("never do the thing"), false, `a pending draft loads:
${text}`)
    assert.equal(text.includes("Standing rules from your old index"), false)
    assert.ok(text.includes("[drafts] 11 drafted items in user-rules.draft.md wait for the user's decision"), text)
    assert.ok(text.includes("- [feedback](topics/feedback.md) — 300 facts"))
    assert.equal(text.includes("Facts sit in misc"), false, "a 300-fact topic must not nudge (D23)")
  } finally { delete process.env.GENESEED_HARNESS }
})
