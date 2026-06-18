// Tests for the activity plugin's pure logic — session-id extraction across event
// shapes, the status transition table, and the entry reducer. The `event` hook is a
// thin wrapper that extracts fields and persists; the filesystem IO (atomic write,
// prune) is a side effect, covered on the reader side (tests/test_web.py). Run from
// the Geneseed root:
//   node --test tests/activity.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import GeneseedActivity from "../adapters/opencode/plugins/geneseed-activity.js"
const { sidOf, nextStatus, applyEvent, safeName } = GeneseedActivity

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
