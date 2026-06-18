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
const { sidOf, nextStatus, applyEvent, safeName, enabledFromFlag } = GeneseedActivity

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
