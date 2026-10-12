// The OpenCode 2 half of every plugin: `export default { id, server, setup }`, where V2
// calls `setup(ctx)` with a domain context instead of V1's factory input. No live
// OpenCode here — `fakeCtx` stands in for the context `@opencode/plugin`'s promise
// adapter builds (2.0.27): hooks register by name, `event.subscribe` is an async
// iterable of `{ type, created, data }` events, and the session API takes one flat
// input (`{ sessionID, ... }`) and returns the unwrapped `data`. Run from the root:
//   node --test tests/plugins/opencode_v2.test.mjs
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { makeSandbox } from "../helpers/sandbox.mjs"

const PLUGINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../adapters/opencode/plugins")
const WORKFLOWS = path.resolve(PLUGINS, "../workflows")

// Module-level knobs are read at import, so they are set before any plugin loads.
const tmp = makeSandbox("gs-oc2-").path
const cfgDir = path.join(tmp, "config")
const memDir = path.join(tmp, "memory")
const wfDir = path.join(tmp, "workflows")
await fs.mkdir(memDir, { recursive: true })
await fs.mkdir(wfDir, { recursive: true })
await fs.copyFile(path.join(WORKFLOWS, "_runtime.js"), path.join(wfDir, "_runtime.js"))
await fs.writeFile(path.join(wfDir, "demo.js"), `export const meta = { name: "demo", description: "one agent" }
export default async function run(rt) { return rt.agent("say hi", { label: "hi", agent: "explorer", model: "p/m" }) }
`)
const saved = Object.fromEntries(["OPENCODE_CONFIG_DIR", "GENESEED_MEMORY", "GENESEED_LEARN_DEBOUNCE_MS",
  "GENESEED_WORKFLOWS_DIR", "GENESEED_PONYTAIL"].map((k) => [k, process.env[k]]))
process.env.OPENCODE_CONFIG_DIR = cfgDir
process.env.GENESEED_MEMORY = memDir
process.env.GENESEED_LEARN_DEBOUNCE_MS = "0"
process.env.GENESEED_WORKFLOWS_DIR = wfDir
delete process.env.GENESEED_PONYTAIL
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  await fs.rm(tmp, { recursive: true, force: true })
})

const load = async (name) => (await import(pathToFileURL(path.join(PLUGINS, `geneseed-${name}.js`)).href)).default

// The V2 plugin context, reduced to what the plugins touch. `calls` records every session
// / generate call as [method, input]; `emit` pushes an event to every live subscription.
function fakeCtx({ directory = tmp, session = {}, generate } = {}) {
  const hooks = { session: {}, tool: {} }
  const calls = []
  const transforms = []
  const subs = new Set()
  const record = (name, impl = async () => undefined) => async (input) => { calls.push([name, input]); return impl(input) }
  const ctx = {
    location: { directory, project: { directory } },
    session: {
      hook: async (name, cb) => { hooks.session[name] = cb; return { dispose: async () => {} } },
      ...Object.fromEntries(["get", "context", "create", "prompt", "wait", "remove", "switchAgent", "switchModel", "synthetic"]
        .map((m) => [m, record(m, session[m])])),
    },
    tool: {
      hook: async (name, cb) => { hooks.tool[name] = cb; return { dispose: async () => {} } },
      transform: async (cb) => { transforms.push(cb); return { dispose: async () => {} } },
    },
    generate: { text: record("generate.text", generate) },
    event: {
      subscribe: ({ signal } = {}) => {
        const queue = []
        let wake = null
        const sub = { push: (ev) => { queue.push(ev); wake?.() } }
        subs.add(sub)
        signal?.addEventListener("abort", () => wake?.())
        return {
          async *[Symbol.asyncIterator]() {
            try {
              while (!signal?.aborted) {
                if (queue.length) { yield queue.shift(); continue }
                await new Promise((r) => { wake = r })
                wake = null
              }
            } finally { subs.delete(sub) }
          },
        }
      },
    },
  }
  const emit = (type, data, created = Date.now()) => { for (const s of subs) s.push({ id: "evt_x", type, created, data }) }
  return { ctx, hooks, calls, transforms, emit }
}
const settle = () => new Promise((r) => setTimeout(r, 30))

// ---- guard ----------------------------------------------------------------------
// A deny cannot throw on V2 (a throwing hook fails the whole step), so the call is renamed
// to the reason and its input emptied: core settles it as "no tool named …".
test("guard: a denied call is renamed to the reason and emptied; an allowed one is untouched", async () => {
  const { ctx, hooks } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const before = hooks.tool["execute.before"]
  const secret = { tool: "write", input: { path: "/home/u/.ssh/id_rsa", content: "k" } }
  await before(secret)
  assert.match(secret.tool, /^\[geneseed-guard\] blocked: write to secret\/key file/)
  assert.deepEqual(secret.input, {})
  const rm = { tool: "shell", input: { command: "rm -rf /" } }
  await before(rm)
  assert.match(rm.tool, /^\[geneseed-guard\] blocked: catastrophic command/)
  const ok = { tool: "write", input: { path: path.join(tmp, "notes.txt"), content: "hello" } }
  await before(ok)
  assert.deepEqual(ok, { tool: "write", input: { path: path.join(tmp, "notes.txt"), content: "hello" } })
})

// ---- context --------------------------------------------------------------------
// The invisible delivery rides `session.hook("context")`: one user message, built with the
// class of the messages already in the request, carrying the marker and the model line.
test("context: prepends the block once per request, skips child sessions", async () => {
  const repo = path.join(tmp, "repo")
  await fs.mkdir(repo, { recursive: true })
  await fs.writeFile(path.join(repo, "README.md"), "# Demo\nunique-readme-token\n")
  const { ctx, hooks } = fakeCtx({
    directory: repo,
    session: { get: async ({ sessionID }) => (sessionID === "child" ? { parentID: "p" } : { title: "work" }) },
  })
  await (await load("context")).setup(ctx)
  class Msg { constructor(o) { Object.assign(this, o) } }
  const req = (sessionID) => ({
    sessionID, model: { providerID: "anthropic", id: "m1" }, system: [],
    messages: [new Msg({ role: "user", content: [{ type: "text", text: "hi" }] })],
  })
  const ev = req("s1")
  await hooks.session.context(ev)
  assert.equal(ev.messages.length, 2)
  assert.ok(ev.messages[0] instanceof Msg)
  assert.equal(ev.messages[0].role, "user")
  const text = ev.messages[0].content[0].text
  assert.match(text, /^<!-- geneseed-context:v2 -->\ncurrent model: anthropic\/m1/)
  assert.match(text, /unique-readme-token/)
  await hooks.session.context(ev)
  assert.equal(ev.messages.length, 2, "a request already carrying the marker gets no second copy")
  const child = req("child")
  await hooks.session.context(child)
  assert.equal(child.messages.length, 1)
})

// ---- ponytail -------------------------------------------------------------------
// The switch is read off the expanded /ponytail template's first line (no
// command.execute.before on V2); the ruleset goes into the request's system parts.
test("ponytail: levelFromPrompt reads only the template's first line", async () => {
  const { levelFromPrompt } = (await load("ponytail")).server
  assert.equal(levelFromPrompt("Ponytail level requested: ultra\n\nThe geneseed-ponytail plugin…"), "ultra")
  assert.equal(levelFromPrompt("Ponytail level requested: \n\nbody"), "full")     // empty argument = full
  assert.equal(levelFromPrompt("Ponytail level requested: loud"), null)           // not a level
  assert.equal(levelFromPrompt("please\nPonytail level requested: off"), undefined) // not the first line
  assert.equal(levelFromPrompt("fix the bug"), undefined)
})

test("ponytail: a /ponytail prompt persists the level the context hook then injects", async () => {
  const { ctx, hooks } = fakeCtx()
  await (await load("ponytail")).setup(ctx)
  const sys = () => { const e = { system: [] }; hooks.session.context(e); return e.system }
  assert.deepEqual(sys(), [], "off until asked")
  hooks.session.prompt({ prompt: { text: "Ponytail level requested: ultra\n\nAcknowledge." } })
  assert.equal(readFileSync(path.join(cfgDir, ".geneseed-ponytail"), "utf8"), "ultra")
  const [part] = sys()
  assert.equal(part.type, "text")
  assert.match(part.text, /^PONYTAIL MODE[\s\S]*ULTRA:/)
  hooks.session.prompt({ prompt: { text: "Ponytail level requested: off" } })
  assert.deepEqual(sys(), [])
})

// ---- notify ---------------------------------------------------------------------
// The turn is the execution pair; only its end looks the session up.
test("notify: looks the session up at the end of an execution, not at its start", async () => {
  const { ctx, calls, emit } = fakeCtx({ session: { get: async () => ({ title: "geneseed-x" }) } })
  const cleanup = await (await load("notify")).setup(ctx)
  emit("session.execution.started", { sessionID: "s1" })
  await settle()
  assert.deepEqual(calls, [])
  emit("session.execution.succeeded", { sessionID: "s1" })
  await settle()
  assert.deepEqual(calls, [["get", { sessionID: "s1" }]])
  cleanup()
})

// ---- learn ----------------------------------------------------------------------
// The distil is one stateless generate.text with the session's own model ref.
test("learn: flattenV2 keeps user/assistant text and the last assistant model", async () => {
  const { flattenV2 } = (await load("learn")).server
  const out = flattenV2([
    { type: "user", text: "  question  " },
    { type: "system", text: "ignored" },
    { type: "assistant", model: { providerID: "p", id: "m" }, content: [
      { type: "reasoning", text: "hidden" }, { type: "text", text: "answer" }, { type: "tool", name: "x" }] },
  ])
  assert.deepEqual(out, { notes: "user: question\n\nassistant: answer", model: { providerID: "p", id: "m" } })
})

test("learn: an execution end distils the transcript into memory/", async () => {
  const long = "the user prefers tabs over spaces in every file of this repository. ".repeat(4)
  const { ctx, calls, emit } = fakeCtx({
    session: {
      get: async () => ({ title: "work" }),
      context: async () => [
        { type: "user", text: long },
        { type: "assistant", model: { providerID: "p", id: "m" }, content: [{ type: "text", text: "noted" }] },
      ],
    },
    generate: async () => ({ text: "---\nname: prefers-tabs\ndescription: tabs over spaces\n---\nTabs." }),
  })
  const cleanup = await (await load("learn")).setup(ctx)
  emit("session.execution.succeeded", { sessionID: "s1" })
  await settle()
  const gen = calls.find(([m]) => m === "generate.text")
  assert.ok(gen, "generate.text was called")
  assert.deepEqual(gen[1].model, { providerID: "p", id: "m" })
  assert.match(gen[1].prompt, /NOTES:\nuser: the user prefers tabs/)
  assert.ok(existsSync(path.join(memDir, "prefers-tabs.md")))
  assert.match(readFileSync(path.join(memDir, "MEMORY.md"), "utf8"), /\[prefers-tabs\]\(prefers-tabs\.md\) — tabs over spaces/)
  cleanup()
})

// ---- workflow -------------------------------------------------------------------
// The runtime speaks the V1 client; the facade maps its calls onto the V2 session domain.
test("workflow: the tool registers via transform and a child runs through the V2 session API", async () => {
  const { ctx, calls, transforms } = fakeCtx({
    session: {
      create: async () => ({ id: "ses_child" }),
      context: async () => [
        { type: "user", text: "say hi" },
        { type: "assistant", tokens: { input: 3, output: 5 }, content: [{ type: "text", text: "hello from child" }] },
      ],
    },
  })
  await (await load("workflow")).setup(ctx)
  const tools = []
  for (const cb of transforms) cb({ add: (t) => tools.push(t) })
  assert.equal(tools.length, 1)
  const [tool] = tools
  assert.equal(tool.name, "workflow")
  assert.equal(tool.input.type, "object")
  const listed = await tool.execute({})
  assert.match(listed.content, /Available workflows: demo/)
  const res = await tool.execute({ name: "demo" })
  assert.match(res.content, /workflow "demo" complete — 1 agent run/)
  assert.match(res.content, /hello from child/)
  assert.deepEqual(calls.map(([m]) => m), ["create", "switchAgent", "switchModel", "prompt", "wait", "context", "remove"])
  assert.deepEqual(calls[1][1], { sessionID: "ses_child", agent: "explorer" })
  assert.deepEqual(calls[2][1], { sessionID: "ses_child", model: { providerID: "p", id: "m" } })
  assert.deepEqual(calls[3][1], { sessionID: "ses_child", text: "say hi" })
})

// ---- activity -------------------------------------------------------------------
// V2 events are translated into the V1 events the one reducer already handles.
test("activity: toV1Events maps the V2 vocabulary onto V1 events", async () => {
  const { toV1Events } = (await load("activity")).server
  const tools = new Map()
  const ev = (type, data, created = 1000) => toV1Events({ type, created, data: { sessionID: "s1", ...data } }, tools)
  assert.deepEqual(ev("session.created", { title: "t", location: { directory: "/w" } }),
    [{ type: "session.created", properties: { info: { id: "s1", title: "t", parentID: undefined, directory: "/w" } } }])
  assert.deepEqual(ev("session.execution.succeeded"), [{ type: "session.idle", properties: { sessionID: "s1" } }])
  assert.deepEqual(ev("session.execution.failed", { error: { type: "api", message: "boom" } }).map((e) => e.type),
    ["session.error", "session.idle"])
  assert.deepEqual(ev("permission.replied", { requestID: "per_1" }),
    [{ type: "permission.replied", properties: { sessionID: "s1", permissionID: "per_1" } }])
  ev("session.tool.called", { id: "c1", name: "shell", assistantMessageID: "m1" }, 1000)
  const [end] = ev("session.tool.success", { id: "c1", assistantMessageID: "m1" }, 1250)
  assert.equal(end.properties.part.tool, "shell")
  assert.deepEqual(end.properties.part.state.time, { start: 1000, end: 1250 })
  assert.equal(tools.size, 0)
  assert.deepEqual(toV1Events({ type: "session.text.delta", data: { sessionID: "s1" } }, tools), [])
  assert.deepEqual(toV1Events({ type: "session.created", data: {} }, tools), [])
})

test("activity: a V2 session lifecycle writes and removes its card", async () => {
  const { ctx, emit, hooks } = fakeCtx()
  const cleanup = await (await load("activity")).setup(ctx)
  const card = path.join(cfgDir, "activity", "s9.json")
  emit("session.created", { sessionID: "s9", title: "build it", location: { directory: "/w" } })
  emit("session.step.started", { sessionID: "s9", assistantMessageID: "m1", agent: "build", model: { providerID: "p", id: "m" } })
  await settle()
  let entry = JSON.parse(readFileSync(card, "utf8"))
  assert.equal(entry.title, "build it")
  assert.equal(entry.cwd, "/w")
  assert.equal(entry.model, "m")
  assert.equal(entry.status, "busy")
  await hooks.session.prompt({ sessionID: "s9", messageID: "msg_1", prompt: { text: "ship the fix" } })
  const detail = JSON.parse(readFileSync(path.join(cfgDir, "activity", "s9.detail.json"), "utf8"))
  assert.equal(detail.conversation[0].text, "ship the fix")
  emit("session.execution.succeeded", { sessionID: "s9" })
  await settle()
  entry = JSON.parse(readFileSync(card, "utf8"))
  assert.equal(entry.status, "waiting-input")
  emit("session.deleted", { sessionID: "s9" })
  await settle()
  assert.ok(!existsSync(card))
  cleanup()
})
