// Tests for the activity plugin's pure logic — session-id extraction across event
// shapes, the status transition table, and the entry reducer. The `event` hook is a
// thin wrapper that extracts fields and persists; the filesystem IO (atomic write,
// prune) is a side effect, covered on the reader side (tests/test_web.py). Run from
// the Geneseed root:
//   node --test tests/plugins/activity.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import { GeneseedActivity } from "../../adapters/opencode/plugins/geneseed-activity.js"
import { makeSandbox } from "../helpers/sandbox.mjs";
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
  const tmp = makeSandbox("gs-act-").path
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
  const tmp = makeSandbox("gs-act-v11-").path
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

    // a session summary carrying diffs → files touched + churn, counted from the diff list
    // itself (its own files/additions/deletions counts are not read: one writer per value)
    await fire("session.updated", { info: { id: "s", title: "t", directory: "/repo",
      summary: { files: 2, additions: 30, deletions: 5, diffs: [{ file: "a.js", additions: 20, deletions: 2, before: "", after: "" }] } } })
    e = read(); assert.equal(e.files.count, 1); assert.equal(e.files.additions, 20); assert.equal(e.files.items[0].file, "a.js")

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

// Integration: files touched on OpenCode 1.19.x. The session summary there is always
// {additions:0, deletions:0, files:0} and session.diff always `diff: []`
// (session/summary.ts at v1.19.4); the real diffs ride the USER message's
// summary.diffs, recomputed after every step of that turn from its first step-start to
// its latest step-finish snapshot. So the same user message replaces its diffs (the turn
// grew), a new one adds per file (a new turn, a new baseline), and the zeroed session
// events change nothing. Each row states what the card must show after that event.
test("event hook: files from user-message summary.diffs (OpenCode 1.19 shape)", async () => {
  const tmp = makeSandbox("gs-act-diffs-").path
  const saved = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp
  const read = () => JSON.parse(fs.readFileSync(path.join(tmp, "activity", "s.json"), "utf8"))
  const detail = () => JSON.parse(fs.readFileSync(path.join(tmp, "activity", "s.detail.json"), "utf8"))
  try {
    const hooks = await GeneseedActivity({ worktree: tmp })
    const fire = (type, properties) => hooks.event({ event: { type, properties } })
    const user =(id, summary) => fire("message.updated", { sessionID: "s", info: {
      id, sessionID: "s", role: "user", time: { created: 1 }, agent: "build",
      model: { providerID: "p", modelID: "m" }, ...(summary ? { summary } : {}) } })
    const diff = (file, additions, deletions) => ({ file, additions, deletions, patch: "@@ -1 +1 @@", status: "modified" })
    const zeroed = async () => {
      await fire("session.updated", { info: { id: "s", title: "t", directory: "/repo", summary: { additions: 0, deletions: 0, files: 0 } } })
      await fire("session.diff", { sessionID: "s", diff: [] })
    }
    await fire("session.created", { info: { id: "s", title: "t", directory: "/repo" } })

    const rows = [
      // [what happens, the event, files.count, additions, deletions, [file, additions, deletions] per item]
      ["u1 is created without a summary: nothing to show yet", () => user("u1"), undefined],
      ["u1 step 1: zeroed session + empty diff list", async () => { await zeroed(); await user("u1", { diffs: [] }) }, 0, 0, 0, []],
      ["u1 after step 1: one file", async () => { await zeroed(); await user("u1", { diffs: [diff("src/a.js", 3, 1)] }) }, 1, 3, 1, [["src/a.js", 3, 1]]],
      ["u1 after step 2: the turn grew, so it replaces", async () => { await zeroed(); await user("u1", { diffs: [diff("src/a.js", 5, 1)] }) }, 1, 5, 1, [["src/a.js", 5, 1]]],
      ["u2 step 1: an empty new turn keeps u1", async () => { await zeroed(); await user("u2", { diffs: [] }) }, 1, 5, 1, [["src/a.js", 5, 1]]],
      ["u2 after step 1: same file adds, new file joins", async () => { await zeroed(); await user("u2", { diffs: [diff("src/a.js", 2, 2), diff("b.md", 4, 0)] }) }, 2, 11, 3, [["src/a.js", 7, 3], ["b.md", 4, 0]]],
      ["the zeroed session events alone change nothing", zeroed, 2, 11, 3, [["src/a.js", 7, 3], ["b.md", 4, 0]]],
      ["a user message without a diffs array keeps its turn", () => user("u2", { title: "x" }), 2, 11, 3, [["src/a.js", 7, 3], ["b.md", 4, 0]]],
      // /undo: SessionRevert.cleanup removes the reverted messages, so their turns drop out
      ["/undo removes u2: its diffs drop out", () => fire("message.removed", { sessionID: "s", messageID: "u2" }), 1, 5, 1, [["src/a.js", 5, 1]]],
      ["/undo removes u1 too: no turn left, nothing touched", () => fire("message.removed", { sessionID: "s", messageID: "u1" }), 0, 0, 0, []],
    ]
    for (const [what, act, count, additions, deletions, items] of rows) {
      await act()
      const f = read().files
      if (count === undefined) { assert.equal(f, undefined, what); continue }
      assert.equal(f.count, count, what)
      assert.equal(f.additions, additions, what)
      assert.equal(f.deletions, deletions, what)
      // `path` is OpenCode's own worktree-relative path, `file` its basename, `by` null for the
      // session itself, and nothing else: no patch text reaches the disk
      const want = items.map(([p, a, d]) => ({ file: path.posix.basename(p), path: p, additions: a, deletions: d, by: null }))
      assert.deepEqual(f.items, want, what)
      assert.deepEqual(detail().files.items, want, what)
    }
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// Integration: a turn reported with no session-wide list ever seen, then undone. With no
// turn left and no fallback list, the card shows nothing touched (and the hook must not throw).
test("event hook: removing the last turn with no session.diff ever seen", async () => {
  const tmp = makeSandbox("gs-act-rm-").path
  const saved = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp
  const read = () => JSON.parse(fs.readFileSync(path.join(tmp, "activity", "s.json"), "utf8"))
  try {
    const hooks = await GeneseedActivity()
    const fire = (type, properties) => hooks.event({ event: { type, properties } })
    await fire("session.created", { info: { id: "s", title: "t", directory: "/repo" } })
    await fire("message.updated", { info: { id: "u1", sessionID: "s", role: "user", summary: { diffs: [{ file: "a.js", additions: 1, deletions: 0 }] } } })
    assert.equal(read().files.count, 1)
    await fire("message.removed", { sessionID: "s", messageID: "u1" })
    assert.deepEqual(read().files, { count: 0, additions: 0, deletions: 0, items: [] })
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// Integration: OpenCode 1.3.x sends the session-wide diff on session.diff. It is the
// fallback source, used only while no user-message diffs have arrived for the session.
test("event hook: session.diff is the fallback files source (OpenCode 1.3 shape)", async () => {
  const tmp = makeSandbox("gs-act-sdiff-").path
  const saved = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp
  const read = () => JSON.parse(fs.readFileSync(path.join(tmp, "activity", "s.json"), "utf8"))
  try {
    const hooks = await GeneseedActivity({ worktree: tmp })
    const fire = (type, properties) => hooks.event({ event: { type, properties } })
    const item = (file, additions, deletions) => ({ file, path: file, additions, deletions, by: null })
    await fire("session.created", { info: { id: "s", title: "t", directory: "/repo" } })
    await fire("session.diff", { sessionID: "s", diff: [{ file: "a.js", additions: 9, deletions: 1, patch: "x" }] })
    assert.deepEqual(read().files, { count: 1, additions: 9, deletions: 1, items: [item("a.js", 9, 1)] })
    // an empty session-wide list is the truth (every change undone), not a gap
    await fire("session.diff", { sessionID: "s", diff: [] })
    assert.deepEqual(read().files, { count: 0, additions: 0, deletions: 0, items: [] })
    await fire("session.diff", { sessionID: "s", diff: [{ file: "a.js", additions: 9, deletions: 1, patch: "x" }] })
    // a session summary without diffs (1.3 counts only, 1.19 zeroed) is no source at all
    await fire("session.updated", { info: { id: "s", title: "t", directory: "/repo", summary: { additions: 0, deletions: 0, files: 0 } } })
    assert.equal(read().files.count, 1)
    // once a user message carries diffs, they win over the session-wide list
    await fire("message.updated", { info: { id: "u1", sessionID: "s", role: "user", summary: { diffs: [{ file: "b.js", additions: 2, deletions: 0 }] } } })
    await fire("session.diff", { sessionID: "s", diff: [{ file: "a.js", additions: 9, deletions: 1 }] })
    assert.deepEqual(read().files, { count: 1, additions: 2, deletions: 0, items: [item("b.js", 2, 0)] })
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// Integration: the v1.2 detail file gets a step timeline + uncapped files/todos,
// and is removed with the session.
test("event hook: v1.2 detail timeline on disk", async () => {
  const tmp = makeSandbox("gs-act-v12-").path
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
  const tmp = makeSandbox("gs-act-conv-").path
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

// ---- snapshot v2 (the Activity garden) ----------------------------------------------
// One sandboxed config dir per test, the plugin built with `input` (V1's factory input), and
// readers for the session's card and detail file.
async function withPlugin(prefix, input, fn) {
  const tmp = makeSandbox(prefix).path
  const saved = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp
  const file = (sid, ext = "json") => path.join(tmp, "activity", `${sid}.${ext}`)
  try {
    const hooks = await GeneseedActivity(input)
    await fn({
      hooks,
      fire: (type, properties) => hooks.event({ event: { type, properties } }),
      read: (sid = "s") => JSON.parse(fs.readFileSync(file(sid), "utf8")),
      detail: (sid = "s") => JSON.parse(fs.readFileSync(file(sid, "detail.json"), "utf8")),
      exists: (sid) => fs.existsSync(file(sid)),
    })
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// A sub-agent is a child session (`task` creates it with `parentID` and `agent`, v1.19.4
// tool/task.ts). It gets no card of its own: it becomes a row of its root session's `agents`,
// running while the child is busy and done when the child goes idle (not when the parent's
// `task` part completes: with background=true that part completes at once while the child
// still runs, and a resumed task_id runs the same child again). The child's own user-message
// diffs fold into the parent's files with `by` = the child id. The parent's own turn diff is a
// snapshot of the whole worktree that spans the `task` run, so it repeats the child's files:
// a path a sub-agent reported leaves the parent's `by: null` rows of the turn the child was
// launched in and of every later turn (else every sub-agent edit would be drawn twice, and a
// session would collide with itself). A parent edit from a turn BEFORE the launch stays the
// parent's. Turn order is the message id order (OpenCode ids ascend).
test("event hook: a child session is a sub-agent of its parent, with its own files", async () => {
  await withPlugin("gs-act-child-", { worktree: "/w" }, async ({ fire, read, detail, exists }) => {
    const user = (sid, id, diffs) => fire("message.updated", { info: { id, sessionID: sid, role: "user", summary: { diffs } } })
    const diff = (file, additions, deletions) => ({ file, additions, deletions, patch: "@@" })
    const item = (p, a, d, by) => ({ file: path.posix.basename(p), path: p, additions: a, deletions: d, by })
    await fire("session.created", { info: { id: "s", title: "t", directory: "/w" } })
    const rows = [
      // [what happens, the act, agents as [id, type, status], files.items (null: unchanged)]
      ["the parent alone: no agents yet", async () => {}, [], undefined],
      ["the parent's turn msg_1 edits src/x.js itself",
        () => user("s", "msg_1", [diff("src/x.js", 1, 0)]), [], [item("src/x.js", 1, 0, null)]],
      ["the parent's turn msg_2 starts (no diffs yet)",
        () => fire("message.updated", { info: { id: "msg_2", sessionID: "s", role: "user" } }), [], null],
      ["task creates child c1 (agent explore) in turn msg_2: a running branch, no card of its own",
        () => fire("session.created", { info: { id: "c1", parentID: "s", agent: "explore", title: "look (@explore subagent)", directory: "/w", time: { created: 5000 } } }),
        [["c1", "explore", "running"]], null],
      ["c1 busy: still running", () => fire("session.status", { sessionID: "c1", status: { type: "busy" } }), [["c1", "explore", "running"]], null],
      ["c1's turn diff: its file is attributed to c1",
        () => user("c1", "msg_3", [diff("src/x.js", 4, 1)]),
        [["c1", "explore", "running"]], [item("src/x.js", 1, 0, null), item("src/x.js", 4, 1, "c1")]],
      ["the parent's msg_2 snapshot repeats c1's file: dropped there, the msg_1 edit stays the parent's",
        () => user("s", "msg_2", [diff("src/x.js", 5, 1), diff("src/y.js", 2, 0)]),
        [["c1", "explore", "running"]], [item("src/x.js", 1, 0, null), item("src/x.js", 4, 1, "c1"), item("src/y.js", 2, 0, null)]],
      ["c1 goes idle: done", () => fire("session.idle", { sessionID: "c1" }), [["c1", "explore", "done"]], null],
      ["c1 resumed (task_id): running again", () => fire("session.status", { sessionID: "c1", status: { type: "busy" } }), [["c1", "explore", "running"]], null],
      ["a nested child c2 of c1 is a branch of the root session",
        () => fire("session.created", { info: { id: "c2", parentID: "c1", directory: "/w" } }),
        [["c1", "explore", "running"], ["c2", null, "running"]], null],
      ["c2's files are attributed to c2",
        () => user("c2", "msg_4", [diff("lib/z.md", 1, 0)]),
        [["c1", "explore", "running"], ["c2", null, "running"]],
        [item("src/x.js", 1, 0, null), item("src/x.js", 4, 1, "c1"), item("src/y.js", 2, 0, null), item("lib/z.md", 1, 0, "c2")]],
      ["/undo in c1 drops c1's turn: the parent's msg_2 copy of its file is back on the trunk",
        () => fire("message.removed", { sessionID: "c1", messageID: "msg_3" }),
        [["c1", "explore", "running"], ["c2", null, "running"]],
        [item("src/x.js", 6, 1, null), item("src/y.js", 2, 0, null), item("lib/z.md", 1, 0, "c2")]],
    ]
    let files
    for (const [what, act, agents, items] of rows) {
      const before = read().status
      await act()
      const e = read()
      assert.deepEqual(e.agents.map((a) => [a.id, a.type, a.status]), agents, what)
      if (agents.length) assert.deepEqual(detail().agents, e.agents, what)   // the detail file carries the same list
      if (items !== null) files = items
      assert.deepEqual(e.files?.items, files, what)
      // a child's events never move the parent's status (only the parent's own row may)
      if (!what.startsWith("the parent")) assert.equal(e.status, before, what)
    }
    assert.equal(read().agents[0].started, 5)                  // the child's own creation time, in seconds
    for (const sid of ["c1", "c2"]) assert.equal(exists(sid), false)

    // still skipped: a geneseed-* throwaway (even as a child), and a child of an unknown parent
    await fire("session.created", { info: { id: "g", parentID: "s", title: "geneseed-learn (auto)", directory: "/w" } })
    await fire("session.created", { info: { id: "o", parentID: "ghost", directory: "/w" } })
    await fire("message.updated", { info: { id: "msg_9", sessionID: "o", role: "user", summary: { diffs: [diff("q.js", 1, 1)] } } })
    assert.deepEqual(read().agents.map((a) => a.id), ["c1", "c2"])
    for (const sid of ["g", "o", "ghost"]) assert.equal(exists(sid), false)
  })
})

// `turns` counts user prompts: chat.message fires once per prompt (v1.19.4
// session/prompt.ts), while message.updated re-fires for one message and compaction writes
// synthetic user messages of its own. So the count is the distinct prompt ids of the session.
// A prompt made only of synthetic parts is not the user's: a background `task` hands its
// result back that way (TaskTool.injectBackgroundResult).
test("event hook: turns count the distinct user prompts", async () => {
  await withPlugin("gs-act-turns-", { worktree: "/w" }, async ({ hooks, fire, read }) => {
    const prompt = (sid, messageID) => hooks["chat.message"]({ sessionID: sid, messageID }, { parts: [{ type: "text", text: "go" }] })
    await fire("session.created", { info: { id: "s", title: "t", directory: "/w" } })
    await fire("session.created", { info: { id: "c", parentID: "s", directory: "/w" } })
    const rows = [
      ["a new session has had no turn", async () => {}, 0],
      ["first prompt", () => prompt("s", "u1"), 1],
      ["the same prompt id again", () => prompt("s", "u1"), 1],
      ["second prompt", () => prompt("s", "u2"), 2],
      ["a prompt with no text still counts", () => hooks["chat.message"]({ sessionID: "s", messageID: "u3" }, { parts: [] }), 3],
      ["a sub-agent's prompt is not the user's", () => prompt("c", "cu1"), 3],
      ["a background task's result (synthetic parts only) is not a turn",
        () => hooks["chat.message"]({ sessionID: "s", messageID: "u4" }, { parts: [{ type: "text", text: "result", synthetic: true }] }), 3],
      ["a real part beside a synthetic one is a turn",
        () => hooks["chat.message"]({ sessionID: "s", messageID: "u5" }, { parts: [{ type: "agent", name: "x" }, { type: "text", text: "use x", synthetic: true }] }), 4],
      ["a user message.updated (or a compaction message) is not a prompt", () => fire("message.updated", { info: { id: "u9", sessionID: "s", role: "user" } }), 4],
    ]
    for (const [what, act, turns] of rows) { await act(); assert.equal(read().turns, turns, what) }
  })
})

// `context` is the last assistant message's input + cache tokens: OpenCode's `input` already
// excludes the cache (v1.19.4 session.ts getUsage; V2 core session/usage.ts sums the same
// three for its own context figure). The window is not on the event, so it is the contract's
// estimate: 200 000, or 1 000 000 once more than 200 000 are used.
test("event hook: context is the last assistant message's input + cache tokens", async () => {
  await withPlugin("gs-act-ctx-", { worktree: "/w" }, async ({ fire, read }) => {
    const reply = (sid, id, input, cacheRead, cacheWrite, extra = {}) => fire("message.updated", { info: {
      role: "assistant", id, sessionID: sid, mode: "build", ...extra,
      tokens: { input, output: 999, reasoning: 0, cache: { read: cacheRead, write: cacheWrite } } } })
    await fire("session.created", { info: { id: "s", title: "t", directory: "/w" } })
    await fire("session.created", { info: { id: "c", parentID: "s", directory: "/w" } })
    const rows = [
      ["a new session has no context yet", async () => {}, null],
      ["input + cache.read + cache.write, output left out", () => reply("s", "a1", 1000, 5000, 200), { used: 6200, window: 200000 }],
      ["a new message's first update carries zero tokens: kept", () => reply("s", "a2", 0, 0, 0), { used: 6200, window: 200000 }],
      ["the compaction summary's input is the old conversation: skipped", () => reply("s", "a3", 150000, 90000, 0, { summary: true }), { used: 6200, window: 200000 }],
      ["a sub-agent's context is its own: skipped", () => reply("c", "ca1", 50000, 0, 0), { used: 6200, window: 200000 }],
      ["past 200 000 the window is the 1M one", () => reply("s", "a4", 10000, 240000, 1000), { used: 251000, window: 1000000 }],
    ]
    for (const [what, act, context] of rows) { await act(); assert.deepEqual(read().context, context, what) }
  })
})

// session.compacted (v1.19.4 session/compaction.ts, `{ sessionID }`) counts a compaction,
// stamps its time and keeps the context it cut from. The context now is unknown until the next
// assistant message, so it is null. It changes no status: a compaction runs inside a busy
// turn, and must not show the session as idle.
test("event hook: a compaction is counted and keeps the context it cut", async () => {
  await withPlugin("gs-act-compact-", { worktree: "/w" }, async ({ fire, read }) => {
    await fire("session.created", { info: { id: "s", title: "t", directory: "/w" } })
    let e = read()
    assert.deepEqual([e.compactions, e.compacted_at, e.context_at_compaction], [0, null, null])
    await fire("session.status", { sessionID: "s", status: { type: "busy" } })
    await fire("message.updated", { info: { role: "assistant", id: "a1", sessionID: "s", tokens: { input: 100, output: 1, reasoning: 0, cache: { read: 180000, write: 0 } } } })
    const before = Math.floor(Date.now() / 1000)
    await fire("session.compacted", { sessionID: "s" })
    e = read()
    assert.equal(e.compactions, 1)
    assert.ok(e.compacted_at >= before && e.compacted_at <= before + 2)
    assert.equal(e.context_at_compaction, 180100)
    assert.equal(e.context, null)
    assert.equal(e.status, "busy")
    await fire("message.updated", { info: { role: "assistant", id: "a2", sessionID: "s", tokens: { input: 9000, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } })
    await fire("session.compacted", { sessionID: "s" })
    e = read()
    assert.equal(e.compactions, 2)
    assert.equal(e.context_at_compaction, 9000)
  })
})

// `root` is OpenCode's own `worktree` input (v1.19.4: the top level of the opened directory's
// checkout, so a linked worktree is its own root; "/" for a project outside a repository).
// `repo` is the main checkout, read the way js/hosts/gitref.mjs mainWorktreeOf reads it, and
// the root itself on a main checkout. Pinned against gitref on a fixture tree: a main repo and
// a linked worktree whose `.git` FILE names `<main>/.git/worktrees/wt`. On Windows the
// worktree arrives with forward slashes, so that is the form fed in.
test("root/repo: OpenCode's worktree, and the main checkout as js/hosts/gitref.mjs finds them", async () => {
  const { gitRootOf, mainWorktreeOf } = await import("../../js/hosts/gitref.mjs")
  const box = makeSandbox("gs-act-root-").path
  try {
    const main = path.join(box, "main"), wt = path.join(box, "wt"), sub = path.join(wt, "src")
    fs.mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true })
    fs.writeFileSync(path.join(main, ".git", "worktrees", "wt", "commondir"), "../..\n")
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`)
    const slash = (p) => p.replace(/\\/g, "/")
    assert.equal(mainWorktreeOf(sub), main)    // the fixture is a real linked worktree to gitref
    const rows = [
      // [what, worktree input, root, repo]
      ["a linked worktree", slash(wt), gitRootOf(sub), mainWorktreeOf(sub)],
      ["the main checkout is its own repo", slash(main), gitRootOf(main), gitRootOf(main)],
      ["outside a repository OpenCode passes '/'", "/", null, null],
      ["the drive root is no repo either", path.parse(box).root, null, null],
      ["no input at all", undefined, null, null],
    ]
    for (const [what, worktree, root, repo] of rows) {
      await withPlugin("gs-act-root-run-", worktree === undefined ? undefined : { worktree }, async ({ fire, read }) => {
        await fire("session.created", { info: { id: "s", title: "t", directory: worktree } })
        assert.deepEqual([read().root, read().repo], [root, repo], what)
      })
    }
  } finally { fs.rmSync(box, { recursive: true, force: true }) }
})

// A file whose path cannot be stored relative to the root has `path: null` and only its
// basename in `file` (never an absolute path, and never a basename in `path`, where it would
// collide with a same-named file at the top of the repository). With no root at all every
// path is null. Such rows still merge on OpenCode's own raw path, so two files of one name
// stay two rows.
test("event hook: a path outside the root, or with no root, is null", async () => {
  for (const [what, input, raws, want] of [
    // [what, factory input, raw FileDiff files, [file, path] per item]
    ["inside the root", { worktree: "/w" }, ["src/a.js"], [["a.js", "src/a.js"]]],
    ["a '../' path", { worktree: "/w" }, ["../other/b.js"], [["b.js", null]]],
    ["an absolute path", { worktree: "/w" }, ["/etc/c.conf"], [["c.conf", null]]],
    ["a drive path", { worktree: "/w" }, ["C:\\x\\c.conf"], [["c.conf", null]]],
    ["a UNC path", { worktree: "/w" }, ["\\\\srv\\share\\c.conf"], [["c.conf", null]]],
    ["backslashes become '/'", { worktree: "/w" }, ["src\\d.js"], [["d.js", "src/d.js"]]],
    ["no root", undefined, ["src/e.js"], [["e.js", null]]],
    ["no root: two files of one name stay two rows", undefined, ["src/a.js", "lib/a.js"], [["a.js", null], ["a.js", null]]],
  ]) {
    await withPlugin("gs-act-rel-", input, async ({ fire, read }) => {
      await fire("session.created", { info: { id: "s", title: "t", directory: "/w" } })
      await fire("message.updated", { info: { id: "u", sessionID: "s", role: "user", summary: { diffs: raws.map((file) => ({ file, additions: 1, deletions: 0 })) } } })
      assert.deepEqual(read().files.items.map((f) => [f.file, f.path]), want, what)
    })
  }
})

// The plugin's fs-only readers are twins of js/hosts/gitref.mjs (a plugin cannot import js/).
// Compared like the guard's twins (tests/plugins/guard.test.mjs): each function cut out by
// brace matching, with comments, semicolons, quote style and whitespace folded away.
test("the activity plugin's repository readers match their js/hosts/gitref.mjs originals", () => {
  const fn = (src, name) => {
    const b = src.indexOf(`function ${name}(`)
    assert.ok(b >= 0, `${name} missing`)
    let i = src.indexOf("{", b), depth = 0
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}" && --depth === 0) break
    }
    return src.slice(b, i + 1)
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      .replace(/'/g, '"').replace(/;/g, "").replace(/\s+/g, "")
  }
  const ref = fs.readFileSync(path.join(process.cwd(), "js/hosts/gitref.mjs"), "utf8")
  const mine = fs.readFileSync(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-activity.js"), "utf8")
  for (const name of ["gitRootOf", "gitDirOf", "mainWorktreeOf"]) {
    assert.equal(fn(mine, name), fn(ref, name), `the activity plugin's ${name} drifted from js/hosts/gitref.mjs`)
  }
})
