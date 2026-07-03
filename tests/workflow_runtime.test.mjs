// Unit tests for the workflow runtime core — orchestration logic only, against a mock
// SDK client (no live OpenCode). Run from the Geneseed root:
//   node --test tests/workflow_runtime.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createRuntime, createLimiter, validateSchema, extractJson,
} from "../adapters/opencode/workflows/_runtime.js"

// A mock plugin `client`: each prompt records itself, tracks live concurrency, and
// replies via the supplied responder. `reply(text, callIndex)` returns the reply text.
function mockClient(responder) {
  let nextId = 1, active = 0, maxActive = 0
  const calls = []
  const delay = responder.delay || (() => 2)
  return {
    stats: () => ({ maxActive, calls }),
    session: {
      create: async () => ({ id: `s${nextId++}` }),
      prompt: async ({ body }) => {
        active++; maxActive = Math.max(maxActive, active)
        const text = body.parts[0].text
        calls.push(text)
        await new Promise((r) => setTimeout(r, delay(text)))
        active--
        return { parts: [{ type: "text", text: responder.reply(text, calls.length) }] }
      },
      messages: async () => [],
      delete: async () => {},
    },
  }
}

test("concurrency cap bounds in-flight child sessions", async () => {
  const client = mockClient({ delay: () => 10, reply: () => "ok" })
  const rt = createRuntime({ client, concurrency: 2 })
  const out = await rt.parallel(Array.from({ length: 6 }, (_, i) => () => rt.agent(`p${i}`)))
  assert.equal(out.length, 6)
  assert.ok(out.every((x) => x === "ok"))
  assert.ok(client.stats().maxActive <= 2, `maxActive was ${client.stats().maxActive}`)
})

test("schema validation retries then returns the parsed object", async () => {
  const client = mockClient({ reply: (_t, n) => (n === 1 ? "not json at all" : '{"ok":true}') })
  const rt = createRuntime({ client })
  const res = await rt.agent("do it", { schema: (v) => v?.ok === true || "need ok=true" })
  assert.deepEqual(res, { ok: true })
  assert.equal(client.stats().calls.length, 2) // one bad + one good
})

test("schema unmet after all retries returns null (3 attempts)", async () => {
  const client = mockClient({ reply: () => "never valid" })
  const rt = createRuntime({ client })
  const res = await rt.agent("do it", { schema: (v) => v?.ok === true || "need ok" })
  assert.equal(res, null)
  assert.equal(client.stats().calls.length, 3) // initial + 2 retries
})

test("pipeline drops a throwing item's stage to null, keeps others", async () => {
  const client = mockClient({ reply: () => "ok" })
  const rt = createRuntime({ client })
  const out = await rt.pipeline(
    [1, 2, 3],
    (x) => { if (x === 2) throw new Error("boom"); return x * 10 },
    (x) => x + 1,
  )
  assert.deepEqual(out, [11, null, 31])
})

test("pipeline has no barrier between stages (fast item finishes first)", async () => {
  const client = mockClient({ reply: () => "ok" })
  const rt = createRuntime({ client })
  const done = []
  const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))
  await rt.pipeline(
    ["slow", "fast"],
    (x) => wait(x === "slow" ? 40 : 1, x), // stage 1: slow item lags
    (x) => wait(1, x),                      // stage 2
    (x) => { done.push(x); return x },      // stage 3: record completion order
  )
  assert.deepEqual(done, ["fast", "slow"]) // fast cleared all 3 stages before slow's stage 1
})

test("parallel and pipeline item caps are each enforced", async () => {
  const client = mockClient({ reply: () => "ok" })
  const rt = createRuntime({ client })
  // Anchored regexes: /item cap/ alone would let one function's cap silently
  // regress while the other's still matches.
  await assert.rejects(() => rt.parallel(new Array(4097).fill(() => 0)), /parallel\(\) item cap/)
  await assert.rejects(() => rt.pipeline(new Array(4097).fill(0), (x) => x), /pipeline\(\) item cap/)
})

test("budget exhaustion throws on the next agent call", async () => {
  const client = mockClient({ reply: () => "x".repeat(10) })
  // mock returns no token usage, so simulate spend via a 0 budget → first call allowed,
  // but a 0 total blocks immediately.
  const rt = createRuntime({ client, budget: 0 })
  await assert.rejects(() => rt.agent("p"), /token budget/)
})

test("agent returns null when the child session cannot be created", async () => {
  // This is the null the saved workflows must guard against before interpolating
  // a phase result into the next prompt (see research-plan-implement.js).
  const client = { session: {
    create: async () => { throw new Error("server down") },
    prompt: async () => ({}),
  } }
  const rt = createRuntime({ client })
  assert.equal(await rt.agent("p1"), null)
  // A later call returns null too — no retry state leaks between calls. (Saved
  // workflows must guard that null before interpolating a phase result into the
  // next prompt, or it reads as the literal string "null" — see
  // research-plan-implement.js.)
  assert.equal(await rt.agent("p2"), null)
})

test("extractJson pulls JSON from a fenced reply", () => {
  assert.deepEqual(extractJson('here:\n```json\n{"a":1}\n```\nthanks'), { a: 1 })
  assert.deepEqual(extractJson('prefix {"b":[1,2]} suffix'), { b: [1, 2] })
  assert.equal(extractJson("no json here"), undefined)
})

test("validateSchema supports predicate, descriptor, and zod-like", () => {
  assert.equal(validateSchema((v) => v > 0 || "pos", 5).ok, true)
  assert.equal(validateSchema((v) => v > 0 || "pos", -1).ok, false)
  assert.equal(validateSchema({ type: "object", required: ["x"] }, { x: 1 }).ok, true)
  assert.equal(validateSchema({ type: "object", required: ["x"] }, {}).ok, false)
  assert.equal(validateSchema({ safeParse: (v) => ({ success: true, data: v }) }, 1).ok, true)
})

test("createLimiter never exceeds its max", async () => {
  const limit = createLimiter(3)
  let active = 0, max = 0
  const task = () => limit(async () => {
    active++; max = Math.max(max, active)
    await new Promise((r) => setTimeout(r, 5))
    active--
  })
  await Promise.all(Array.from({ length: 12 }, task))
  assert.ok(max <= 3, `max was ${max}`)
})
