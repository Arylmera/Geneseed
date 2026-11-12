// Tests for the context plugin's DELIVERY modes — invisible transform by default,
// GENESEED_CONTEXT_VISIBLE=1 forcing the classic visible session message, the legacy
// GENESEED_CONTEXT_TRANSFORM=off spelling, and the automatic fallback to visible
// delivery on builds that lack the experimental transform hook. The mode flags are
// module-level consts read at import time, so each case gets a fresh module instance
// via a query-string import. Run from the Geneseed root:
//   node --test tests/plugins/context_delivery.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { makeSandbox } from "../helpers/sandbox.mjs";

const PLUGIN = new URL("../../adapters/opencode/plugins/geneseed-context.js", import.meta.url).href

let tmp, repo

before(async () => {
  tmp = makeSandbox("gsdeliver-").path
  repo = path.join(tmp, "repo")
  await fs.mkdir(repo)
  await fs.writeFile(path.join(repo, "README.md"), "# Delivery Repo\nhello\n")
  // An empty wiki manifest keeps any developer-machine geneseed-wiki.jsonc out of the block.
  await fs.writeFile(path.join(tmp, "geneseed-wiki.jsonc"), `{ "wikis": [] }`)
  process.env.GENESEED_WIKI = path.join(tmp, "geneseed-wiki.jsonc")
})

after(async () => {
  delete process.env.GENESEED_WIKI
  await fs.rm(tmp, { recursive: true, force: true })
})

// A stub OpenCode client that records session.prompt calls. `transcript` is what
// session.messages answers: the persisted conversation, which a test fills to say that a
// model request ran (an assistant message) or that the visible block was posted.
function stubClient(transcript = []) {
  const prompts = []
  return {
    prompts,
    transcript,
    session: {
      get: async () => ({ data: { title: "user session" } }),
      messages: async () => transcript,
      prompt: async (req) => { prompts.push(req) },
    },
  }
}
// A persisted assistant message: the evidence that a model request really completed.
const assistantMsg = (sid) => ({
  info: { id: "a1", role: "assistant", sessionID: sid, time: { created: 2 } },
  parts: [{ id: "pa", type: "text", text: "done" }],
})
const blocks = (messages) => messages.filter((m) =>
  (m.parts ?? []).some((p) => String(p.text ?? "").includes("PROJECT CONTEXT"))).length

// One outgoing user message, shaped like the transform hook receives it.
const userMsg = (sid) => ({
  info: { id: "m1", role: "user", sessionID: sid, time: { created: 1 } },
  parts: [{ id: "p1", type: "text", text: "hi" }],
})

// Import a fresh plugin instance with the given env overrides active at import time
// (restored right after — the flags are baked into module consts).
async function load(env, tag, transcript = []) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    const mod = await import(`${PLUGIN}?case=${tag}`)
    const client = stubClient(transcript)
    const plugin = await mod.default.server({ directory: repo, client })
    return { plugin, client }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test("default: the transform prepends the context; session.created posts nothing", async () => {
  const { plugin, client } = await load({}, "default")
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 0)

  const output = { messages: [userMsg("s1")] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  assert.equal(output.messages.length, 2)
  assert.match(output.messages[0].parts[0].text, /PROJECT CONTEXT/)
  assert.match(output.messages[0].parts[0].text, /# Delivery Repo/)
})

// The transform runs on every request. The block is cached for 30 s, and so are the two lookups
// that gate it, per instance: the exclude lists (`excludes.json`, read twice) and the done checks.
// So a second request inside the TTL reads no `excludes.json` at all, and still gets the block.
test("a second request inside the TTL reads no excludes.json", async () => {
  const { plugin } = await load({}, "ttl")
  const real = fs.readFile
  let reads = 0
  fs.readFile = (p, ...rest) => { if (String(p).endsWith("excludes.json")) reads += 1; return real.call(fs, p, ...rest) }
  try {
    const first = { messages: [userMsg("s1")] }
    await plugin["experimental.chat.messages.transform"]({}, first)
    assert.equal(reads, 2, "the first request reads the install's list and the shared one")
    const second = { messages: [userMsg("s1")] }
    await plugin["experimental.chat.messages.transform"]({}, second)
    assert.equal(reads, 2, "the second request read excludes.json again")
    assert.match(second.messages[0].parts[0].text, /PROJECT CONTEXT/)
  } finally { fs.readFile = real }
})

test("GENESEED_CONTEXT_VISIBLE=1: session.created posts the block; the transform stays out", async () => {
  const { plugin, client } = await load({ GENESEED_CONTEXT_VISIBLE: "1" }, "visible")
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 1)
  assert.match(client.prompts[0].body.parts[0].text, /PROJECT CONTEXT/)

  const output = { messages: [userMsg("s1")] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  assert.equal(output.messages.length, 1)
})

test("legacy GENESEED_CONTEXT_TRANSFORM=off forces the visible delivery too", async () => {
  const { plugin, client } = await load({ GENESEED_CONTEXT_TRANSFORM: "off" }, "legacy")
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 1)
})

// THE FALLBACK RULE: visible delivery engages when a MODEL REQUEST completed and the transform
// hook never fired — the build lacks the hook. "A model request completed" is an idle on a
// session whose transcript holds an assistant message. The three tests below are its three
// rows: such an idle latches; an idle with nothing behind it latches nothing; and a latch is
// undone the moment the hook does fire, since that proves the build has it.
test("fallback: a request completing without the hook engages visible delivery", async () => {
  const { plugin, client } = await load({}, "fallback", [assistantMsg("s1")])
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 0)              // still counting on the transform
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 1)              // hook never fired -> visible catch-up
  assert.match(client.prompts[0].body.parts[0].text, /PROJECT CONTEXT/)
  // Later sessions go visible immediately, on session.created.
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s2" } } })
  assert.equal(client.prompts.length, 2)
})

test("no fallback from an idle with no model request behind it", async () => {
  const { plugin, client } = await load({}, "idle-empty")       // transcript: no assistant message
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 0, "an empty session's idle posted the visible block")
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s2" } } })
  assert.equal(client.prompts.length, 0, "the latch was set: a new session went visible")
  const output = { messages: [userMsg("s2")] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  assert.equal(blocks(output.messages), 1, "the invisible delivery did not run")
})

test("idle, then the transform: invisible delivery resumes, with exactly one block", async () => {
  const transcript = [assistantMsg("s1")]
  const { plugin, client } = await load({}, "idle-then-hook", transcript)
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 1)              // latched: s1 got the visible block
  // The hook fires after all. s1's transcript now carries the visible block, and the request
  // must not gain a second one.
  const posted = { info: { id: "v1", role: "user", sessionID: "s1" }, parts: client.prompts[0].body.parts }
  const again = { messages: [posted, assistantMsg("s1"), userMsg("s1")] }
  await plugin["experimental.chat.messages.transform"]({}, again)
  assert.equal(again.messages.length, 3)
  assert.equal(blocks(again.messages), 1, "the visible block and an invisible one, both")
  // …and a new session is back on the invisible delivery: nothing posted, one block prepended.
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s2" } } })
  assert.equal(client.prompts.length, 1, "the latch outlived the hook firing")
  const fresh = { messages: [userMsg("s2")] }
  await plugin["experimental.chat.messages.transform"]({}, fresh)
  assert.equal(fresh.messages.length, 2)
  assert.equal(blocks(fresh.messages), 1)
  assert.match(fresh.messages[0].parts[0].text, /PROJECT CONTEXT/)
})

test("no fallback when the transform hook fired before the session went idle", async () => {
  const { plugin, client } = await load({}, "hookworks", [assistantMsg("s1")])
  const output = { messages: [userMsg("s1")] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 0)
})

test("GENESEED_CONTEXT_INJECT=off: no delivery in any form", async () => {
  const { plugin, client } = await load({ GENESEED_CONTEXT_INJECT: "off" }, "off")
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s1" } } })
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  const output = { messages: [userMsg("s1")] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  assert.equal(client.prompts.length, 0)
  assert.equal(output.messages.length, 1)
})

// One OpenCode process can serve several directories, each with its own plugin instance
// from the SAME module. The transform's block cache belongs to the instance: a module-level
// cache served the first project's context into the second for the whole 30 s TTL.
test("two instances in one process each get their own project's block", async () => {
  const other = path.join(tmp, "other")
  await fs.mkdir(other, { recursive: true })
  await fs.writeFile(path.join(other, "README.md"), "# Other Repo\nhello\n")
  const mod = await import(`${PLUGIN}?case=two-roots`)
  const a = await mod.default.server({ directory: repo, client: stubClient() })
  const b = await mod.default.server({ directory: other, client: stubClient() })
  const outA = { messages: [userMsg("sa")] }
  await a["experimental.chat.messages.transform"]({}, outA)
  const outB = { messages: [userMsg("sb")] }
  await b["experimental.chat.messages.transform"]({}, outB)
  assert.match(outA.messages[0].parts[0].text, /# Delivery Repo/)
  assert.match(outB.messages[0].parts[0].text, /# Other Repo/)
  assert.doesNotMatch(outB.messages[0].parts[0].text, /# Delivery Repo/)
})
