// Unit tests for the learn plugin's per-agent memory helpers — pure functions only,
// no live OpenCode. Run from the Geneseed root:
//   node --test tests/plugins/learn.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import path from "node:path"
import GeneseedLearn from "../../adapters/opencode/plugins/geneseed-learn.js"
const { resolveAgentName, appendAgentLesson } = GeneseedLearn
import { makeSandbox } from "../helpers/sandbox.mjs";

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
  assert.deepEqual(written, accepted)
  assert.deepEqual((await fs.readdir(root)).sort(), ["memory"],
    "a memory was written outside the memory dir")
  assert.deepEqual((await fs.readdir(memDir)).sort(),
    ["MEMORY.md", ...accepted.map((n) => `${n}.md`)].sort())
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
  assert.deepEqual(written, ["fresh"])
  assert.equal(await fs.readFile(path.join(memDir, "user-prefs.md"), "utf8"), "original\n")
  assert.match(await fs.readFile(path.join(memDir, "MEMORY.md"), "utf8"),
    /^# Memory Index\n- \[user-prefs\]\(user-prefs\.md\)\n- \[fresh\]/)
})
