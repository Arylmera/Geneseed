// Unit tests for the learn plugin's per-agent memory helpers — pure functions only,
// no live OpenCode. Run from the Geneseed root:
//   node --test tests/plugins/learn.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import path from "node:path"
import { GeneseedLearn } from "../../adapters/opencode/plugins/geneseed-learn.js"
const { resolveAgentName, appendAgentLesson } = GeneseedLearn
import { makeSandbox } from "../helpers/sandbox.mjs";
import { buildLearnPrompt, learnPromptHead } from "../../js/hosts/hooks-learn.mjs"

test("resolveAgentName: reads agent from session meta, rejects garbage", () => {
  assert.equal(resolveAgentName({ agent: "reviewer" }), "reviewer")
  assert.equal(resolveAgentName({ agentName: "tester" }), "tester")
  assert.equal(resolveAgentName({ agent: "Reviewer" }), "reviewer") // lowercased
  assert.equal(resolveAgentName({ agent: "../evil" }), null)
  assert.equal(resolveAgentName({ agent: "has space" }), null)
  assert.equal(resolveAgentName({ agent: "" }), null)
  assert.equal(resolveAgentName({}), null)
  assert.equal(resolveAgentName(null), null)
})

test("appendAgentLesson: creates file, appends, caps at 100 bullets", async () => {
  const dir = makeSandbox("gs-learn-").path
  const f = await appendAgentLesson(dir, "reviewer", "cite tests in findings")
  const text1 = await fs.readFile(f, "utf8")
  assert.match(text1, /^# reviewer — lessons\n/)
  assert.match(text1, /- \d{4}-\d{2}-\d{2}: cite tests in findings\n$/)
  for (let i = 0; i < 120; i++) await appendAgentLesson(dir, "reviewer", `lesson ${i}`)
  const text2 = await fs.readFile(f, "utf8")
  const bullets = text2.split("\n").filter((l) => l.startsWith("- "))
  assert.equal(bullets.length, 100)
  assert.match(bullets.at(-1), /lesson 119/)
})

test("appendAgentLesson: collapses whitespace in the lesson", async () => {
  const dir = makeSandbox("gs-learn-").path
  const f = await appendAgentLesson(dir, "tester", "a  lesson\nwith\tbreaks")
  const text = await fs.readFile(f, "utf8")
  assert.match(text, /- \d{4}-\d{2}-\d{2}: a lesson with breaks\n$/)
})

// A memory `name:` is MODEL OUTPUT and becomes a filename, so it is a plain slug or nothing —
// the same rule the harness's own learn hook applies (MEMORY_SLUG_RE in js/hosts/memory-files.mjs).
// Each refused name below would have written outside the memory dir, or to a name no index
// line could link; the accepted ones show the rule is a slug check, not a lowercase one.
test("writeMemories: refuses a name that is not a plain slug, writes one that is", async () => {
  const root = makeSandbox("gs-learn-").path
  const memDir = path.join(root, "memory")
  await fs.mkdir(memDir)
  const chunk = (name) => `---\nname: ${name}\ndescription: d\n---\nbody`
  const refused = ["../escaped", "..", "a/b", "a\b", "C:evil", "-leading-dash", ".hidden", "x".repeat(101)]
  const accepted = ["Plain_Slug-1", "x".repeat(100)]
  const output = [...refused, ...accepted].map(chunk).join("\n---FILE---\n")
  const written = await GeneseedLearn.writeMemories(output, memDir, new Set())
  assert.deepEqual(written.created, accepted)
  assert.deepEqual((await fs.readdir(root)).sort(), ["memory"],
    "a memory was written outside the memory dir")
  assert.deepEqual((await fs.readdir(memDir)).sort(),
    ["MEMORY.md", "topics", ...accepted.map((n) => `${n}.md`)].sort())
})

// The twin of the harness rule (tests/unit/harness.test.mjs): `MEMORY` / `README` in any case
// name the store's own files and are refused, and a stored slug matches case-insensitively —
// on Windows and macOS `User-Prefs.md` and `user-prefs.md` are the same file.
test("writeMemories: refuses reserved stems and case variants of a stored slug", async () => {
  const memDir = makeSandbox("gs-learn-").path
  await fs.writeFile(path.join(memDir, "MEMORY.md"), "# Memory Index\n- [user-prefs](user-prefs.md)\n")
  await fs.writeFile(path.join(memDir, "user-prefs.md"), "original\n")
  const chunk = (name) => `---\nname: ${name}\ndescription: d\n---\nbody`
  const output = ["MEMORY", "memory", "Readme", "User-Prefs", "fresh", "FRESH"].map(chunk).join("\n---FILE---\n")
  const written = await GeneseedLearn.writeMemories(output, memDir, new Set(["user-prefs"]))
  assert.deepEqual(written, { created: ["fresh"], updated: [], archived: [] })
  assert.equal(await fs.readFile(path.join(memDir, "user-prefs.md"), "utf8"), "original\n")
  // The stored fact's flat line moves into its topic file as it was; the new one joins it.
  assert.equal(await fs.readFile(path.join(memDir, "topics", "misc.md"), "utf8"),
    "# misc\n\n- [fresh](../fresh.md) — d\n- [user-prefs](../user-prefs.md)\n")
})

// The plugin's two-level index is a hand-kept twin of js/hosts/memory-files.mjs's, so the same
// reply into the same legacy store must leave the same files behind (CRLF folded: the harness
// writes the platform newline, the plugin LF). The store mixes every grouping rule — `topic:`,
// `type:`, a `type:` nested under `metadata:`, none — plus a hand hook, a dead pointer and a note.
test("writeMemories: the plugin's two-level index matches the harness's", async () => {
  const { writeMemories: harnessWrite } = await import("../../js/hosts/memory-files.mjs")
  const reply = ["---\nname: n1\ndescription: N1\ntopic: Build Tools!\n---\nb",
    "---\nname: n2\ndescription: N2\nmetadata:\n  type: project\n---\nb",
    "---\nname: n3\ndescription: N3\n---\nb"].join("\n---FILE---\n")
  const seedStore = async () => {
    const d = makeSandbox("gs-learn-").path
    await fs.writeFile(path.join(d, "old.md"), "---\nname: old\ndescription: fm\ntype: project\n---\nb\n")
    await fs.writeFile(path.join(d, "MEMORY.md"),
      "# Memory Index\n\n- [Old](old.md) — hand hook\n- [dead](dead.md) — gone\n*a note*\n")
    return d
  }
  const snapshot = async (d) => {
    const out = {}
    for (const f of ["MEMORY.md", ...(await fs.readdir(path.join(d, "topics"))).map((t) => `topics/${t}`)]) {
      out[f] = (await fs.readFile(path.join(d, f), "utf8")).replaceAll("\r\n", "\n")
    }
    return out
  }
  const a = await seedStore()
  const b = await seedStore()
  await GeneseedLearn.writeMemories(reply, a, new Set(["old"]))
  harnessWrite(reply, b, new Set(["old"]))
  const plugin = await snapshot(a)
  assert.deepEqual(plugin, await snapshot(b))
  // Not two empty stores agreeing: the expected layout, written out.
  assert.deepEqual(Object.keys(plugin).sort(),
    ["MEMORY.md", "topics/build-tools.md", "topics/misc.md", "topics/project.md"])
  assert.equal(plugin["topics/project.md"],
    "# project\n\n- [n2](../n2.md) — N2\n- [Old](../old.md) — hand hook\n")
})

// The same parity for the two other actions, on a store whose slugs differ in case: an update
// (merged text replaces the stored file, its index line regenerated), an archive (the fact
// moves into archive/, past an archive already holding its name), a skipped update of a
// missing slug, a skipped archive of a `force: constraint` fact, and a create. Fact order
// inside a topic file is the core's sortPaths order: case-folded on Windows (alpha, Beta,
// locked, mid, Zeta), plain code-unit order elsewhere (Beta, Zeta, alpha, locked, mid). Written out per platform, so a plugin that sorted plainly on Windows fails.
test("writeMemories: the plugin matches the harness on update, archive and mixed-case order", async () => {
  const { writeMemories: harnessWrite } = await import("../../js/hosts/memory-files.mjs")
  const fact = (slug, desc) => `---\nname: ${slug}\ndescription: ${desc}\ntopic: t\n---\nb\n`
  const reply = ["---\nname: zeta\naction: update\ndescription: Z2\ntopic: t\n---\nmerged",
    "---\nname: gone\naction: archive\n---",
    "---\nname: ghost\naction: update\ndescription: x\n---\nb",
    "---\nname: locked\naction: archive\n---",
    fact("mid", "M")].join("\n---FILE---\n")
  const seedStore = async () => {
    const d = makeSandbox("gs-learn-").path
    for (const [s, desc] of [["Zeta", "Z"], ["alpha", "A"], ["Beta", "B"], ["gone", "G"]]) {
      await fs.writeFile(path.join(d, `${s}.md`), fact(s, desc))
    }
    await fs.writeFile(path.join(d, "locked.md"), "---\nname: locked\ndescription: L\ntopic: t\nforce: constraint\n---\nb\n")
    await fs.mkdir(path.join(d, "archive"))
    await fs.writeFile(path.join(d, "archive", "gone.md"), "older\n")
    return d
  }
  const snapshot = async (d) => {
    const out = {}
    const rels = [...(await fs.readdir(d)).filter((f) => f.endsWith(".md")),
      ...(await fs.readdir(path.join(d, "topics"))).map((t) => `topics/${t}`),
      ...(await fs.readdir(path.join(d, "archive"))).map((t) => `archive/${t}`)]
    for (const f of rels.sort()) out[f] = (await fs.readFile(path.join(d, f), "utf8")).replaceAll("\r\n", "\n")
    return out
  }
  const existing = ["Zeta", "alpha", "Beta", "gone", "locked"]
  const a = await seedStore()
  const b = await seedStore()
  const res = await GeneseedLearn.writeMemories(reply, a, new Set(existing))
  assert.deepEqual(res, harnessWrite(reply, b, new Set(existing)))
  assert.deepEqual(res, { created: ["mid"], updated: ["Zeta"], archived: ["gone"] })
  const plugin = await snapshot(a)
  assert.deepEqual(plugin, await snapshot(b))
  assert.equal(plugin["Zeta.md"], "---\nname: zeta\ndescription: Z2\ntopic: t\n---\nmerged\n")
  // The update archived Zeta's previous version first, so its old body survives, unindexed.
  assert.equal(plugin["archive/Zeta.md"], fact("Zeta", "Z"))
  assert.ok(!plugin["topics/t.md"].includes("archive") && !plugin["MEMORY.md"]?.includes("archive"))
  assert.equal(plugin["archive/gone.md"], "older\n")
  assert.equal(plugin["archive/gone-2.md"], fact("gone", "G"))
  assert.ok(!("gone.md" in plugin) && !("ghost.md" in plugin) && "locked.md" in plugin)
  const order = process.platform === "win32" ? ["alpha", "Beta", "locked", "mid", "Zeta"] : ["Beta", "Zeta", "alpha", "locked", "mid"]
  const desc = { alpha: "A", Beta: "B", locked: "L", mid: "M", Zeta: "Z2" }
  assert.equal(plugin["topics/t.md"], `# t\n\n${order.map((s) => `- [${s}](../${s}.md) — ${desc[s]}`).join("\n")}\n`)
})

test("buildPrompt stays in parity with js/hosts/hooks-learn.mjs's buildLearnPrompt (twin)", async () => {
  const src = await fs.readFile(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-learn.js"), "utf8")
  const m = src.match(/const MAX_STORED_CHARS = \d+\nfunction buildPrompt\(notes, facts\) \{[\s\S]*?\n\}\n/)
  assert.ok(m, "MAX_STORED_CHARS + buildPrompt not found in geneseed-learn.js")
  // The head is the plugin's own literal either way: learnPromptHead() extracts it from this file.
  const twin = new Function("LEARN_PROMPT_HEAD", `${m[0]}; return buildPrompt`)(learnPromptHead())
  const fact = (desc, topic) => ({ desc, topic })
  // 200 lines of ~70 chars run well past MAX_STORED_CHARS (8000), so the cap and the
  // "more stored facts not shown" line are both exercised.
  const many = new Map(Array.from({ length: 200 }, (_, i) =>
    [`fact-${i}`, fact(`a stored lesson long enough to count, number ${i} of many`, `t${i % 3}`)]))
  const rows = [
    ["empty store", "some notes", new Map()],
    ["one fact", "notes — with a dash", new Map([["alpha", fact("A thing", "general")]])],
    ["no description", "n", new Map([["bare", fact("", "z")], ["dup", fact("D", "z")]])],
    ["over the cap", "n", many],
  ]
  for (const [label, notes, facts] of rows) assert.equal(twin(notes, facts), buildLearnPrompt(notes, facts), label)
  assert.match(buildLearnPrompt("n", many), /more stored facts not shown/, "the cap row must reach the cap")
})
