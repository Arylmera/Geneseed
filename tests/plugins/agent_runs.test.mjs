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

// A session's tool calls are its `tool` parts that name a tool. A refusal is an errored part whose
// error text is one (V1: the guard throws `[geneseed-guard] blocked: …`; V2: core's `No tool named
// "BLOCKED, not a missing tool: …"`), never a bare renamed name. A red test is no refusal. With no
// recognised tool part the counts are null, not 0: the V2 shape is unverified, so "none seen" must
// not read as "used no tools".
test("toolCounts: V1 and V2 tool parts, refusals apart from errors, null when none is seen", () => {
  const v1 = [
    { info: { role: "user" }, parts: [{ type: "text", text: "brief" }] },
    { info: { role: "assistant" }, parts: [
      { type: "text", text: "working" },
      { type: "tool", tool: "read", state: { status: "completed" } },
      { type: "tool", tool: "bash", state: { status: "error", error: "[geneseed-guard] blocked: Tell the user this, word for word: x" } },
      { type: "tool", tool: "bash", state: { status: "error", error: "Exit code 1\nexpected: \"Tell the user this, word for word: x\"" } },
    ] },
  ]
  assert.deepEqual(toolCounts(v1), { tools: 3, refused: 1 })
  const v2 = [
    { type: "user", text: "brief" },
    { type: "assistant", content: [
      { type: "tool", name: "BLOCKED, not a missing tool: the guard refused this call",
        state: { status: "error", error: "No tool named \"BLOCKED, not a missing tool: the guard refused this call\"" } },
      { type: "tool", name: "BLOCKED, not a missing tool: a name alone is no refusal" },
      { type: "tool", name: "read", state: { status: "error", error: { message: "Permission for this action was denied" } } },
      { type: "tool", name: "grep" },
    ] },
  ]
  assert.deepEqual(toolCounts(v2), { tools: 4, refused: 2 })
  assert.deepEqual(toolCounts([]), { tools: null, refused: null })
  assert.deepEqual(toolCounts([{ type: "assistant", content: [{ type: "text", text: "x" }, { type: "tool" }] }]),
    { tools: null, refused: null }, "a tool part that names no tool is no recognised shape")
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
      `{"ts":"${TODAY()}","agent":"mine","spec":null,"done":null,"blocks":null,"tools":null,"refused":null,"feedback":0,"report":false}`,
    ])
    const bare = path.join(d, "bare")
    await fs.mkdir(bare)
    await recordAgentRun("s4", "tester", MESSAGES, bare)
    assert.deepEqual(await fs.readdir(bare), [], "the notebook is never created")
  } finally { if (saved === undefined) delete process.env.GENESEED_NO_USAGE; else process.env.GENESEED_NO_USAGE = saved }
})

/** Run `fn` with `vars` set (undefined deletes one), then put the environment back. */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  try { return await fn() } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}
const SANDBOX_ENV = (d) => ({ XDG_CONFIG_HOME: path.join(d, "xdg"), OPENCODE_CONFIG_DIR: path.join(d, "cfg"),
  GENESEED_HARNESS: undefined, GENESEED_NO_USAGE: undefined, GENESEED_STACK_GLOBAL: undefined })
/** A project install as the emit lays it out: `<d>/repo/.opencode` holds the manifest, agents/ and plugins/, `<d>/repo/notebook` the ledgers. */
async function projectOf(d) {
  const repo = path.join(d, "repo")
  const oc = path.join(repo, ".opencode")
  await fs.mkdir(path.join(oc, "agents"), { recursive: true })
  await fs.mkdir(path.join(oc, "plugins"), { recursive: true })
  await fs.mkdir(path.join(repo, "notebook"))
  await fs.writeFile(path.join(oc, "agents", "tester.md"), "# project tester\n")
  await fs.writeFile(path.join(oc, ".geneseed-manifest.json"), JSON.stringify({ owned: ["agents/tester.md"] }))
  return repo
}

// WHERE THE RUN AND THE NOTES GO. The emit writes a PROJECT install's bundle, notebook/ included,
// at the repo root (js/build/bundle.mjs) and its host layer in `<repo>/.opencode`; the console and
// `catalog agents --scores` read the root's notebook. So the plugin, in `<repo>/.opencode/plugins`,
// records into `<repo>/notebook`, never `<repo>/.opencode/notebook` (which no emit makes), and the
// spec hash still comes from `<repo>/.opencode`, where the manifest and agents/ are. A GLOBAL install
// keeps both beside plugins/: `<cfg>/notebook`, `<cfg>/agents`. The notes have their own two roots:
// the machine notes are the tier's for both, and the project notes are `<repo>/notebook` for the
// project install, and for the global one the session root's git root (none given here: no project).
test("recordAgentRun and notesRootsOf: <repo>/notebook for a project install, <cfg>/notebook for a global one", async () => {
  const d = makeSandbox("gs-runs-").path
  await withEnv(SANDBOX_ENV(d), async () => {
    const repo = await projectOf(d)
    const cfg = await cfgOf(d)
    const tier = path.join(d, "xdg", "geneseed", "notes")
    assert.deepEqual(await GeneseedLearn.notesRootsOf(path.join(repo, ".opencode", "plugins")), { machine: tier, project: path.join(repo, "notebook") })
    assert.deepEqual(await GeneseedLearn.notesRootsOf(path.join(cfg, "plugins")), { machine: tier, project: null })
    await recordAgentRun("p1", "tester", MESSAGES, path.join(repo, ".opencode"))
    await recordAgentRun("g1", "tester", MESSAGES, cfg)
    assert.deepEqual(await ledger(repo), [
      `{"ts":"${TODAY()}","agent":"tester","spec":"${hookHash("# project tester\n")}","done":null,"blocks":null,"tools":1,"refused":0,"feedback":1,"report":true}`,
    ], "the project's run, its spec hashed from .opencode/agents")
    assert.deepEqual(await ledger(cfg), [
      `{"ts":"${TODAY()}","agent":"tester","spec":"${hookHash("# tester\n")}","done":null,"blocks":null,"tools":1,"refused":0,"feedback":1,"report":true}`,
    ], "the global's run")
    assert.deepEqual(await fs.readdir(path.join(repo, ".opencode")).then((l) => l.sort()), [".geneseed-manifest.json", "agents", "plugins"],
      "no .opencode/notebook is made")
    await fs.writeFile(path.join(repo, ".usage-off"), "")
    await recordAgentRun("p2", "tester", MESSAGES, path.join(repo, ".opencode"))
    assert.equal((await ledger(repo)).length, 1, "a project's .usage-off is read at the repo root")
  })
})

// A GLOBAL AND A PROJECT INSTALL BOTH LOAD (OpenCode loads the global plugins and every project
// `.opencode/plugins`, deduping npm plugins, not local files), so both learn plugins see the same
// child end. One records it, the nearest live project's, as for usage.jsonl (`countingCopy`, whose
// home is geneseed-guard.js): `catalog agents --scores` lists each install, and would show the run
// twice. Each copy is its own module (its own file), so each has its own PLUGIN_DIR.
test("recordAgentRun: beside a live project install, the project records the run and the global does not", async () => {
  const d = makeSandbox("gs-runs-").path
  await withEnv(SANDBOX_ENV(d), async () => {
    const repo = await projectOf(d)
    const cfg = await cfgOf(d)
    await fs.mkdir(path.join(cfg, "plugins"))
    const learn = path.join(process.cwd(), "adapters/opencode/plugins/geneseed-learn.js")
    const guard = path.join(process.cwd(), "adapters/opencode/plugins/geneseed-guard.js")
    for (const plugins of [path.join(repo, ".opencode", "plugins"), path.join(cfg, "plugins")]) {
      await fs.copyFile(learn, path.join(plugins, "geneseed-learn.js"))
      await fs.copyFile(guard, path.join(plugins, "geneseed-guard.js"))
    }
    const here = [repo, repo]
    for (const plugins of [path.join(repo, ".opencode", "plugins"), path.join(cfg, "plugins")]) {
      const { GeneseedLearn: copy } = await import(pathToFileURL(path.join(plugins, "geneseed-learn.js")).href)
      await copy.recordAgentRun("c1", "tester", MESSAGES, undefined, here)
    }
    assert.equal((await ledger(repo)).length, 1, "the project records the run once")
    assert.deepEqual(await ledger(cfg), [], "the global copy stands down")
  })
})

/** The plugin copied into `<d>/cfg/plugins/`, freshly imported, with its env; `restore` puts it back. */
async function sandboxPlugin() {
  const d = makeSandbox("gs-runs-").path
  const plugins = path.join(d, "cfg", "plugins")
  await fs.mkdir(plugins, { recursive: true })
  await fs.mkdir(path.join(d, "memory"))
  // The install's notebook, as the emit makes it: the ledger is written only where one exists.
  await fs.mkdir(path.join(d, "cfg", "notebook"))
  await fs.copyFile(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-learn.js"), path.join(plugins, "geneseed-learn.js"))
  const keys =["GENESEED_LEARN_DEBOUNCE_MS", "GENESEED_MEMORY", "GENESEED_HARNESS", "XDG_CONFIG_HOME", "OPENCODE_CONFIG_DIR", "GENESEED_NO_USAGE"]
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
// plugin's own <cfg>/notebook.
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
          { type: "tool", name: "BLOCKED, not a missing tool: the guard refused this call",
            state: { status: "error", error: "No tool named \"BLOCKED, not a missing tool: the guard refused this call\"" } },
          { type: "tool", name: "read" },
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
