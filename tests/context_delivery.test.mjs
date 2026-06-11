// Tests for the context plugin's DELIVERY modes — invisible transform by default,
// GENESEED_CONTEXT_VISIBLE=1 forcing the classic visible session message, the legacy
// GENESEED_CONTEXT_TRANSFORM=off spelling, and the automatic fallback to visible
// delivery on builds that lack the experimental transform hook. The mode flags are
// module-level consts read at import time, so each case gets a fresh module instance
// via a query-string import. Run from the Geneseed root:
//   node --test tests/context_delivery.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import * as path from "node:path"

const PLUGIN = new URL("../adapters/opencode/plugins/geneseed-context.js", import.meta.url).href

let tmp, repo

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gsdeliver-"))
  repo = path.join(tmp, "repo")
  await fs.mkdir(repo)
  await fs.writeFile(path.join(repo, "README.md"), "# Delivery Repo\nhello\n")
  // An empty wiki manifest keeps any developer-machine wiki.jsonc out of the block.
  await fs.writeFile(path.join(tmp, "wiki.jsonc"), `{ "wikis": [] }`)
  process.env.GENESEED_WIKI = path.join(tmp, "wiki.jsonc")
})

after(async () => {
  delete process.env.GENESEED_WIKI
  await fs.rm(tmp, { recursive: true, force: true })
})

// A stub OpenCode client that records session.prompt calls.
function stubClient() {
  const prompts = []
  return {
    prompts,
    session: {
      get: async () => ({ data: { title: "user session" } }),
      messages: async () => [],
      prompt: async (req) => { prompts.push(req) },
    },
  }
}

// One outgoing user message, shaped like the transform hook receives it.
const userMsg = (sid) => ({
  info: { id: "m1", role: "user", sessionID: sid, time: { created: 1 } },
  parts: [{ id: "p1", type: "text", text: "hi" }],
})

// Import a fresh plugin instance with the given env overrides active at import time
// (restored right after — the flags are baked into module consts).
async function load(env, tag) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    const mod = await import(`${PLUGIN}?case=${tag}`)
    const client = stubClient()
    const plugin = await mod.default({ directory: repo, client })
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

test("fallback: a request completing without the hook engages visible delivery", async () => {
  const { plugin, client } = await load({}, "fallback")
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 0)              // still counting on the transform
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  assert.equal(client.prompts.length, 1)              // hook never fired -> visible catch-up
  assert.match(client.prompts[0].body.parts[0].text, /PROJECT CONTEXT/)
  // Later sessions go visible immediately, on session.created.
  await plugin.event({ event: { type: "session.created", properties: { sessionID: "s2" } } })
  assert.equal(client.prompts.length, 2)
})

test("no fallback when the transform hook fired before the session went idle", async () => {
  const { plugin, client } = await load({}, "hookworks")
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
