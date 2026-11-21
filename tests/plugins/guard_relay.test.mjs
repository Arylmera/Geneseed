// The relay ceiling in the OpenCode guard, V1 (js/hosts/hooks-relay.mjs is the original). V1 feeds
// the guard's `event` hook: `session.created` names a child session's parent, an assistant
// `message.updated` its agent (`mode`) and tokens. The ceiling is the carrier's window: a copy of
// the plugin is loaded beside an AGENT.md naming it, as an install lays them out
// (`<install>/plugins/geneseed-guard.js`, `<install>/AGENT.md`). Every expected value is written out.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { makeSandbox } from "../helpers/sandbox.mjs"

const SRC = fileURLToPath(new URL("../../adapters/opencode/plugins/geneseed-guard.js", import.meta.url))

/** The guard's hooks from a copy whose install carrier declares `window` (null: no line). */
const sandboxes = []
after(() => { for (const sb of sandboxes) sb.cleanup() })
async function guardFor(window) {
  const sb = makeSandbox("gsrelay-")
  sandboxes.push(sb)
  const install = sb.path
  await fs.mkdir(path.join(install, "plugins"), { recursive: true })
  await fs.copyFile(SRC, path.join(install, "plugins", "geneseed-guard.js"))
  await fs.writeFile(path.join(install, "AGENT.md"), window ? `# carrier\nContext window: ${window}\n` : "# carrier\n")
  const saved = process.env.GENESEED_HARNESS
  delete process.env.GENESEED_HARNESS
  try {
    const mod = await import(pathToFileURL(path.join(install, "plugins", "geneseed-guard.js")).href)
    return await mod.default.server({ directory: install, worktree: install })
  } finally { if (saved !== undefined) process.env.GENESEED_HARNESS = saved }
}

const assistant = (sessionID, mode, n) => ({ type: "message.updated", properties: { info: {
  role: "assistant", sessionID, mode, tokens: { input: 2, output: 10, cache: { read: n - 1002, write: 1000 } } } } })

/** "blocked: <reason>" or "allowed", for one call. */
async function verdict(hooks, sessionID, tool, args) {
  try { await hooks["tool.execute.before"]({ tool, sessionID }, { args }); return "allowed" } catch (err) {
    const m = String(err?.message)
    if (!m.startsWith("[geneseed-guard] blocked: ")) throw err
    return `blocked: ${m.slice("[geneseed-guard] blocked: ".length)}`
  }
}

test("V1: on a 250k install a developer child past 150k may only commit", async () => {
  const hooks = await guardFor("250k")
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "w1", parentID: "root" } } } })
  await hooks.event({ event: assistant("w1", "developer", 160000) })
  assert.match(await verdict(hooks, "w1", "bash", { command: "npm test" }),
    /^blocked: Relay ceiling: your context is 160k tokens, past 150k, and every turn re-reads all of it\./)
  assert.match(await verdict(hooks, "w1", "write", { filePath: "a.js", content: "x" }), /^blocked: Relay ceiling/)
  assert.equal(await verdict(hooks, "w1", "bash", { command: "git add -A && git commit -m \"wip\"" }), "allowed")
  assert.equal(await verdict(hooks, "w1", "read", { filePath: "a.js" }), "allowed", "a read passes")
  // Another agent's child, and a session with no parent, are never stopped by it.
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "r1", parentID: "root" } } } })
  await hooks.event({ event: assistant("r1", "reviewer", 400000) })
  assert.equal(await verdict(hooks, "r1", "bash", { command: "npm test" }), "allowed")
  await hooks.event({ event: assistant("root", "developer", 400000) })
  assert.equal(await verdict(hooks, "root", "bash", { command: "npm test" }), "allowed")
  // A compaction summary's tokens are the conversation it replaced: they do not move the context.
  await hooks.event({ event: { type: "message.updated", properties: { info: {
    role: "assistant", sessionID: "w1", mode: "developer", summary: true, tokens: { input: 900000 } } } } })
  await hooks.event({ event: assistant("w1", "developer", 140000) })
  assert.equal(await verdict(hooks, "w1", "bash", { command: "npm test" }), "allowed", "under the ceiling again")
})

test("V1: the same 160k worker passes on a 1m install, and is stopped at 120k with no window line", async () => {
  const big = await guardFor("1m")
  await big.event({ event: { type: "session.created", properties: { info: { id: "w1", parentID: "root" } } } })
  await big.event({ event: assistant("w1", "developer", 160000) })
  assert.equal(await verdict(big, "w1", "bash", { command: "npm test" }), "allowed")
  const plain = await guardFor(null)
  await plain.event({ event: { type: "session.created", properties: { info: { id: "w1", parentID: "root" } } } })
  await plain.event({ event: assistant("w1", "developer", 125000) })
  assert.match(await verdict(plain, "w1", "bash", { command: "npm test" }), /past 120k/)
})
