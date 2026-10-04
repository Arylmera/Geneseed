// Unit tests for the learn plugin's per-agent memory helpers — pure functions only,
// no live OpenCode. Run from the Geneseed root:
//   node --test tests/plugins/learn.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import path from "node:path"
import GeneseedLearn, { resolveAgentName, appendAgentLesson } from "../../adapters/opencode/plugins/geneseed-learn.js"
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
// the same rule the harness's own learn hook applies (MEMORY_SLUG_RE in js/hosts/hooks.mjs).
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
