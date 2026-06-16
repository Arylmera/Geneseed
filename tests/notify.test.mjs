// Tests for the notify plugin's decision logic — the pure `shouldNotify` gate and the
// `lastUserMs` transcript reader. The actual OS notification (spawn) is a side effect
// and is not unit-tested; all the meaningful logic lives in these two helpers. Run
// from the Geneseed root:
//   node --test tests/notify.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { shouldNotify, lastUserMs } from "../adapters/opencode/plugins/geneseed-notify.js"

const MIN = 30_000

test("shouldNotify: a long top-level turn notifies", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 100_000 - 60_000, parentID: undefined, title: "build", minMs: MIN }),
    true)
})

test("shouldNotify: a quick turn (under the threshold) stays silent", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 100_000 - 2_000, parentID: undefined, title: "chat", minMs: MIN }),
    false)
})

test("shouldNotify: a subagent child session never notifies", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 0, parentID: "parent-1", title: "x", minMs: MIN }),
    false)
})

test("shouldNotify: a geneseed-* throwaway session never notifies", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 0, parentID: undefined, title: "geneseed-learn (auto)", minMs: MIN }),
    false)
})

test("shouldNotify: unknown turn length errs toward notifying (opt-in)", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: null, parentID: undefined, title: "x", minMs: MIN }),
    true)
})

test("shouldNotify: minMs=0 means always notify a top-level turn", () => {
  assert.equal(
    shouldNotify({ now: 100_000, lastUserMs: 100_000, parentID: undefined, title: "x", minMs: 0 }),
    true)
})

test("lastUserMs: picks the latest user message's created time across time shapes", () => {
  const messages = [
    { info: { role: "user", time: { created: 10 } } },
    { info: { role: "assistant", time: { created: 20 } } },
    { info: { role: "user", time: { created: 30 } } },   // latest user
    { info: { role: "assistant", time: { created: 40 } } },
  ]
  assert.equal(lastUserMs(messages), 30)
  assert.equal(lastUserMs([{ info: { role: "user", created: 7 } }]), 7)   // flat `created`
})

test("lastUserMs: null when there is no user message or bad input", () => {
  assert.equal(lastUserMs([{ info: { role: "assistant", time: { created: 5 } } }]), null)
  assert.equal(lastUserMs(null), null)
})
