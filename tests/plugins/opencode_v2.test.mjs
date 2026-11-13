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
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from "../helpers/sandbox.mjs"
import { spawnHook } from "../helpers/hook_run.mjs"

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
// The guard's change report reads and writes the machine tier, so the home moves too: without this,
// the report test below wrote its fixture's path into the real `.store-report.json`.
sandboxProcessHome()
process.env.OPENCODE_CONFIG_DIR = cfgDir
process.env.GENESEED_MEMORY = memDir
process.env.GENESEED_LEARN_DEBOUNCE_MS = "0"
process.env.GENESEED_WORKFLOWS_DIR = wfDir
delete process.env.GENESEED_PONYTAIL
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  restoreProcessHome()
  await fs.rm(tmp, { recursive: true, force: true })
})

const cfgRoot = () => path.resolve(PLUGINS, "..")
const load = async (name) => (await import(pathToFileURL(path.join(PLUGINS, `geneseed-${name}.js`)).href)).default

// The V2 plugin context, reduced to what the plugins touch. `calls` records every session
// / generate call as [method, input]; `emit` pushes an event to every live subscription.
function fakeCtx({ directory = tmp, session = {}, generate, permission = true } = {}) {
  const hooks = { session: {}, tool: {}, permission: {} }
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
    ...(permission ? { permission: { hook: async (name, cb) => { hooks.permission[name] = cb; return { dispose: async () => {} } } } } : {}),
    event: {
      subscribe: ({ signal } = {}) => {
        const queue = []
        let wake = null
        const sub = { queue, push: (ev) => { queue.push(ev); wake?.() } }
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
  // True once every subscription has pulled every event pushed to it. A consumer handles one
  // event before it pulls the next, so a barrier pushed after an event, once pulled, proves that
  // event's handler has finished.
  const drained = () => [...subs].every((s) => !s.queue.length)
  return { ctx, hooks, calls, transforms, emit, drained }
}
const settle = () => new Promise((r) => setTimeout(r, 30))
// For work that crosses several fs awaits: a fixed 30 ms loses the race when the whole suite
// runs in parallel (the learn distil failed that way), so wait for the outcome, up to 5 s.
const until = async (ok, ms = 5000) => { for (const end = Date.now() + ms; !ok() && Date.now() < end;) await settle() }

// ---- guard ----------------------------------------------------------------------
// A deny cannot throw on V2 (a throwing hook fails the whole step), so the call is renamed
// to the reason and its input emptied: core settles it as "no tool named …", which is why the
// name opens by saying nothing is missing.
const REFUSED = "^BLOCKED, not a missing tool: \\[geneseed-guard\\] blocked: "
test("guard: a denied call is renamed to the reason and emptied; an allowed one is untouched", async () => {
  const { ctx, hooks } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const before = hooks.tool["execute.before"]
  const secret = { tool: "write", input: { path: "/home/u/.ssh/id_rsa", content: "k" } }
  await before(secret)
  assert.match(secret.tool, new RegExp(`${REFUSED}Tell the user this, word for word: This edit writes to `))
  assert.deepEqual(secret.input, {})
  const rm = { tool: "shell", input: { command: "rm -rf /" } }
  await before(rm)
  assert.match(rm.tool, new RegExp(`${REFUSED}Tell the user this, word for word: This command, "rm -rf /", would destroy`))
  // The rename reason is what the model reads: it never names a switch that turns the guard off
  // (a weak model took "set GENESEED_GUARD=off to allow" as leave to write through a shell).
  const memo = { tool: "shell", input: { command: `echo x > "${path.join(tmp, "user-rules.md")}"` } }
  await before(memo)
  assert.match(memo.tool, new RegExp(`${REFUSED}[\\s\\S]*\\(Persist Insight\\)[\\s\\S]* re-issuing this call changes nothing, and never write it another way`))
  // The gates' own configuration (External Gate): another host's exclusion list, renamed the same way.
  // (Hook settings and OpenCode's own files are asked natively through permission.edit, not refused here.)
  const excl = { tool: "write", input: { path: path.join(tmp, ".claude", "excludes.json"), content: "{}" } }
  await before(excl)
  assert.match(excl.tool, new RegExp(`${REFUSED}[\\s\\S]*controls the gates that watch the agent[\\s\\S]*\\(External Gate\\)`))
  assert.deepEqual(excl.input, {})
  for (const why of [secret.tool, rm.tool, memo.tool, excl.tool]) assert.doesNotMatch(why, /GENESEED_/, why)
  const ok = { tool: "write", input: { path: path.join(tmp, "notes.txt"), content: "hello" } }
  await before(ok)
  assert.deepEqual(ok, { tool: "write", input: { path: path.join(tmp, "notes.txt"), content: "hello" } })
})

// The host asks, never the agent: an edit reaches the tool, whose `permission.assert` runs
// `evaluate`, and the hook raises it to a real prompt. Saved "always" arrives as "allow".
test("guard: a rule-store edit passes to the host, and evaluate turns it into a prompt", async () => {
  const { ctx, hooks } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const store = path.join(tmp, "user-rules.md")
  for (const tool of ["write", "edit", "patch"]) {
    const call = { tool, input: { path: store, content: "x" } }
    await hooks.tool["execute.before"](call)
    assert.equal(call.tool, tool, "the guard leaves it to the host's prompt")
  }
  const evaluate = hooks.permission.evaluate
  const ask = async (over) => {
    const event = { sessionID: "s", action: "edit", resources: [store], effect: "allow", ...over }
    await evaluate(event)
    return event
  }
  const asked = await ask()
  assert.equal(asked.effect, "ask")
  assert.match(asked.message, /Persist Insight/)
  assert.doesNotMatch(asked.message, /GENESEED_/)
  assert.equal((await ask({ resources: ["src/a.js", "memory/x.md", "user-rules.draft.md"] })).effect, "ask", "a location-relative resource, among others")
  // Memory is written freely (owner decision, 2026-11-08): no prompt for the index or a fact.
  assert.equal((await ask({ resources: ["memory/x.md", "MEMORY.md"] })).effect, "allow", "memory is written freely")
  assert.equal((await ask({ resources: ["src/a.js"] })).effect, "allow", "ordinary work is untouched")
  assert.equal((await ask({ action: "read" })).effect, "allow", "only an edit")
  assert.equal((await ask({ effect: "deny" })).effect, "deny", "never softens a deny")
  assert.equal((await ask({ resources: null })).effect, "ask", "an event it cannot read is asked about, and never throws")
  assert.equal((await ask({ resources: ["opencode.json"] })).effect, "ask", "a gate's own file, whatever was saved")
})

// The shell tool's own assert reaches `evaluate` too (action `shell`, core/src/permission.ts has no
// filter): the tool hook marks the call by id, so the prompt is the host's, on that call alone.
test("guard: a parsed shell write to a store becomes a real prompt, by call id", async () => {
  const { ctx, hooks } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const store = path.join(tmp, "user-rules.md")
  const call = { tool: "shell", id: "c1", input: { command: `echo x > "${store}"` } }
  await hooks.tool["execute.before"](call)
  assert.equal(call.tool, "shell", "the host asks; nothing is refused here")
  const ev = (id) => ({ sessionID: "s", action: "shell", resources: ["echo x"], effect: "allow", source: { type: "tool", messageID: "m", id } })
  const other = ev("c2"); await hooks.permission.evaluate(other)
  assert.equal(other.effect, "allow", "another call in the same session")
  const mine = ev("c1"); await hooks.permission.evaluate(mine)
  assert.equal(mine.effect, "ask")
  // The store the tool hook saw reaches the prompt, which sees only the call id.
  assert.equal(mine.message, "This command writes to user-rules.md, your standing rules, which the agent obeys in every session.\n"
    + "Safe choice: Deny, unless you asked for this rule. (Persist Insight)\n"
    + "It asks because what becomes a rule is your decision.\n"
    + "If you allow it, the text binds every later session until you remove it.\n"
    + "Agent: if refused, ask the user; do not write it another way.")
  const again = ev("c1"); await hooks.permission.evaluate(again)
  assert.equal(again.effect, "allow", "one ask per call")
  // No program word: the host's parser finds no command, asserts nothing, and so never asks.
  for (const command of [`> "${store}"`, `A=1 > "${store}"`, `ls; > "${store}"`]) {
    const bare = { tool: "shell", id: "c9", input: { command } }
    await hooks.tool["execute.before"](bare)
    assert.match(bare.tool, new RegExp(`${REFUSED}Tell the user this, word for word: This command writes to user-rules\\.md`), command)
  }
  const plain = { tool: "shell", id: "c3", input: { command: "echo 'see MEMORY.md' > notes.txt" } }
  await hooks.tool["execute.before"](plain)
  const p = ev("c3"); await hooks.permission.evaluate(p)
  assert.equal(p.effect, "allow")
  // The live miss on 2.2.5, through the home: the tier's rule file, reached only by the home expansion.
  const cmdlet = { tool: "shell", id: "c4", input: { command: "Add-Content -Path \"$HOME\\.config\\geneseed\\user-rules.md\" -Value \"test gate\"" } }
  await hooks.tool["execute.before"](cmdlet)
  assert.equal(cmdlet.tool, "shell", "the host asks; nothing is refused here")
  const c = ev("c4"); await hooks.permission.evaluate(c)
  assert.equal(c.effect, "ask")
  // The same write to a tier memory file is free: no mark, so no prompt.
  const fact = { tool: "shell", id: "c5", input: { command: "Add-Content -Path \"$HOME\\.config\\geneseed\\memory\\x.md\" -Value x" } }
  await hooks.tool["execute.before"](fact)
  assert.equal(fact.tool, "shell")
  const m = ev("c5"); await hooks.permission.evaluate(m)
  assert.equal(m.effect, "allow", "memory is written freely")
})

// The dialog shows no plugin text, so an ask posts its reason first. The TUI renders `description`, the
// model gets `text`, which must read true whichever way the user answers.
const NOTE_TEXT = "Geneseed showed the user why the next permission request asks."
const NOTE = (...body) => ["──── Geneseed · about the next permission request ────", ...body, "──── The dialog below is for this change ────"].join("\n")
const notes = (calls) => calls.filter(([name]) => name === "synthetic").map(([, input]) => input)
test("guard: an ask posts its explanation first, with no agent line; the ask stands if the post fails", async () => {
  const store = path.join(tmp, "user-rules.md")
  const edit = () => ({ sessionID: "s", action: "edit", resources: [store], effect: "allow" })
  const { ctx, hooks, calls } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const ask = edit()
  await hooks.permission.evaluate(ask)
  assert.equal(ask.effect, "ask")
  assert.deepEqual(notes(calls), [{ sessionID: "s", text: NOTE_TEXT, resume: false, description: NOTE(
    "This edit changes user-rules.md, your standing rules, which the agent obeys in every session.",
    "Safe choice: Deny, unless you asked for this rule. (Persist Insight)",
    "It asks because what becomes a rule is your decision.",
    "If you allow it, the text binds every later session until you remove it.") }])
  assert.match(ask.message, /\nAgent: if refused/, "the message keeps its tail: an upstream render would light up as it is")
  const failing = fakeCtx({ session: { synthetic: async () => { throw new Error("409") } } })
  await (await load("guard")).setup(failing.ctx)
  const still = edit()
  await failing.hooks.permission.evaluate(still)
  assert.equal(still.effect, "ask", "a note that cannot post changes nothing")
  assert.match(still.message, /Persist Insight/)
})

test("guard: a shell ask posts its note too, and a refusal or a plain call posts none", async () => {
  const { ctx, hooks, calls } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const store = path.join(tmp, "user-rules.md")
  const before = hooks.tool["execute.before"]
  await before({ tool: "write", input: { path: path.join(tmp, ".claude", "excludes.json"), content: "{}" } })
  await before({ tool: "shell", id: "n1", input: { command: `> "${store}"` } })
  await before({ tool: "write", input: { path: path.join(tmp, "notes.txt"), content: "x" } })
  await hooks.permission.evaluate({ sessionID: "s", action: "edit", resources: [path.join(tmp, "notes.txt")], effect: "allow" })
  await hooks.permission.evaluate({ sessionID: "s", action: "edit", resources: [store], effect: "deny" })
  assert.deepEqual(notes(calls), [])
  await before({ tool: "shell", id: "n2", input: { command: `echo x > "${store}"` } })
  await hooks.permission.evaluate({ sessionID: "s", action: "shell", resources: ["echo x"], effect: "allow", source: { type: "tool", messageID: "m", id: "n2" } })
  const [one, ...rest] = notes(calls)
  assert.deepEqual(rest, [])
  assert.match(one.description, /^──── Geneseed[^\n]*\nThis command writes to user-rules\.md/)
  assert.doesNotMatch(one.description, /Agent:/)
})

// The change report on V2: baseline at the turn's start, compare at its end, approval from execute.after.
test("guard: the change report tells the user of an unapproved change, once", async () => {
  const { ctx, hooks, calls, emit, drained } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const fact = path.join(cfgRoot(), "memory", "w2g-report.md")
  await fs.mkdir(path.dirname(fact), { recursive: true })
  await fs.rm(fact, { force: true })
  try {
    // Each edge waits for its handler (`drained`), never for a clock: the start handler takes the
    // baseline, and a write that lands before it is part of the baseline, not a change.
    const turn = async (type) => { emit(type, { sessionID: "r1" }); emit("test.barrier", {}); await until(drained) }
    const said = () => calls.filter(([n]) => n === "synthetic").map(([, i]) => i)
    await turn("session.execution.started")
    await fs.writeFile(fact, "planted")
    await turn("session.execution.succeeded")
    assert.equal(said().length, 1)
    assert.equal(said()[0].text, "Geneseed change report: 1 rule or memory file changed outside this session's approved writes (another session, or a decision of yours in the web console, may have made it): memory/w2g-report.md. This detects a change; it prevented nothing.")
    assert.equal(said()[0].sessionID, "r1")
    await turn("session.execution.succeeded")
    assert.equal(said().length, 1, "said once")
    await fs.writeFile(fact, "approved by the host")
    await hooks.tool["execute.after"]({ tool: "write", input: { filePath: fact }, status: "completed" })
    await turn("session.execution.succeeded")
    assert.equal(said().length, 1, "a write the host let through is approved")
  } finally { await fs.rm(fact, { force: true }) }
})

// One `opencode serve` loads the guard once per opened project, and every instance hears every
// session. Each has its own baseline of the same machine-wide stores, so each finds the same
// change at the same turn end. The user is told ONCE: the instances share a marker per
// (session, files, stamps), and the first to create it reports. Four instances stand for four
// open projects, the case that showed four identical messages. A later, different change is a
// new marker and is reported again, once.
test("guard: four instances that all see one change report it once between them", async () => {
  const instances = []
  for (let i = 0; i < 4; i += 1) {
    const one = fakeCtx()
    await (await load("guard")).setup(one.ctx)
    instances.push(one)
  }
  const fact = path.join(cfgRoot(), "memory", "w2g-once.md")
  await fs.mkdir(path.dirname(fact), { recursive: true })
  await fs.rm(fact, { force: true })
  try {
    const turn = async (type) => {
      for (const one of instances) { one.emit(type, { sessionID: "multi-1" }); one.emit("test.barrier", {}) }
      await until(() => instances.every((one) => one.drained()))
    }
    const said = () => instances.flatMap((one) => one.calls.filter(([n]) => n === "synthetic").map(([, i]) => i))
    await turn("session.execution.started")
    await fs.writeFile(fact, "planted")
    await turn("session.execution.succeeded")
    assert.equal(said().length, 1, `four instances posted ${said().length} reports of one change`)
    assert.equal(said()[0].sessionID, "multi-1")
    await fs.writeFile(fact, "planted again, and longer")
    await turn("session.execution.succeeded")
    assert.equal(said().length, 2, "a second, different change is reported, once")
  } finally { await fs.rm(fact, { force: true }) }
})

test("guard: a V2 with no permission domain has no prompt, so the write is refused, re-issued or not", async () => {
  const { ctx, hooks } = fakeCtx({ permission: false })
  await (await load("guard")).setup(ctx)
  for (let i = 0; i < 2; i += 1) {
    const call = { tool: "write", input: { path: path.join(tmp, "user-rules.md"), content: "x" } }
    await hooks.tool["execute.before"](call)
    assert.match(call.tool, new RegExp(`${REFUSED}[\\s\\S]*host has no prompt wired`))
    assert.deepEqual(call.input, {})
  }
})

// A V2 callback never throws, the refusal's own two assignments included: an event that cannot be
// written (frozen here) is left as it came, and the step goes on.
test("guard: a refusal that cannot be written onto the event does not throw", async () => {
  const { ctx, hooks } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const frozen = Object.freeze({ tool: "write", input: { path: "/home/u/.ssh/id_rsa", content: "k" } })
  await hooks.tool["execute.before"](frozen)
  assert.equal(frozen.tool, "write")
})

// A gate that fails judges nothing (ADR 0007, amended 2026-11). Where V2 can ask, the call is marked
// by its id and `evaluate` raises its first assert to a prompt that names the gate and its error,
// whatever the action; one ask per call, and no other call is touched. A call a later gate refuses is
// renamed as ever and leaves no mark. A V2 with no permission domain has no prompt: the call runs,
// and the user is told once per gate for the life of the process.
const poisoned = (rest) => Object.defineProperty({ ...rest }, "filePath",
  { enumerable: true, get() { throw new Error("poisoned") } })
test("guard: a gate error becomes a prompt where V2 can ask, and one notice where it cannot", async () => {
  const { ctx, hooks, calls } = fakeCtx()
  await (await load("guard")).setup(ctx)
  const before = hooks.tool["execute.before"]
  const ev = (id, action = "shell") => ({ sessionID: "s", action, resources: ["x"], effect: "allow", source: { type: "tool", messageID: "m", id } })
  // `exec_and_save` is a write tool and a shell tool: the path gates fail, the shell gate still reads.
  const call = { tool: "exec_and_save", id: "g1", sessionID: "s", input: poisoned({ command: "echo hi" }) }
  await before(call)
  assert.equal(call.tool, "exec_and_save", "nothing is refused here")
  const other = ev("g0"); await hooks.permission.evaluate(other)
  assert.equal(other.effect, "allow", "another call")
  const mine = ev("g1", "edit"); await hooks.permission.evaluate(mine)
  assert.equal(mine.effect, "ask")
  assert.equal(mine.message, 'Geneseed gate error: the check failed with "paths: poisoned", so nothing judged this call.\n'
    + "Safe choice: Deny, then run geneseed doctor.\n"
    + "It asks because a gate that crashed cannot say this call is safe.\n"
    + "If you allow it, this call runs with no check at all.")
  const again = ev("g1", "edit"); await hooks.permission.evaluate(again)
  assert.equal(again.effect, "allow", "one ask per call")
  const refused = { tool: "exec_and_save", id: "g2", sessionID: "s", input: poisoned({ command: "rm -rf /" }) }
  await before(refused)
  assert.match(refused.tool, new RegExp(`${REFUSED}[\\s\\S]*would destroy a filesystem root`))
  const gone = ev("g2"); await hooks.permission.evaluate(gone)
  assert.equal(gone.effect, "allow", "a refused call leaves no mark")
  assert.deepEqual(notes(calls).map((n) => n.description.split("\n")[1]),
    ['Geneseed gate error: the check failed with "paths: poisoned", so nothing judged this call.'], "the ask's own note, and no other")

  const bare = fakeCtx({ permission: false })
  await (await load("guard")).setup(bare.ctx)
  for (const id of ["h1", "h2"]) {
    const run = { tool: "exec_and_save", id, sessionID: "s2", input: poisoned({ command: "echo hi" }) }
    await bare.hooks.tool["execute.before"](run)
    assert.equal(run.tool, "exec_and_save", "no prompt to raise, so the call runs")
  }
  assert.deepEqual(notes(bare.calls), [{ sessionID: "s2", resume: false, description: "Geneseed gate error",
    text: 'Geneseed gate error: the paths check failed with "poisoned", so it did not judge a tool call, and the call ran. '
      + "The other checks still ran. Run geneseed doctor to find the fault." }])
})

// A drafted rule has no other reminder. Both families, one line: the hook's output is the reference.
test("context: pending fold items add one line, the hook's; none add nothing", async () => {
  const xdg = path.join(tmp, "draft-xdg")
  const harness = path.join(tmp, "draft-install")
  const repo = path.join(tmp, "draft-repo")
  for (const d of [path.join(xdg, "geneseed"), harness, repo]) await fs.mkdir(d, { recursive: true })
  await fs.writeFile(path.join(harness, ".geneseed-emit"), "opencode-global\n")
  await fs.writeFile(path.join(repo, "README.md"), "# Demo\n")
  const ledger = path.join(xdg, "geneseed", ".fold-state.json")
  const env = { ...process.env, XDG_CONFIG_HOME: xdg }
  const hookOut = () => spawnHook(["context", "--root", harness, "--host", "opencode"], "", { env, cwd: repo }).stdout
  const pluginOut = async () => {
    const { ctx, hooks } = fakeCtx({ directory: repo })
    await (await load("context")).setup(ctx)
    const ev = { sessionID: "d1", model: { providerID: "a", id: "m" }, system: [],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }], constructor: Object }] }
    await hooks.session.context(ev)
    return ev.messages[0].content[0].text
  }
  const keep = { xdg: process.env.XDG_CONFIG_HOME, harness: process.env.GENESEED_HARNESS }
  process.env.XDG_CONFIG_HOME = xdg
  process.env.GENESEED_HARNESS = harness
  try {
    const line = /^\[drafts\] .*$/m
    await fs.writeFile(ledger, JSON.stringify({ version: 1, items: { a: { kind: "rule", host: "claude", state: "pending" },
      b: { kind: "rule", host: "claude", state: "pending" }, c: { kind: "rule", host: "claude", state: "approved" } } }))
    const twin = line.exec(hookOut())?.[0]
    assert.equal(twin, "[drafts] 2 drafted items in user-rules.draft.md wait for the user's decision (the rule skill or the web console).")
    assert.equal(line.exec(await pluginOut())?.[0], twin)
    await fs.writeFile(ledger, JSON.stringify({ version: 1, items: { c: { kind: "rule", state: "approved" } } }))
    assert.doesNotMatch(hookOut(), line)
    await fs.writeFile(ledger, "not json")
    assert.doesNotMatch(hookOut(), line, "a reminder never breaks a session")
    assert.doesNotMatch(await pluginOut(), line)
  } finally {
    for (const [k, v] of [["XDG_CONFIG_HOME", keep.xdg], ["GENESEED_HARNESS", keep.harness]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  }
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

// The pattern above is half of a pair: the other half is the /ponytail command template the
// emitter writes (js/hosts/opencode.mjs). Expand the real template the way OpenCode does, so a
// reworded first line fails here instead of silently disabling the switch on V2.
test("ponytail: the emitted /ponytail template is read back as its level", async () => {
  const { levelFromPrompt } = (await load("ponytail")).server
  const { PONYTAIL_COMMAND_BODY } = await import("../../js/hosts/opencode.mjs")
  assert.equal(levelFromPrompt(PONYTAIL_COMMAND_BODY.replace("$ARGUMENTS", "ultra")), "ultra")
  assert.equal(levelFromPrompt(PONYTAIL_COMMAND_BODY.replace("$ARGUMENTS", "")), "full")
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
  // Wait for the index CONTENT, not the file: `writeFile` creates MEMORY.md before it fills it,
  // and a read in between saw '' (flaked on CI node 24, 2026-10-29).
  const index = path.join(memDir, "MEMORY.md")
  await until(() => existsSync(index) && /— 1 fact/.test(readFileSync(index, "utf8")))
  const gen = calls.find(([m]) => m === "generate.text")
  assert.ok(gen, "generate.text was called")
  assert.deepEqual(gen[1].model, { providerID: "p", id: "m" })
  assert.match(gen[1].prompt, /NOTES:\nuser: the user prefers tabs/)
  assert.ok(existsSync(path.join(memDir, "prefers-tabs.md")))
  // Two-level index (MEMORY.md is written last, so the topic file is already there): the
  // fact's line sits in its topic file, the map names the topic and its count.
  assert.match(readFileSync(path.join(memDir, "topics", "misc.md"), "utf8"),
    /\[prefers-tabs\]\(\.\.\/prefers-tabs\.md\) — tabs over spaces/)
  assert.match(readFileSync(path.join(memDir, "MEMORY.md"), "utf8"), /\[misc\]\(topics\/misc\.md\) — 1 fact/)
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

// `<repo>/.geneseed/` is personal by default, so the first trace write gives it a `.gitignore`
// that ignores the folder's top level and lets the team paths back in — the same string
// `_runtime.js` writes (tests/workflow_runtime.test.mjs asks git what it hides). Create-if-absent: a file
// the user wrote stays byte-identical. And a `.gitignore` that cannot be created (here a
// directory squats the path) never costs the trace or the run's result.
async function runDemoIn(directory) {
  const { ctx, transforms } = fakeCtx({
    directory,
    session: {
      create: async () => ({ id: "ses_child" }),
      context: async () => [{ type: "assistant", tokens: { output: 1 }, content: [{ type: "text", text: "hi" }] }],
    },
  })
  await (await load("workflow")).setup(ctx)
  const tools = []
  for (const cb of transforms) cb({ add: (t) => tools.push(t) })
  return (await tools[0].execute({ name: "demo" })).content
}
test("workflow: the first trace write creates .geneseed/.gitignore, personal by default", async () => {
  const dir = path.join(tmp, "gi-absent")
  await fs.mkdir(dir, { recursive: true })
  const res = await runDemoIn(dir)
  assert.match(res, /workflow "demo" complete/)
  assert.equal(readFileSync(path.join(dir, ".geneseed", ".gitignore"), "utf8"),
    "/*\n!/.gitignore\n!/bricks/\n!/loops/\n!/factories/\n!/protected-checks.txt\n!/done-checks.txt\n")
})
test("workflow: an existing .geneseed/.gitignore is left byte-identical", async () => {
  const dir = path.join(tmp, "gi-present")
  await fs.mkdir(path.join(dir, ".geneseed"), { recursive: true })
  const mine = "# mine\n!keep.txt\r\n"
  await fs.writeFile(path.join(dir, ".geneseed", ".gitignore"), mine)
  await runDemoIn(dir)
  assert.equal(readFileSync(path.join(dir, ".geneseed", ".gitignore"), "utf8"), mine)
})
// A file holding only `*` (any line ending, or none) is what Geneseed itself wrote before
// the allowlist, and it hid team bricks — so it is upgraded. `*` plus anything else is a
// user's edit and stays byte-identical.
for (const [label, before, after] of [
  ["'*\\n' is upgraded", "*\n", "/*\n!/.gitignore\n!/bricks/\n!/loops/\n!/factories/\n!/protected-checks.txt\n!/done-checks.txt\n"],
  ["'*\\r\\n' is upgraded", "*\r\n", "/*\n!/.gitignore\n!/bricks/\n!/loops/\n!/factories/\n!/protected-checks.txt\n!/done-checks.txt\n"],
  ["'*' with no newline is upgraded", "*", "/*\n!/.gitignore\n!/bricks/\n!/loops/\n!/factories/\n!/protected-checks.txt\n!/done-checks.txt\n"],
  ["'*' plus a user line is left byte-identical", "*\n# mine\n", "*\n# mine\n"],
]) {
  test(`workflow: an old .geneseed/.gitignore — ${label}`, async () => {
    const dir = path.join(tmp, `gi-old-${JSON.stringify(before).replace(/\W/g, "")}`)
    await fs.mkdir(path.join(dir, ".geneseed"), { recursive: true })
    await fs.writeFile(path.join(dir, ".geneseed", ".gitignore"), before)
    assert.match(await runDemoIn(dir), /workflow "demo" complete/)
    assert.equal(readFileSync(path.join(dir, ".geneseed", ".gitignore"), "utf8"), after)
  })
}
test("workflow: a .gitignore that cannot be created never costs the trace", async () => {
  const dir = path.join(tmp, "gi-blocked")
  await fs.mkdir(path.join(dir, ".geneseed", ".gitignore"), { recursive: true })
  const res = await runDemoIn(dir)
  assert.match(res, /workflow "demo" complete/)
  const trace = res.match(/Trace: (.+)$/m)[1].trim()
  assert.ok(trace.startsWith(path.join(dir, ".geneseed", "workflow-runs")), trace)
  assert.ok(existsSync(trace), "the trace file was not written")
})

// ---- activity -------------------------------------------------------------------
// V2 events are translated into the V1 events the one reducer already handles.
test("activity: toV1Events maps the V2 vocabulary onto V1 events", async () => {
  const { toV1Events } = (await load("activity")).server
  const tools = new Map()
  const ev = (type, data, created = 1000) => toV1Events({ type, created, data: { sessionID: "s1", ...data } }, tools)
  assert.deepEqual(ev("session.created", { title: "t", location: { directory: "/w" } }),
    [{ type: "session.created", properties: { info: { id: "s1", title: "t", parentID: undefined, agent: undefined, directory: "/w" } } }])
  // a `subagent` child carries its parent and its agent, the two facts a branch needs
  assert.deepEqual(ev("session.created", { parentID: "s0", agent: "explore", location: { directory: "/w" } }),
    [{ type: "session.created", properties: { info: { id: "s1", title: undefined, parentID: "s0", agent: "explore", directory: "/w" } } }])
  // a step's changed files (RelativePath[], no line counts) ride a per-step user-message diff
  // list, so they fold like V1's turn diffs; counts stay null
  assert.deepEqual(ev("session.step.ended", { assistantMessageID: "m1", files: ["src/a.js"] }, 1000).slice(1),
    [{ type: "message.updated", properties: { info: { role: "user", sessionID: "s1", id: "files:m1",
      summary: { diffs: [{ file: "src/a.js", additions: null, deletions: null }] } } } }])
  assert.equal(ev("session.step.ended", { assistantMessageID: "m2" }).length, 1)     // no files key: no list
  assert.deepEqual(ev("session.step.failed", { assistantMessageID: "m3", files: [] }).map((e) => e.properties.info.role), ["assistant", "user"])
  // V2's compaction end is V1's session.compacted
  assert.deepEqual(ev("session.compaction.ended", { reason: "auto", text: "summary" }),
    [{ type: "session.compacted", properties: { sessionID: "s1" } }])
  assert.deepEqual(ev("session.execution.succeeded"), [{ type: "session.idle", properties: { sessionID: "s1" } }])
  assert.deepEqual(ev("session.execution.failed", { error: { type: "api", message: "boom" } }).map((e) => e.type),
    ["session.error", "session.idle"])
  assert.deepEqual(ev("permission.replied", { requestID: "per_1" }),
    [{ type: "permission.replied", properties: { sessionID: "s1", permissionID: "per_1" } }])
  // The name rides only on `session.tool.input.started`; `session.tool.called` carries the
  // input but no name (SessionToolCalled in @opencode/client 2.0.27's generated types).
  assert.deepEqual(ev("session.tool.input.started", { id: "c1", name: "shell", assistantMessageID: "m1" }, 900), [])
  const [running] = ev("session.tool.called", { id: "c1", input: { command: "ls" }, executed: false, assistantMessageID: "m1" }, 1000)
  assert.equal(running.properties.part.tool, "shell")
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

// `root` is the repository top level above the session's own `location.directory` (here the same
// directory as the ctx's; a ctx in another checkout gives the same root, see activity.test.mjs).
// A `subagent` child is a branch of its parent (running while its execution runs, done when it
// succeeds), its step files are attributed to it with null counts, and a compaction is counted.
test("activity: a V2 sub-agent, its step files, and a compaction land on the parent's card", async () => {
  const repo = path.join(tmp, "repo-v2")
  await fs.mkdir(path.join(repo, ".git"), { recursive: true })
  const { ctx, emit, hooks } = fakeCtx({ directory: path.join(repo) })
  const cleanup = await (await load("activity")).setup(ctx)
  const read = () => JSON.parse(readFileSync(path.join(cfgDir, "activity", "p1.json"), "utf8"))
  const zero = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  const row = (p, by) => ({ file: path.posix.basename(p), path: p, additions: null, deletions: null, by })
  emit("session.created", { sessionID: "p1", title: "parent", location: { directory: repo } })
  // turn msg_1: the parent edits src/a.js itself, before any sub-agent
  await settle()
  await hooks.session.prompt({ sessionID: "p1", messageID: "msg_1", prompt: { text: "first" } })
  emit("session.step.ended", { sessionID: "p1", assistantMessageID: "msg_2", files: ["src/a.js"], tokens: zero })
  await settle()
  // turn msg_3 launches k1, which edits src/a.js; the parent's step msg_4 spans that run
  await hooks.session.prompt({ sessionID: "p1", messageID: "msg_3", prompt: { text: "delegate" } })
  emit("session.created", { sessionID: "k1", parentID: "p1", agent: "explore", location: { directory: repo } })
  emit("session.execution.started", { sessionID: "k1" })
  emit("session.step.ended", { sessionID: "k1", assistantMessageID: "msg_5", files: ["src/a.js"],
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } })
  emit("session.step.ended", { sessionID: "p1", assistantMessageID: "msg_4", files: ["src/a.js", "src/b.js"], tokens: zero })
  await settle()
  let e = read()
  assert.equal(e.root, repo)
  assert.equal(e.repo, repo)
  assert.deepEqual(e.agents.map((a) => [a.id, a.type, a.status]), [["k1", "explore", "running"]])
  // the msg_1 turn's edit stays the parent's; msg_4's copy of k1's file is dropped
  assert.deepEqual(e.files.items, [row("src/a.js", null), row("src/a.js", "k1"), row("src/b.js", null)])
  assert.ok(!existsSync(path.join(cfgDir, "activity", "k1.json")))
  emit("session.execution.succeeded", { sessionID: "k1" })
  emit("session.step.ended", { sessionID: "p1", assistantMessageID: "pm1",
    tokens: { input: 1000, output: 5, reasoning: 0, cache: { read: 2000, write: 0 } } })
  emit("session.compaction.ended", { sessionID: "p1", reason: "auto", text: "s" })
  await settle()
  e = read()
  assert.equal(e.agents[0].status, "done")
  assert.equal(e.context, null)          // unknown after the compaction until the next step
  assert.equal(e.compactions, 1)
  assert.equal(e.context_at_compaction, 3000)
  assert.equal(e.turns, 2)
  cleanup()
})
