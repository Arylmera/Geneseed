// Unit tests for the learn plugin's per-agent memory helpers — pure functions only,
// no live OpenCode. Run from the Geneseed root:
//   node --test tests/learn.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { resolveAgentName, appendAgentLesson } from "../adapters/opencode/plugins/geneseed-learn.js"

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gs-learn-"))
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gs-learn-"))
  const f = await appendAgentLesson(dir, "tester", "a  lesson\nwith\tbreaks")
  const text = await fs.readFile(f, "utf8")
  assert.match(text, /- \d{4}-\d{2}-\d{2}: a lesson with breaks\n$/)
})
