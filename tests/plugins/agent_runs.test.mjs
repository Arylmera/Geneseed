// The agent outcome ledger's OpenCode half (adapters/opencode/plugins/geneseed-learn.js), the twin
// of js/hosts/agent-runs.mjs: one line per named child session in <cfg>/notebook/agent-runs.jsonl.
// The marker table, the hash and the line are tool-kept copies (tests/twins.mjs); the walk over a
// session's messages is by hand and is held here. Every expected value is written out.
import { test } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { GeneseedLearn } from "../../adapters/opencode/plugins/geneseed-learn.js"
import { makeSandbox } from "../helpers/sandbox.mjs"
import { agentRunLine as hookLine, specHashOf as hookHash } from "../../js/hosts/agent-runs.mjs"

const { toolCounts, recordAgentRun, isRefusal, specHashOf, agentRunLine } = GeneseedLearn

// A session's tool calls are its `tool` parts. A refusal is an errored part whose error text is a
// refusal (V1: the guard throws its gate text), or a V2 call the guard renamed. A plain failed
// call (a red test) is no refusal.
test("toolCounts: V1 and V2 tool parts, refusals apart from errors", () => {
  const v1 = [
    { info: { role: "user" }, parts: [{ type: "text", text: "brief" }] },
    { info: { role: "assistant" }, parts: [
      { type: "text", text: "working" },
      { type: "tool", tool: "read", state: { status: "completed" } },
      { type: "tool", tool: "bash", state: { status: "error", error: "Tell the user this, word for word: This command deletes files." } },
      { type: "tool", tool: "bash", state: { status: "error", error: "Exit code 1" } },
    ] },
  ]
  assert.deepEqual(toolCounts(v1), { tools: 3, refused: 1 })
  const v2 = [
    { type: "user", text: "brief" },
    { type: "assistant", content: [
      { type: "tool", name: "BLOCKED, not a missing tool: the guard refused this call" },
      { type: "tool", name: "read", state: { status: "error", error: { message: "Permission for this action was denied" } } },
      { type: "tool", name: "grep" },
    ] },
  ]
  assert.deepEqual(toolCounts(v2), { tools: 3, refused: 2 })
  assert.deepEqual(toolCounts([]), { tools: 0, refused: 0 })
})

test("the plugin's hash and line are the hook's", () => {
  assert.equal(specHashOf("a\r\n"), hookHash("a\n"))
  const run = { agent: "tester", spec: null, done: null, blocks: null, tools: 1, refused: 0, feedback: 0, report: true }
  const day = new Date("2026-11-14T00:00:00Z")
  assert.equal(agentRunLine(run, day), hookLine(run, day))
  assert.equal(isRefusal("Exit code 1"), false)
})

/** An install at <d>/cfg with a notebook, a manifest owning agents/tester.md, that spec, and a user's own agents/mine.md. */
async function cfgOf(d) {
  const cfg = path.join(d, "cfg")
  await fs.mkdir(path.join(cfg, "notebook"), { recursive: true })
  await fs.mkdir(path.join(cfg, "agents"), { recursive: true })
  await fs.writeFile(path.join(cfg, "agents", "tester.md"), "# tester\n")
  await fs.writeFile(path.join(cfg, "agents", "mine.md"), "# a user agent the manifest does not own\n")
  await fs.writeFile(path.join(cfg, ".geneseed-manifest.json"), JSON.stringify({ owned: ["agents/tester.md"] }))
  return cfg
}
const ledger = async (cfg) => (await fs.readFile(path.join(cfg, "notebook", "agent-runs.jsonl"), "utf8").catch(() => ""))
  .split("\n").filter(Boolean)
const MESSAGES = [{ info: { role: "assistant" }, parts: [{ type: "tool", tool: "read", state: { status: "completed" } },
  { type: "text", text: "done\nspec-feedback: [agent] say which runner — seen: a refusal" }] }]
const TODAY = () => new Date().toISOString().slice(0, 10)

// done and blocks are null on OpenCode (its gate is geneseed-context.js). Once per child session;
// off with GENESEED_NO_USAGE or `.usage-off`, and nothing without a notebook.
test("recordAgentRun: one line per child, none when switched off or with nowhere to go", async () => {
  const d = makeSandbox("gs-runs-").path
  const cfg = await cfgOf(d)
  const saved = process.env.GENESEED_NO_USAGE
  try {
    process.env.GENESEED_NO_USAGE = "1"
    await recordAgentRun("s0", "tester", MESSAGES, cfg)
    assert.deepEqual(await ledger(cfg), [], "GENESEED_NO_USAGE")
    delete process.env.GENESEED_NO_USAGE
    await fs.writeFile(path.join(cfg, ".usage-off"), "")
    await recordAgentRun("s1", "tester", MESSAGES, cfg)
    assert.deepEqual(await ledger(cfg), [], ".usage-off")
    await fs.unlink(path.join(cfg, ".usage-off"))
    await recordAgentRun("s2", "tester", MESSAGES, cfg)
    await recordAgentRun("s2", "tester", MESSAGES, cfg)
    await recordAgentRun("s3", "mine", [], cfg)
    assert.deepEqual(await ledger(cfg), [
      `{"ts":"${TODAY()}","agent":"tester","spec":"${hookHash("# tester\n")}","done":null,"blocks":null,"tools":1,"refused":0,"feedback":1,"report":true}`,
      `{"ts":"${TODAY()}","agent":"mine","spec":null,"done":null,"blocks":null,"tools":0,"refused":0,"feedback":0,"report":false}`,
    ])
    const bare = path.join(d, "bare")
    await fs.mkdir(bare)
    await recordAgentRun("s4", "tester", MESSAGES, bare)
    assert.deepEqual(await fs.readdir(bare), [], "the notebook is never created")
  } finally { if (saved === undefined) delete process.env.GENESEED_NO_USAGE; else process.env.GENESEED_NO_USAGE = saved }
})

/** The plugin copied into `<d>/cfg/plugins/`, freshly imported, with its env; `restore` puts it back. */
async function sandboxPlugin() {
  const d = makeSandbox("gs-runs-").path
  const plugins = path.join(d, "cfg", "plugins")
  await fs.mkdir(plugins, { recursive: true })
  await fs.mkdir(path.join(d, "memory"))
  await fs.copyFile(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-learn.js"), path.join(plugins, "geneseed-learn.js"))
  const keys = ["GENESEED_LEARN_DEBOUNCE_MS", "GENESEED_MEMORY", "GENESEED_HARNESS", "XDG_CONFIG_HOME", "OPENCODE_CONFIG_DIR", "GENESEED_NO_USAGE"]
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  Object.assign(process.env, { GENESEED_LEARN_DEBOUNCE_MS: "0", GENESEED_MEMORY: path.join(d, "memory"),
    XDG_CONFIG_HOME: path.join(d, "xdg"), OPENCODE_CONFIG_DIR: path.join(d, "elsewhere") })
  delete process.env.GENESEED_HARNESS
  delete process.env.GENESEED_NO_USAGE
  const mod = (await import(pathToFileURL(path.join(plugins, "geneseed-learn.js")).href)).default
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  return { mod, restore, file: path.join(d, "cfg", "notebook", "agent-runs.jsonl") }
}
const waitText = async (file) => {
  let text = ""
  for (let i = 0; i < 200 && !text; i += 1) { text = await fs.readFile(file, "utf8").catch(() => ""); if (!text) await new Promise((r) => setTimeout(r, 25)) }
  return text
}

// Through each plugin API, as OpenCode runs it: a named child's end writes its line into the
// plugin's own <cfg>/notebook (here created by the spec-feedback capture just before it).
test("V1: a named child session's idle writes one ledger line", async () => {
  const { mod, restore, file } = await sandboxPlugin()
  try {
    const client = { session: {
      get: async () => ({ data: { parentID: "p", agent: "tester" } }),
      messages: async () => MESSAGES,
    } }
    const hooks = await mod.server({ client, directory: process.cwd() })
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "c1" } } })
    assert.equal(await waitText(file), `{"ts":"${TODAY()}","agent":"tester","spec":null,"done":null,"blocks":null,"tools":1,"refused":0,"feedback":1,"report":true}\n`)
  } finally { restore() }
})

// F8 of #574 holds with the ledger in: a TOP-LEVEL session (no parent link) records no run, and
// with no memory store found its messages are never fetched. Only a child fetches early.
test("V1: a top-level session writes no ledger line and fetches no messages without a store", async () => {
  const { mod, restore, file } = await sandboxPlugin()
  try {
    delete process.env.GENESEED_MEMORY
    await fs.mkdir(path.dirname(file), { recursive: true })
    const calls = []
    const client = { session: {
      get: async () => { calls.push("get"); return { data: { title: "work", agent: "tester" } } },
      messages: async () => { calls.push("messages"); return MESSAGES },
    } }
    const hooks = await mod.server({ client, directory: path.dirname(path.dirname(file)) })
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "top" } } })
    for (let i = 0; i < 40 && !calls.includes("get"); i += 1) await new Promise((r) => setTimeout(r, 25))
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(calls, ["get"])
    assert.equal(await fs.readFile(file, "utf8").catch(() => null), null, "no ledger line for a top-level session")
  } finally { restore() }
})

test("V2: a named child session's end writes one ledger line, V2 message shape", async () => {
  const { mod, restore, file } = await sandboxPlugin()
  const queue = []
  let wake = null
  const controller = { aborted: false }
  try {
    const ctx = {
      location: { directory: process.cwd() },
      session: {
        get: async () => ({ parentID: "p", agent: "tester" }),
        context: async () => [{ type: "assistant", content: [
          { type: "tool", name: "BLOCKED, not a missing tool: the guard refused this call" }, { type: "tool", name: "read" },
          { type: "text", text: "done\nspec-feedback: [agent] say which runner — seen: a refusal" }] }],
      },
      generate: { text: async () => ({ text: "NOTHING" }) },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {
        while (!controller.aborted) { if (queue.length) { yield queue.shift(); continue } await new Promise((r) => { wake = r }) }
      } }) },
    }
    const cleanup = await mod.setup(ctx)
    queue.push({ type: "session.execution.succeeded", data: { sessionID: "c2" } })
    wake?.()
    assert.equal(await waitText(file), `{"ts":"${TODAY()}","agent":"tester","spec":null,"done":null,"blocks":null,"tools":2,"refused":1,"feedback":1,"report":true}\n`)
    controller.aborted = true
    wake?.()
    cleanup()
  } finally { restore() }
})
