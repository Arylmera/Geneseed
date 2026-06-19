// Tests for the activity plugin's pure logic — session-id extraction across event
// shapes, the status transition table, and the entry reducer. The `event` hook is a
// thin wrapper that extracts fields and persists; the filesystem IO (atomic write,
// prune) is a side effect, covered on the reader side (tests/test_web.py). Run from
// the Geneseed root:
//   node --test tests/activity.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import GeneseedActivity from "../adapters/opencode/plugins/geneseed-activity.js"
const { sidOf, nextStatus, applyEvent, safeName, enabledFromFlag, acctTotals, errStr } = GeneseedActivity

test("acctTotals: same id overwrites (streaming), new id adds (next turn)", () => {
  const m = new Map()
  assert.deepEqual(acctTotals(m, "m1", 0.1, 100), { cost: 0.1, tokens: 100 })
  assert.deepEqual(acctTotals(m, "m1", 0.3, 250), { cost: 0.3, tokens: 250 })   // same id → overwrite
  const t = acctTotals(m, "m2", 0.2, 50)                                        // new id → add
  assert.equal(t.tokens, 300)
  assert.ok(Math.abs(t.cost - 0.5) < 1e-9)
})

test("errStr: plain string, the {name,data:{message}} union, and null", () => {
  assert.equal(errStr("boom"), "boom")
  assert.equal(errStr({ name: "APIError", data: { message: "rate limited" } }), "rate limited")
  assert.equal(errStr({ name: "UnknownError", data: {} }), "UnknownError")
  assert.equal(errStr(null), null)
})

test("enabledFromFlag: only an explicit off-word disables; absent/blank → on", () => {
  for (const off of ["off", "OFF", " 0 ", "false", "no"]) assert.equal(enabledFromFlag(off), false)
  for (const on of ["on", "1", "true", "", "  ", null, undefined, "yes"]) assert.equal(enabledFromFlag(on), true)
})

test("sidOf: pulls the session id from every event shape", () => {
  assert.equal(sidOf({ sessionID: "ses_a" }), "ses_a")              // session.status
  assert.equal(sidOf({ info: { sessionID: "ses_b" } }), "ses_b")    // message.updated (Message)
  assert.equal(sidOf({ part: { sessionID: "ses_c" } }), "ses_c")    // message.part.updated
  assert.equal(sidOf({ info: { id: "ses_d" } }), "ses_d")           // session.created (Session.id)
  assert.equal(sidOf({}), null)
  assert.equal(sidOf(null), null)
})

test("nextStatus: maps each event to busy / idle / waiting-input", () => {
  assert.equal(nextStatus("session.idle"), "waiting-input")
  assert.equal(nextStatus("message.updated"), "busy")
  assert.equal(nextStatus("message.part.updated"), "busy")
  assert.equal(nextStatus("session.status", "busy"), "busy")
  assert.equal(nextStatus("session.status", "retry"), "busy")
  assert.equal(nextStatus("session.status", "idle"), "idle")
  assert.equal(nextStatus("session.created"), "idle")
  assert.equal(nextStatus("something.else"), null)
})

test("applyEvent: builds a fresh entry from session.created", () => {
  const e = applyEvent(null, {
    type: "session.created", sid: "ses_a", pid: 42, nowSec: 100,
    title: "fix the parser", cwd: "/repo",
  })
  assert.deepEqual(e, {
    session_id: "ses_a", agent: null, title: "fix the parser", cwd: "/repo",
    status: "idle", pid: 42, updated_at: 100,
  })
})

test("applyEvent: merges later events, preserving prior fields", () => {
  let e = applyEvent(null, { type: "session.created", sid: "ses_a", pid: 42, nowSec: 100, title: "t", cwd: "/repo" })
  e = applyEvent(e, { type: "message.updated", sid: "ses_a", pid: 42, nowSec: 110, agent: "reviewer", cwd: "/repo/sub" })
  assert.equal(e.status, "busy")
  assert.equal(e.agent, "reviewer")
  assert.equal(e.cwd, "/repo/sub")
  assert.equal(e.title, "t")          // untouched by the message event
  assert.equal(e.updated_at, 110)
  e = applyEvent(e, { type: "session.idle", sid: "ses_a", pid: 42, nowSec: 120 })
  assert.equal(e.status, "waiting-input")
  assert.equal(e.agent, "reviewer")   // preserved across the idle
  assert.equal(e.pid, 42)             // creator's pid survives every update
})

test("applyEvent: session.deleted returns null (= remove the file)", () => {
  const prev = { session_id: "ses_a", status: "busy", pid: 42, updated_at: 100 }
  assert.equal(applyEvent(prev, { type: "session.deleted", sid: "ses_a", pid: 42, nowSec: 130 }), null)
})

test("safeName: keeps session ids filesystem-safe", () => {
  assert.equal(safeName("ses_abc-123.x"), "ses_abc-123.x")
  assert.equal(safeName("a/b\\c:d"), "a_b_c_d")
})

// Integration: drive the REAL event hook through a full session lifecycle against a
// temp config dir, asserting the on-disk file lifecycle + filtering + runtime toggle.
// This covers the hook wiring (the switch + IO) that the pure-helper tests above
// don't — the one piece that has to match how OpenCode delivers events.
test("event hook: full session lifecycle, filtering, and toggle (on disk)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gs-act-"))
  const saved = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp
  const dir = path.join(tmp, "activity")
  const read = (sid) => JSON.parse(fs.readFileSync(path.join(dir, `${sid}.json`), "utf8"))
  const exists = (sid) => fs.existsSync(path.join(dir, `${sid}.json`))
  try {
    const hooks = await GeneseedActivity()
    const fire = (type, properties) => hooks.event({ event: { type, properties } })

    // created → file with idle status, title + cwd captured from the Session
    await fire("session.created", { info: { id: "ses_1", title: "do the thing", directory: "/repo" } })
    assert.equal(read("ses_1").status, "idle")
    assert.equal(read("ses_1").title, "do the thing")
    assert.equal(read("ses_1").cwd, "/repo")

    // session.status busy → busy
    await fire("session.status", { sessionID: "ses_1", status: { type: "busy" } })
    assert.equal(read("ses_1").status, "busy")

    // assistant message → agent (mode) captured, status busy
    await fire("message.updated", { info: { role: "assistant", sessionID: "ses_1", mode: "build", path: { cwd: "/repo" } } })
    assert.equal(read("ses_1").agent, "build")

    // turn finished → waiting-input, agent preserved
    await fire("session.idle", { sessionID: "ses_1" })
    assert.equal(read("ses_1").status, "waiting-input")
    assert.equal(read("ses_1").agent, "build")

    // a child/subagent session (has parentID) is never written
    await fire("session.created", { info: { id: "ses_child", title: "sub", parentID: "ses_1", directory: "/repo" } })
    assert.equal(exists("ses_child"), false)

    // a geneseed-* throwaway distil session is never written
    await fire("session.created", { info: { id: "ses_distil", title: "geneseed-learn (auto)", directory: "/repo" } })
    assert.equal(exists("ses_distil"), false)

    // toggle OFF (write the flag the web console writes) → next event clears owned files
    fs.writeFileSync(path.join(tmp, ".geneseed-activity"), "off")
    await fire("message.part.updated", { part: { sessionID: "ses_1" } })
    assert.equal(exists("ses_1"), false)

    // toggle back ON → activity flows again
    fs.writeFileSync(path.join(tmp, ".geneseed-activity"), "on")
    await fire("session.status", { sessionID: "ses_1", status: { type: "busy" } })
    // session.status only updates a KNOWN session; after the off-clear ses_1 is gone,
    // so re-create it the way a fresh turn would, then confirm it writes.
    await fire("session.created", { info: { id: "ses_2", title: "again", directory: "/repo" } })
    assert.equal(read("ses_2").status, "idle")

    // explicit deletion removes the file
    await fire("session.deleted", { info: { id: "ses_2" } })
    assert.equal(exists("ses_2"), false)
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// Integration: the v1.1 enrichment fields land on disk from real event shapes.
test("event hook: v1.1 enrichment on disk (phase, tokens/cost, files, todos, blocked, error)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gs-act-v11-"))
  const saved = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp
  const read = () => JSON.parse(fs.readFileSync(path.join(tmp, "activity", "s.json"), "utf8"))
  try {
    const hooks = await GeneseedActivity()
    const fire = (type, properties) => hooks.event({ event: { type, properties } })

    await fire("session.created", { info: { id: "s", title: "t", directory: "/repo" } })

    // assistant message → model, agent, session token/cost totals, turn start
    await fire("message.updated", { info: {
      role: "assistant", id: "m1", sessionID: "s", mode: "build", modelID: "opus",
      path: { cwd: "/repo" }, cost: 0.5, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1000000 } } })
    let e = read()
    assert.equal(e.model, "opus"); assert.equal(e.agent, "build")
    assert.equal(e.tokens, 150); assert.equal(e.cost, 0.5)
    assert.equal(e.turn_started_at, 1000)   // ms → s

    // streaming re-fires the SAME message id → totals replace, not double-count
    await fire("message.updated", { info: {
      role: "assistant", id: "m1", sessionID: "s", mode: "build", path: { cwd: "/repo" },
      cost: 0.7, tokens: { input: 120, output: 80, reasoning: 0, cache: { read: 0, write: 0 } } } })
    e = read(); assert.equal(e.tokens, 200); assert.equal(e.cost, 0.7)

    // a running tool sets the live phase
    await fire("message.part.updated", { part: {
      type: "tool", sessionID: "s", tool: "edit",
      state: { status: "running", title: "Editing Activity.jsx", input: {}, time: { start: 1 } } } })
    assert.equal(read().phase, "Editing Activity.jsx")

    // session summary → files touched + churn
    await fire("session.updated", { info: { id: "s", title: "t", directory: "/repo",
      summary: { files: 2, additions: 30, deletions: 5, diffs: [{ file: "a.js", additions: 20, deletions: 2, before: "", after: "" }] } } })
    e = read(); assert.equal(e.files.count, 2); assert.equal(e.files.additions, 30); assert.equal(e.files.items[0].file, "a.js")

    // todos → done/total
    await fire("todo.updated", { sessionID: "s", todos: [
      { id: "1", content: "a", status: "completed", priority: "high" },
      { id: "2", content: "b", status: "pending", priority: "low" } ] })
    e = read(); assert.equal(e.todos.done, 1); assert.equal(e.todos.total, 2)

    // permission pending → blocked; replied → unblocked
    await fire("permission.updated", { id: "p1", sessionID: "s", title: "bash: rm", type: "bash", messageID: "m", metadata: {}, time: { created: 1 } })
    assert.equal(read().status, "blocked"); assert.equal(read().blocked_on, "bash: rm")
    await fire("permission.replied", { sessionID: "s", permissionID: "p1", response: "allow" })
    e = read(); assert.equal(e.status, "busy"); assert.equal(e.blocked_on, null)

    // tool error and session error both surface a readable string
    await fire("message.part.updated", { part: { type: "tool", sessionID: "s", tool: "bash",
      state: { status: "error", error: "exit 1", input: {}, time: { start: 1, end: 2 } } } })
    assert.equal(read().error, "exit 1")
    await fire("session.error", { sessionID: "s", error: { name: "APIError", data: { message: "boom" } } })
    assert.equal(read().error, "boom")

    // idle stops the clock and clears the phase
    await fire("session.idle", { sessionID: "s" })
    e = read(); assert.equal(e.status, "waiting-input"); assert.equal(e.phase, null); assert.equal(e.turn_started_at, null)
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// Integration: the v1.2 detail file gets a step timeline + uncapped files/todos,
// and is removed with the session.
test("event hook: v1.2 detail timeline on disk", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gs-act-v12-"))
  const saved = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp
  const detail = () => JSON.parse(fs.readFileSync(path.join(tmp, "activity", "s.detail.json"), "utf8"))
  const detailExists = () => fs.existsSync(path.join(tmp, "activity", "s.detail.json"))
  try {
    const hooks = await GeneseedActivity()
    const fire = (type, properties) => hooks.event({ event: { type, properties } })
    await fire("session.created", { info: { id: "s", title: "t", directory: "/repo" } })

    // a completed tool → a timeline record with duration (force-flushed)
    await fire("message.part.updated", { part: {
      type: "tool", sessionID: "s", callID: "c1", tool: "edit",
      state: { status: "completed", title: "Editing a.js", input: {}, output: "ok", metadata: {}, time: { start: 1000, end: 2500 } } } })
    let d = detail()
    const tool = d.timeline.find((r) => r.kind === "tool")
    assert.equal(tool.label, "Editing a.js"); assert.equal(tool.status, "completed"); assert.equal(tool.ms, 1500)

    // streaming text re-fires the SAME part id → one record, updated in place (no flood)
    await fire("message.part.updated", { part: { type: "text", id: "t1", sessionID: "s", text: "Hello" } })
    await fire("message.part.updated", { part: { type: "text", id: "t1", sessionID: "s", text: "Hello world, here is the plan" } })
    await fire("session.idle", { sessionID: "s" })   // force flush
    d = detail()
    const texts = d.timeline.filter((r) => r.kind === "text")
    assert.equal(texts.length, 1); assert.equal(texts[0].snippet, "Hello world, here is the plan")

    // step-finish carries tokens/cost; subtask names the agent
    await fire("message.part.updated", { part: { type: "step-finish", id: "sf1", sessionID: "s", reason: "stop", cost: 0.2, tokens: { input: 100, output: 40, reasoning: 0, cache: { read: 0, write: 0 } } } })
    await fire("message.part.updated", { part: { type: "subtask", id: "st1", sessionID: "s", prompt: "x", description: "review the diff", agent: "reviewer" } })
    d = detail()
    assert.equal(d.timeline.find((r) => r.kind === "step").tokens, 140)
    assert.equal(d.timeline.find((r) => r.kind === "subtask").agent, "reviewer")

    // uncapped files/todos live in the detail file
    await fire("session.updated", { info: { id: "s", title: "t", directory: "/repo",
      summary: { files: 1, additions: 9, deletions: 1, diffs: [{ file: "a.js", additions: 9, deletions: 1, before: "", after: "" }] } } })
    assert.equal(detail().files.items[0].file, "a.js")

    // deletion removes the detail file too
    await fire("session.deleted", { info: { id: "s" } })
    assert.equal(detailExists(), false)
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// Conversation transcript (compact timeline): chat.message appends user turns,
// streaming assistant text appends/updates assistant turns — an ordered list on disk.
test("chat.message + text → full conversation transcript in the detail file", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gs-act-conv-"))
  const saved = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp
  const conv = () => JSON.parse(fs.readFileSync(path.join(tmp, "activity", "s.detail.json"), "utf8")).conversation
  try {
    const hooks = await GeneseedActivity()
    const fire = (type, properties) => hooks.event({ event: { type, properties } })
    await fire("session.created", { info: { id: "s", title: "t", directory: "/repo" } })

    // user → assistant (streams, same messageID updates in place) → user
    await hooks["chat.message"]({ sessionID: "s", messageID: "u1" }, { parts: [{ type: "text", text: "add a toggle" }] })
    await fire("message.part.updated", { part: { type: "text", id: "p1", messageID: "a1", sessionID: "s", text: "added" } })
    await fire("message.part.updated", { part: { type: "text", id: "p1", messageID: "a1", sessionID: "s", text: "done — added the switch" } })
    await hooks["chat.message"]({ sessionID: "s", messageID: "u2" }, { parts: [{ type: "text", text: "now make it 50/50" }] })

    const c = conv()
    assert.equal(c.length, 3)                                  // a1 streamed once, not per delta
    assert.deepEqual(c.map((m) => m.role), ["user", "assistant", "user"])
    assert.equal(c[0].text, "add a toggle")
    assert.equal(c[1].text, "done — added the switch")         // latest snippet of the assistant turn
    assert.equal(c[2].text, "now make it 50/50")

    // a child/unowned session is ignored
    await hooks["chat.message"]({ sessionID: "ghost", messageID: "x" }, { parts: [{ type: "text", text: "x" }] })
    assert.ok(!fs.existsSync(path.join(tmp, "activity", "ghost.detail.json")))
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
